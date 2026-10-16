import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/* 每个请求都跑一遍的「代理」—— Next.js 16 里这就是过去叫 middleware 的东西。
 *
 * 注意文件名：Next 16 起 `middleware.ts` 已被标记为废弃，官方改名成 `proxy.ts`
 * （旧名仍能用，但构建时会打一条 deprecation 警告）。导出的函数名也要跟着改：
 * 要么 default export，要么具名导出 `proxy`。写成 `middleware` 会报
 * 「must export a function, either as a default export or as a named "proxy" export」。
 *
 * 它只做一件事：**刷新登录令牌**。
 *
 * 为什么不在这里做"未登录就跳登录页"：
 *   1. proxy 跑在 Edge runtime，读不到只有服务端才有的东西，
 *      而开发用户（DEV_USER_ID）那三道保险依赖 DATABASE_URL —— 在这里判会分裂成两套逻辑。
 *   2. 判断"要不要跳"需要知道用户是谁，而这件事页面自己（requireUser）做得更准，
 *      也不会被 proxy 的 matcher 漏配坑到（漏一条路径 = 那条路径静默免鉴权）。
 *   所以守卫放在各页面的 requireUser()，这里只负责让会话不过期。
 *
 * 为什么必须在服务端刷新令牌：
 *   Supabase 的 access token 有效期只有 1 小时。刷新动作会写回新的 Cookie，
 *   而 Server Component 里 Cookie 是只读的（不能 set）。只有这里 —— 一个
 *   能读也能写响应头的中间层 —— 才写得回去。少了它，用户登录一小时后
 *   会毫无征兆地被登出。 */
export default async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  /* 本地离线开发时这两个变量是空的（故意不配，好走 devUser 那条路），
   * 此时直接放行，什么都不做。 */
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // 先写回 request，让这次请求下游的 Server Component 也看到新令牌；
        // 再重建 response 并把 Cookie 挂上去，让浏览器也拿到。
        // 两步缺一不可：只写 response，本次渲染用的还是旧令牌。
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  /* 必须真的调一次 getUser()。
   * 它不只是"读一下当前用户"——当 access token 过期时，它会用 refresh token
   * 去 GoTrue 换一个新的，并经由上面的 setAll 把新 Cookie 写回响应。
   * 这一行就是整个文件存在的理由。
   * 用 getUser() 而不是 getSession()：后者只解码 Cookie，不与服务端核对。 */
  await supabase.auth.getUser();

  return response;
}

export const config = {
  /* 排除静态资源：给图片/字体也跑一遍鉴权刷新纯属浪费，
   * 而且会让首屏多出一串无谓的 Edge 调用。
   * 用负向前瞻而不是列举要匹配的路径 —— 白名单漏一条就等于漏一条保护。 */
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf)$).*)',
  ],
};
