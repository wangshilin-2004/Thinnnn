'use server';

import { revalidatePath } from 'next/cache';

import { requireUser } from '@/lib/auth';
import { EMAIL_RE } from '@/lib/email';
import { normalizeInviteCode } from '@/lib/invite';
import { createInviteCodeRecord, isInviteOwner, voidInviteCodeRow } from '@/lib/invite-admin';
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

import type { InviteState, SettingsState } from './state';

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

/* ------------------------------------------------------------------ *
 * 邀请码管理（只有管理员看得到、点得动）
 *
 * 为什么放在设置页而不是单开一个 /admin：
 *   管理面只有一个动作 —— 生成一个码、发给朋友。为它单开路由、单做导航，
 *   是给一个一年用两三次的操作配了一套门面。放在设置页最底下，
 *   「只有管理员渲染这一块」（见 page.tsx 的 isInviteOwner 判断），
 *   普通用户根本看不到这段界面，也没法通过 URL 直接访问 ——
 *   因为它在同一页里，不存在「隐藏路由被打」这种情况。
 *
 * 为什么两个 action 都要重新校验 isInviteOwner：
 *   界面上「看不见」不是安全边界。Server Action 是一个可以被直接调用的
 *   HTTP 端点，所以每个入口都必须自己确认一次身份 —— 不能依赖
 *   「页面上没渲染按钮」。
 * ------------------------------------------------------------------ */

const MAX_USES_RANGE = [1, 50] as const;
const DAYS_RANGE = [1, 3650] as const;

function inRange(value: number, [min, max]: readonly [number, number]): boolean {
  return Number.isInteger(value) && value >= min && value <= max;
}

export async function createInviteCodeAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const user = await requireUser();
  if (!isInviteOwner(user.email)) {
    return { status: 'error', message: '只有管理员能生成邀请码。' };
  }

  const note = String(formData.get('note') ?? '')
    .trim()
    .slice(0, 40);
  const maxUses = Number(formData.get('maxUses') ?? 1);
  const days = Number(formData.get('days') ?? 30);

  if (!inRange(maxUses, MAX_USES_RANGE)) {
    return { status: 'error', message: '可用次数要在 1–50 之间。' };
  }
  if (!inRange(days, DAYS_RANGE)) {
    return { status: 'error', message: '有效天数要在 1–3650 之间。' };
  }

  try {
    const created = await createInviteCodeRecord({
      note: note.length > 0 ? note : null,
      maxUses,
      days,
    });

    /* 生成成功后要让页面重新渲染一次，否则列表里看不到新码
         （Server Action 的返回值只更新表单自己的状态，不会自动刷新兄弟节点）。 */
    revalidatePath('/settings');

    return {
      status: 'ok',
      message: `新码：${created.code} —— 已经复制好，直接粘给朋友。`,
      createdCode: created.code,
    };
  } catch (error) {
    console.error('[createInviteCode]', error);
    return { status: 'error', message: '生成失败，稍后再试一次。' };
  }
}

export async function voidInviteCodeAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const user = await requireUser();
  if (!isInviteOwner(user.email)) {
    return { status: 'error', message: '只有管理员能作废邀请码。' };
  }

  const code = normalizeInviteCode(String(formData.get('code') ?? ''));
  if (!code) return { status: 'error', message: '没收到要作废的码。' };

  try {
    const found = await voidInviteCodeRow(code);
    if (!found) return { status: 'error', message: '没有这个码，可能已经被删了。' };
    revalidatePath('/settings');
    return { status: 'ok', message: `${code} 已作废 —— 它现在不能用来注册了。` };
  } catch (error) {
    console.error('[voidInviteCode]', error);
    return { status: 'error', message: '作废失败，稍后再试一次。' };
  }
}
