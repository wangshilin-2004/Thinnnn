'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { EMAIL_RE } from '@/lib/email';
import { createSupabaseServerClient, isSupabaseConfigured } from '@/lib/supabase';

/* 设置页的三个入口：改密码、改邮箱、退出登录。
 *
 * 为什么这几个功能必须存在（不是「有更好」）：
 *
 *   1. **不配自定义 SMTP 时，Supabase 自带发信对免费档有每小时几封的硬限制。**
 *      魔法链接一旦被限流，没有密码的用户就完全进不来 —— 而这类用户
 *      往往正是刚注册、还没设密码的那个。改密码这条路是那种时刻的唯一出口。
 *   2. GitHub 的 noreply 地址（`xxx+用户名@users.noreply.github.com`）是
 *      **只写地址，收不到任何邮件**，但很多人拿它当注册邮箱。改邮箱是唯一的解。
 *
 * 这两个都是「部署完才发现」的问题，所以它们必须由应用自己解决，
 * 而不是指望用户去 Supabase 后台手动改。 */

import type { SettingsState } from './state';

/** Supabase 没配好时该说什么。
 * 和 src/app/login/actions.ts 里的 notConfiguredState 保持同一套说法 ——
 * 那边说的是「谁也登不进去」，这边说的是「改不了」，但都不该
 * 出现英文原文错误。 */
function notConfigured(): SettingsState {
  return {
    status: 'error',
    message: '服务端没配好 Supabase，这个操作暂时用不了。',
  };
}

/** 改密码。
 *
 * 安全性靠两件事，都不在这里手写：
 *   1. requireUser() 保证有登录态（没登录会被重定向到 /login，不会执行下去）
 *   2. Supabase 用 bcrypt 存哈希，明文既不落库也不进日志
 *
 * 这里额外要求输两遍，是因为密码框是 type="password"，
 * 打错了自己也看不见 —— 只输一遍的后果是「设置成功」之后再也没法登录。 */
export async function updatePassword(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const password = String(formData.get('password') ?? '');
  const confirm = String(formData.get('confirm') ?? '');

  /* 只挡明显太短的。真正的强度规则交给 Supabase ——
   * 在这里自创一套，会在两边不一致时让用户莫名改不掉。 */
  if (password.length < 6) {
    return { status: 'error', message: '密码至少 6 位。' };
  }
  if (password !== confirm) {
    return { status: 'error', message: '两次输入的密码不一样，再对一遍。' };
  }
  if (password.length > 72) {
    /* bcrypt 只取前 72 字节，更长的部分会被静默截断 ——
     * 与其让用户以为设了个很长的密码，不如直接说清楚。 */
    return { status: 'error', message: '密码最长 72 个字符。' };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  await requireUser();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error('[updatePassword]', error.message);
    if (error.code === 'over_request_rate_limit') {
      return { status: 'error', message: '改得太频繁了，等一分钟再试。' };
    }
    /* 常见的一种：同密码重复使用被 Supabase 的泄露密码检查拦下。
     * 原文是英文，这里换成能看懂的说法。 */
    if (/pwned|weak|leaked/i.test(error.message)) {
      return { status: 'error', message: '这个密码在已知泄露库里出现过，换一个别的。' };
    }
    return { status: 'error', message: '改密码失败，稍后再试一次。' };
  }

  revalidatePath('/settings');
  return { status: 'ok', message: '密码已更新。下次登录用新密码。' };
}

/** 改邮箱。
 *
 * 注意这是**两步**的：提交之后 Supabase 会往新地址发一封确认信，
 * 点开它地址才会真的换过去。所以这里的成功文案不能写「已改成」，
 * 得写「去收确认信」—— 写错了用户会以为已经生效，
 * 然后在登录页用一个还没生效的地址反复试。
 *
 * 顺带解释一个部署时容易卡住的开关：Supabase 后台的
 * 「Secure email change」如果开着，会**同时**往旧地址和新地址各发一封确认，
 * 两边都点完才生效。旧地址是 noreply 那种收不到信的情况下，
 * 这个功能会永远卡住 —— 需要在 Authentication → Email 里把它关掉。
 * 这里没法自动判断那个开关，所以把话写在下面的提示里。 */
export async function updateEmail(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();

  if (!EMAIL_RE.test(email)) {
    return { status: 'error', message: '邮箱格式看起来不对，检查一下？' };
  }

  if (!isSupabaseConfigured()) return notConfigured();
  await requireUser();

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ email });

  if (error) {
    console.error('[updateEmail]', error.message);
    if (error.code === 'over_request_rate_limit') {
      return { status: 'error', message: '发信太频繁了，等一会儿再试。' };
    }
    if (error.code === 'email_exists') {
      return { status: 'error', message: '这个邮箱已经被其他账号用了。' };
    }
    return { status: 'error', message: '改邮箱失败，稍后再试一次。' };
  }

  revalidatePath('/settings');
  return {
    status: 'ok',
    message: `确认信已发到 ${email}。去那个邮箱点开链接，地址才算真的换过去。`,
  };
}
