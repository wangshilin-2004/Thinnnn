import 'server-only';

import { desc, eq } from 'drizzle-orm';

import { db } from '@/db';
import { inviteCodes } from '@/db/schema';
import { generateInviteCode, inviteStatusLabel, isOwnerEmail } from '@/lib/invite';

/* 邀请码的管理侧操作：列、生成、作废。
 *
 * 为什么走数据库直连，而不是 Supabase 的 REST / service_role key
 * ---------------------------------------------------------------
 * invite_codes 是「RLS 开启 + 零策略 + 零 GRANT」的表（见 schema.ts 第 8 节），
 * 所以 anon / authenticated 连 SELECT 权限都没有。要读写它，只有一条路：
 * 用 postgres 角色（库的所有者，绕过 RLS）直连。
 *
 * 这不是绕路，而是这张表被设计成这样的唯一正确用法。曾经试过用
 * SUPABASE_SERVICE_ROLE_KEY 建一个 supabase-js 客户端去打 PostgREST，
 * 拿到的是 `permission denied for table invite_codes` —— 因为本项目用的
 * 是新格式密钥（`sb_secret_…`，不是 JWT），PostgREST 拿不到 service_role
 * 角色，GRANT 这一层就过不去（RLS 都还没轮到）。改走直连之后，
 * 顺带还省掉了一个环境变量。
 *
 * 安全边界因此完全落在下面这个判断上
 *   isInviteOwner(email) —— 由 Server Action 在调用这些函数**之前**校验，
 *   两个 action 各校验一次（见 settings/actions.ts）。
 * 这个文件里的函数不做任何鉴权，也不该被客户端直接调用（'server-only' 兜底）。
 */

export type InviteCodeView = {
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  createdAt: string;
  status: 'active' | 'exhausted' | 'expired';
};

/** 环境变量里配的管理员邮箱列表（OWNER_EMAILS，逗号分隔）。
 *
 * 判断逻辑本身在 src/lib/invite.ts 的 isOwnerEmail() 里，是纯函数、有单测；
 * 这里只负责把环境变量喂进去。
 *
 * 没配时返回 false —— 也就是「没有管理员」而不是「所有人都是管理员」。
 * 这个方向是刻意的：漏配的后果应该是管理功能消失，不是门户大开。 */
export function isInviteOwner(email: string | null | undefined): boolean {
  return isOwnerEmail(email, process.env.OWNER_EMAILS ?? '');
}

const COLUMNS = {
  code: inviteCodes.code,
  note: inviteCodes.note,
  maxUses: inviteCodes.maxUses,
  usedCount: inviteCodes.usedCount,
  expiresAt: inviteCodes.expiresAt,
  createdAt: inviteCodes.createdAt,
} as const;

type Row = {
  code: string;
  note: string | null;
  maxUses: number;
  usedCount: number;
  expiresAt: Date | null;
  createdAt: Date;
};

function toView(row: Row): InviteCodeView {
  const expiresAt = row.expiresAt ? row.expiresAt.toISOString() : null;
  return {
    code: row.code,
    note: row.note,
    maxUses: row.maxUses,
    usedCount: row.usedCount,
    expiresAt,
    createdAt: row.createdAt.toISOString(),
    status: inviteStatusLabel({
      usedCount: row.usedCount,
      maxUses: row.maxUses,
      expiresAt,
    }),
  };
}

export async function listInviteCodes(limit = 30): Promise<InviteCodeView[]> {
  const rows = await db
    .select(COLUMNS)
    .from(inviteCodes)
    .orderBy(desc(inviteCodes.createdAt))
    .limit(limit);

  return rows.map(toView);
}

export async function createInviteCodeRecord(input: {
  note: string | null;
  maxUses: number;
  days: number;
}): Promise<InviteCodeView> {
  const expiresAt = new Date(Date.now() + input.days * 24 * 60 * 60 * 1000);

  /* 码是随机生成的，理论上可能撞上已有主键。撞了就换一个重试 ——
   * 32^8 的空间里这几乎不会发生，但「几乎不会」不等于不会，
   * 而且撞了之后的报错（duplicate key 23505）对用户毫无意义。 */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateInviteCode();
    try {
      const [row] = await db
        .insert(inviteCodes)
        .values({ code, note: input.note, maxUses: input.maxUses, expiresAt })
        .returning(COLUMNS);

      return toView(row);
    } catch (error) {
      /* postgres-js 把 SQLSTATE 放在 error.code 里。 */
      const code23505 = (error as { code?: string }).code === '23505';
      if (!code23505) {
        throw new Error(
          `生成邀请码失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  throw new Error('生成邀请码失败：连续 5 次都撞上了已有码，这不该发生。');
}

/** 作废一个码。
 *
 * 用「把 used_count 提到 max_uses」的方式作废，而不是 DELETE 掉这一行：
 * 已经发出去的码必须留下痕迹 —— 谁在什么时候领的、用没用过，
 * 是排查「朋友说进不来」时唯一能看的线索。物理删除会让这些信息消失。
 */
export async function voidInviteCodeRow(code: string): Promise<boolean> {
  const [found] = await db
    .select({ maxUses: inviteCodes.maxUses })
    .from(inviteCodes)
    .where(eq(inviteCodes.code, code))
    .limit(1);

  if (!found) return false;

  await db.update(inviteCodes).set({ usedCount: found.maxUses }).where(eq(inviteCodes.code, code));

  return true;
}
