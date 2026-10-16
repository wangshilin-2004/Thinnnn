import { NextResponse, type NextRequest } from 'next/server';

import { createSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';

/* 魔法链接的回跳入口。
 *
 * 流程：用户在邮箱里点链接 → Supabase 把浏览器打到
 *   /auth/callback?code=xxxx
 * → 我们在服务端拿这个 code 去 GoTrue 换回真正的会话（access + refresh token）
 * → 会话写进 Cookie → 跳进控制台。
 *
 * 为什么必须是 Route Handler（而不是页面）：
 * 换会话要**写 Cookie**，而 Server Component 里 Cookie 是只读的。
 * 只有 Route Handler 和 proxy 能写响应头。
 *
 * 为什么用 code 而不是直接把 token 放在 URL 里：
 * URL 会进浏览器历史、会进 Referer 头、会被截图分享。
 * code 是一次性的，且只能由持有 PKCE verifier 的那个浏览器兑换 ——
 * 就算链接被转发给别人，别人也换不出来。
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  /* 未登录时想去哪，登录后送回哪。
   * 只接受站内相对路径：以 '//' 或 'http' 开头的值会被拼成外部地址，
   * 等于把「登录后跳转」变成一个开放重定向漏洞（钓鱼常用手法：
   * 用你的域名做跳板，链接看起来是可信的）。 */
  const rawNext = searchParams.get('next') ?? '/dashboard';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(`${origin}/login?error=not_configured`);
  }

  // 用户直接在 Supabase 那边失败（链接过期、已被用过）时会带 error 回来
  const linkError = searchParams.get('error_description') ?? searchParams.get('error');
  if (linkError) {
    console.error('[auth/callback] 链接校验失败', linkError);
    return NextResponse.redirect(`${origin}/login?error=link`);
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=nocode`);
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.session) {
    console.error('[auth/callback] 换取会话失败', error?.message);
    return NextResponse.redirect(`${origin}/login?error=exchange`);
  }

  /* 这里刻意**不去判断用户有没有设过目标**。
   *
   * 一开始想读 user_metadata.onboarded_at 来决定送不送引导页，两处都不对：
   *   1. onboarded_at 是 profiles 表的列，不在 user_metadata 里；
   *   2. user_metadata 由用户自己可写，拿它做任何判断都等于让用户改判据。
   * 而为了这一跳去查一次库，收益也不值当 —— 控制台自己知道有没有目标，
   * 它会给出「去设定目标」的引导。让判断留在离数据最近的地方。 */
  return NextResponse.redirect(`${origin}${next}`);
}
