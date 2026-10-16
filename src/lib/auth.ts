import 'server-only';

import { redirect } from 'next/navigation';

import { sql } from '@/db';
import { createSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';

/* 当前登录用户。
 *
 * 只在服务端调用。所有页面/Server Action 都从这里拿 userId，
 * 再把它交给 withUser() —— 应用层永远不自己拼 where user_id = ?，
 * 行级权限由数据库的 RLS 兜底。
 */

export type SessionUser = {
  id: string;
  email: string | null;
  displayName: string | null;
  timezone: string;
};

/** 开发用户此刻是否真的会生效。
 *
 * 这是「开发用户」这件事的**单一真相来源**：devUser() 用它决定要不要返回用户，
 * 登录页用它决定该说什么话。
 *
 * 为什么要抽出来：这两处一旦各写一份判断，就会漂移成最让人困惑的状态 ——
 * 提示说「本地开发模式不用登录，直接打开 /dashboard」，但打开就被弹回登录页。
 * 本项目真在生产的构建上撞到过：缺少 NEXT_PUBLIC_SUPABASE_* 时，
 * isSupabaseConfigured() 为 false 走进「开发模式」分支，
 * 可 Vercel 的 NODE_ENV 是 production，第一道锁直接把它挡掉了 ——
 * 于是文案撒谎，而真正的原因（该去配环境变量）一个字都没提。
 *
 * 三道锁与 devUser() 完全一致。详见 devUser() 上方的说明。 */
export function isDevUserActive(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  if (!process.env.DEV_USER_ID) return false;
  return /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '');
}

/** 本地离线开发用的固定用户。
 *
 * 为什么需要一个：Supabase Auth（GoTrue）是 Supabase 托管服务的一部分，
 * 本地 PGlite 里没有它。为了在没有网络、没有 Supabase 账号的情况下也能
 * 开发和验证页面，这里造一个固定的开发用户。
 *
 * 三道保险，确保它绝不可能在生产环境被启用：
 *   1. NODE_ENV 必须是 development（next build/start 都是 production）
 *   2. 必须显式设置 DEV_USER_ID —— 不设就没有这个用户，而不是悄悄放行
 *   3. 数据库必须指向本机（连远端库时直接拒绝）
 * 三条都满足才返回用户。任何一条不满足都退回到真正的 Supabase 鉴权。 */
async function devUser(): Promise<SessionUser | null> {
  const dbUrl = process.env.DATABASE_URL ?? '';

  /* 配置自相矛盾（设了开发用户，却连的是远端库）要**大声报错**，
   * 不能静默降级成"没有开发用户" ——
   * 那会让人以为自己一直在本地库上开发，实际每次请求都在打真库。 */
  if (process.env.NODE_ENV !== 'production' && process.env.DEV_USER_ID && !/localhost|127\.0\.0\.1/.test(dbUrl)) {
    throw new Error(
      'DEV_USER_ID 已设置，但 DATABASE_URL 不是本机地址 —— 拒绝启用开发用户。' +
        '开发用户只能在本地库上使用。',
    );
  }

  if (!isDevUserActive()) return null;

  const id = process.env.DEV_USER_ID!;
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('DEV_USER_ID 必须是 UUID');

  /* auth.users 里没有这行的话，measurements / meal_items 的外键会指向空气。
   * 本地库的 auth schema 是我们自己造的仿真层，所以可以写；
   * 真实 Supabase 的 auth.users 由 GoTrue 管，这里永远不会被执行到。 */
  await sql`
    insert into auth.users (id, email)
    values (${id}, 'dev@localhost')
    on conflict (id) do nothing
  `;

  const rows = await sql<{ display_name: string | null; timezone: string }[]>`
    select display_name, timezone from public.profiles where id = ${id}
  `;
  const profile = rows[0];

  return {
    id,
    email: 'dev@localhost',
    displayName: profile?.display_name ?? null,
    timezone: profile?.timezone ?? 'Asia/Shanghai',
  };
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  // Supabase 还没配好（比如本地离线开发）→ 走开发用户
  if (!isSupabaseConfigured()) return devUser();

  const supabase = await createSupabaseServerClient();
  /* 必须用 getUser() 而不是 getSession()。
   * getSession() 只解码 Cookie 里的 JWT，不向服务端验证 —— 攻击者可以
   * 自己伪造一个签名看似合法的 Cookie。getUser() 会真的去 GoTrue 校验。 */
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) return devUser();
  /* ↑ 没登录成功时也走一次 devUser()。
   *
   * 这里看着像后门，所以把安全性讲清楚（三道锁都在 devUser 内部）：
   *   1. NODE_ENV === 'production' → 直接返回 null
   *   2. 没有显式设 DEV_USER_ID → 返回 null（不是"悄悄放行"，是"没有就没有"）
   *   3. DATABASE_URL 必须指向本机，否则抛错拒绝启动
   * 三道全过才返回一个用户。也就是说这段代码在 Vercel 上**恒定**返回 null。
   *
   * 为什么不在生产路径里彻底删掉这个分支：
   * 那样本地就没法"连着真库开发 UI"（Supabase 配好了但我不想登录时）。
   * 保留它换来的是开发效率，代价是上面三道锁必须一直成立 ——
   * 所以 tests 里应当有一条断言盯着 devUser 在生产返回 null。 */

  const rows = await sql<{ display_name: string | null; timezone: string }[]>`
    select display_name, timezone from public.profiles where id = ${user.id}
  `;
  const profile = rows[0];

  return {
    id: user.id,
    email: user.email ?? null,
    displayName: profile?.display_name ?? null,
    timezone: profile?.timezone ?? 'Asia/Shanghai',
  };
}

/** 拿不到用户就送去登录页。用于「必须登录」的页面，省掉每处都判空。
 *
 * 用 redirect 而不是抛错：
 * 抛错会把用户带到 Next 的错误页（"Application error"），
 * 而真实情况只是"你没登录"。看到错误页的人会以为网站坏了，
 * 看到登录页的人会去登录 —— 后者才是我们想让他做的动作。
 *
 * 注意 redirect 是靠**抛出**一个特殊错误（NEXT_REDIRECT）来中断执行的，
 * 所以它必须放在函数的最后一句，后面不能再有代码。 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
