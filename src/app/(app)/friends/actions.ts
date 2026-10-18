'use server';

import { and, eq, or } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { withUser } from '@/db';
import { friendships, profiles } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { normalizeUsername, usernameError } from '@/lib/friends';
import { findUserByUsername } from '@/db/queries';

/* 好友相关的写入。
 *
 * 三个约定：
 *   1. 结果通过 redirect 的查询参数回到页面（?n=xxx），不引入客户端状态。
 *      这些操作全都整页刷新才有意义（列表变了、开关变了），
 *      用 useActionState 反而要多写一个客户端组件、还容易忘记刷新列表。
 *   2. redirect() 必须在 try/catch 外面 —— 它是靠抛异常实现的，
 *      被 catch 吞掉会出现「点了没反应」这种最难查的 bug。
 *   3. 权限判断交给数据库：所有写操作都走 withUser()，RLS 会拦住
 *      改别人行、插别人名下的记录。应用层只负责给出人话的错误。
 */

/** 保存 / 修改自己的用户名。 */
export async function saveUsername(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get('username') ?? '');

  const bad = usernameError(raw);
  if (bad) redirect('/friends?n=username_bad');

  const username = normalizeUsername(raw);
  let taken = false;

  await withUser(user.id, async (tx) => {
    try {
      await tx.update(profiles).set({ username }).where(eq(profiles.id, user.id));
    } catch (e) {
      // 23505 = unique_violation：名字被别人占了。
      // 这不是异常情况，是正常的「重名」，必须给一句人话。
      if ((e as { code?: string }).code === '23505') taken = true;
      else throw e;
    }
  });

  if (taken) redirect('/friends?n=username_taken');

  revalidatePath('/friends');
  redirect('/friends?n=username');
}

/** 按用户名发好友申请。 */
export async function sendFriendRequest(formData: FormData) {
  const user = await requireUser();
  const raw = String(formData.get('username') ?? '');
  const normalized = normalizeUsername(raw);

  if (normalized.length === 0) redirect('/friends?n=notfound');

  const peer = await findUserByUsername(user.id, normalized);
  if (!peer) redirect('/friends?n=notfound');
  if (peer.peerId === user.id) redirect('/friends?n=self');

  // 先看有没有现成的关系：已经接受了就不该再发，正等着也别重复发。
  const existing = await withUser(user.id, async (tx) =>
    tx
      .select({ status: friendships.status })
      .from(friendships)
      .where(
        or(
          and(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, peer.peerId)),
          and(eq(friendships.requesterId, peer.peerId), eq(friendships.addresseeId, user.id)),
        ),
      )
      .limit(1),
  );

  if (existing[0]?.status === 'accepted') redirect('/friends?n=exists');
  if (existing[0]?.status === 'pending') redirect('/friends?n=pending');

  let duplicated = false;
  await withUser(user.id, async (tx) => {
    try {
      await tx.insert(friendships).values({
        requesterId: user.id,
        addresseeId: peer.peerId,
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') duplicated = true;
      else throw e;
    }
  });

  if (duplicated) redirect('/friends?n=pending');

  revalidatePath('/friends');
  redirect('/friends?n=request');
}

/** 接受 / 拒绝收到的申请。 */
export async function respondRequest(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');
  const decision = formData.get('decision') === 'accept' ? 'accepted' : 'declined';

  if (id.length === 0) redirect('/friends');

  await withUser(user.id, async (tx) => {
    // 只更新「发给我的」那一条：addressee_id = 我。
    // RLS 也会拦，但 where 里写清楚是给读代码的人看的。
    await tx
      .update(friendships)
      .set({ status: decision, respondedAt: new Date() })
      .where(and(eq(friendships.id, id), eq(friendships.addresseeId, user.id)));
  });

  revalidatePath('/friends');
  redirect(`/friends?n=${decision === 'accepted' ? 'accept' : 'decline'}`);
}

/** 删好友 / 撤回申请。 */
export async function removeFriend(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get('id') ?? '');

  if (id.length === 0) redirect('/friends');

  await withUser(user.id, async (tx) => {
    await tx
      .delete(friendships)
      .where(
        and(
          eq(friendships.id, id),
          or(eq(friendships.requesterId, user.id), eq(friendships.addresseeId, user.id)),
        ),
      );
  });

  revalidatePath('/friends');
  redirect('/friends?n=remove');
}

/** 保存「好友能看到我什么」的两个开关。 */
export async function saveShares(formData: FormData) {
  const user = await requireUser();

  // 复选框没勾就是不在表单里，所以用 === 'on' 判断，
  // 不能用 Boolean(formData.get(...))。
  const shareMeals = formData.get('share_meals') === 'on';
  const shareTraining = formData.get('share_training') === 'on';

  await withUser(user.id, async (tx) => {
    await tx.update(profiles).set({ shareMeals, shareTraining }).where(eq(profiles.id, user.id));
  });

  revalidatePath('/friends');
  redirect('/friends?n=shares');
}
