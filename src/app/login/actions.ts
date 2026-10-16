'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';

/* LoginState 与 LOGIN_INITIAL 都在 ./state.ts。
 * 不能写在这个文件里 —— 'use server' 文件只允许导出 async 函数，
 * 导出对象会让表单提交时 500。详见 state.ts 顶部的说明。 */
import type { LoginState } from './state';

/* 登录 / 登出。
 *
 * 这里刻意**不用密码**，走「魔法链接」（magic link / email OTP）：
 *
 *   1. 密码需要存储、需要强度校验、需要找回流程、会被复用、会泄露。
 *      对一个 3 人用的减脂工具来说，这些成本换不来任何东西。
 *   2. 魔法链接的凭据是一次性、短时效的，泄漏面小得多。
 *   3. Supabase 自带发信，不用自己配 SMTP（省掉一整个运维面）。
 *
 * 代价也要写清楚：登录需要切到邮箱点一次链接，比输密码慢；
 * 而且 Supabase 免费档对发信有频率限制（默认每小时几封），
 * 点太多次会被限流 —— 所以下面把「已发送」的提示写得明确，
 * 让用户知道该去收信，而不是反复点按钮。
 */

/* 邮箱校验用正则而不是 z.email()。
 * 和 log/meal/actions.ts 里 UUID 的取舍一致：zod 3 和 4 的写法不同，
 * 正则不受版本影响，升级时不会静默失效。 */
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 把请求的 origin 拼出来，用于生成回跳地址。
 *
 * 为什么从 headers 读而不是写死环境变量：
 * 同一条代码要同时服务 localhost:3000、Vercel 的预览域名、正式域名三种情况。
 * 写死会让「预览部署上登录后跳回正式站」这种问题只在部署后才出现。 */
async function currentOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  /* x-forwarded-proto 由 Vercel 这类反向代理设置。
   * 本地直连时它不存在，用 http；线上一定是 https，
   * 而 Supabase 的回跳白名单要求协议完全匹配，写错会导致链接点开报错。 */
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

/** 发送登录链接。配合客户端的 useActionState 使用。 */
export async function sendMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!emailRe.test(email)) {
    return { status: 'error', message: '邮箱格式看起来不对，检查一下？' };
  }

  if (!isSupabaseConfigured()) {
    /* 本地离线开发时 Supabase 没配。这时 devUser() 会自动接管，
     * 根本不需要登录 —— 如实说明，别假装发送成功了。 */
    return {
      status: 'error',
      message: '本地开发模式不需要登录（已自动使用开发用户）。直接打开 /dashboard 即可。',
    };
  }

  const supabase = await createSupabaseServerClient();
  const origin = await currentOrigin();

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      /* shouldCreateUser: true —— 第一次用某个邮箱登录就自动注册。
       * 这是一个有意的取舍：本项目要拉朋友一起用，如果关掉，
       * 每次加人都得手动去 Supabase 后台建账号。
       * 代价是「知道网址的人都能注册」。对 3 人自用工具可接受；
       * 要收紧时把这里改成 false，并启用 schema 里已有的 invite_codes 表。 */
      shouldCreateUser: true,
    },
  });

  if (error) {
    /* 错误原文只进服务端日志。回给用户的是笼统说法 ——
     * 区分「这个邮箱不存在」和「发信失败」等于提供了一个账号枚举接口。 */
    console.error('[sendMagicLink]', error.message);
    return { status: 'error', message: '发送失败，稍后再试一次。' };
  }

  return {
    status: 'sent',
    message: `登录链接已发到 ${email}。去邮箱点开它就能进——链接只能用一次，15 分钟内有效。`,
  };
}

/** 退出登录。 */
export async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  /* 清掉可能存在的路由缓存，否则返回首页时可能还渲染着登录态的壳。
   * redirect 必须在最后 —— 它会抛出一个特殊错误来中断执行，
   * 放在前面的话后面这些代码永远不会跑。 */
  revalidatePath('/', 'layout');
  redirect('/login');
}
