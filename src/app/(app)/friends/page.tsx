import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { getMyLinks, getProfile } from '@/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { USERNAME_HINT, friendNotice } from '@/lib/friends';

import { removeFriend, respondRequest, saveShares, saveUsername, sendFriendRequest } from './actions';

/* 好友页。
 *
 * 整页零客户端 JavaScript：加好友、接受、删除、改开关都是
 * <form action={serverAction}> + redirect。理由有两个：
 *   1. 这些操作全都要整页刷新（列表变了），用客户端状态反而要多同步一份；
 *   2. 少一个客户端组件就少一份 hydration 成本，而这一页在手机上打开时
 *      最有价值的信息（谁在等我确认）应该在首屏 HTML 里就有。
 *
 * 关于隐私的一句话必须写在接受按钮旁边，不能只写在设置里 ——
 * 用户是在按「接受」的那一刻决定要不要共享的。 */

export const metadata = { title: '好友' };
export const dynamic = 'force-dynamic';

const CARD = 'rounded-2xl border border-separator bg-card p-space-5';
const INPUT =
  'w-full rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';
const BTN =
  'touch-target inline-flex items-center justify-center rounded-md bg-brand px-space-5 py-space-3 text-subhead font-semibold text-on-accent transition-opacity hover:opacity-90';
const BTN_SOFT =
  'touch-target inline-flex items-center justify-center rounded-md border border-separator bg-sunken px-space-4 py-space-2 text-footnote font-medium text-ink transition-colors hover:bg-raised';

export default async function FriendsPage({
  searchParams,
}: {
  searchParams: Promise<{ n?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { n } = await searchParams;
  const notice = friendNotice(n);

  const [profile, links] = await Promise.all([getProfile(user.id), getMyLinks(user.id)]);

  const accepted = links.filter((l) => l.status === 'accepted');
  const incoming = links.filter((l) => l.status === 'pending' && l.direction === 'in');
  const outgoing = links.filter((l) => l.status === 'pending' && l.direction === 'out');

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-space-6 pb-24 pt-space-6">
        <div className="flex flex-col gap-space-2">
          <p className="text-subhead text-ink-3">加了就能互相看见</p>
          <h1 className="text-title-1 font-semibold text-ink">好友</h1>
        </div>

        {notice && (
          <p
            role={notice.tone === 'ok' ? 'status' : 'alert'}
            className={`rounded-xl border px-space-4 py-space-3 text-footnote ${
              notice.tone === 'ok'
                ? 'border-brand/30 bg-brand/10 text-brand-text'
                : 'border-accent-red/40 bg-accent-red/10 text-accent-red'
            }`}
          >
            {notice.text}
          </p>
        )}

        {/* ── 我的用户名 ───────────────────────────────────────── */}
        <section className={CARD}>
          <h2 className="text-headline font-semibold text-ink">我的用户名</h2>
          <p className="mt-space-2 text-footnote text-ink-3">
            朋友靠这个名字加你 —— <span className="text-ink-2">不用给邮箱</span>。
            邮箱是登录凭据，不该当名片用。
          </p>
          <p className="mt-space-3 text-body text-ink">
            {profile?.username ? (
              <span className="font-semibold text-brand-text">@{profile.username}</span>
            ) : (
              <span className="text-ink-3">还没设，现在设一个：</span>
            )}
          </p>
          <form action={saveUsername} className="mt-space-3 flex flex-col gap-space-3">
            <input
              name="username"
              type="text"
              defaultValue={profile?.username ?? ''}
              placeholder="比如 shilin"
              autoCapitalize="none"
              autoCorrect="off"
              className={INPUT}
            />
            <p className="text-caption-1 text-ink-4">{USERNAME_HINT}</p>
            <button type="submit" className={`${BTN} self-start`}>
              保存用户名
            </button>
          </form>
        </section>

        {/* ── 加好友 ───────────────────────────────────────────── */}
        <section className={CARD}>
          <h2 className="text-headline font-semibold text-ink">加好友</h2>
          <p className="mt-space-2 text-footnote text-ink-3">
            输入对方的用户名，发一条申请。对方同意之后，你们才能互相看到记录。
          </p>
          <form action={sendFriendRequest} className="mt-space-4 flex flex-col gap-space-3">
            <input
              name="username"
              type="text"
              placeholder="对方的用户名"
              autoCapitalize="none"
              autoCorrect="off"
              className={INPUT}
            />
            <button type="submit" className={`${BTN} self-start`}>
              发送申请
            </button>
          </form>
        </section>

        {/* ── 收到的申请 ───────────────────────────────────────── */}
        {incoming.length > 0 && (
          <section className={CARD}>
            <h2 className="text-headline font-semibold text-ink">
              收到的申请
              <span className="ml-space-2 text-caption-1 font-normal text-ink-4">
                {incoming.length} 条
              </span>
            </h2>
            <ul className="mt-space-3 flex flex-col divide-y divide-separator">
              {incoming.map((l) => (
                <li key={l.peerId} className="flex flex-col gap-space-3 py-space-3">
                  <p className="text-body text-ink">
                    <span className="font-semibold">@{l.username ?? '（没设用户名）'}</span>
                    <span className="text-ink-4"> 想加你</span>
                  </p>
                  {/* 这句话必须出现在按「接受」之前 */}
                  <p className="text-caption-1 text-ink-4">
                    同意之后，你们可以互相看到对方的训练和饮食记录（可以随时在下面关掉）。
                  </p>
                  <div className="flex gap-space-2">
                    <form action={respondRequest}>
                      <input type="hidden" name="id" value={l.linkId} />
                      <input type="hidden" name="decision" value="accept" />
                      <button type="submit" className={BTN}>
                        接受
                      </button>
                    </form>
                    <form action={respondRequest}>
                      <input type="hidden" name="id" value={l.linkId} />
                      <input type="hidden" name="decision" value="decline" />
                      <button type="submit" className={BTN_SOFT}>
                        拒绝
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── 发出的申请 ───────────────────────────────────────── */}
        {outgoing.length > 0 && (
          <section className={CARD}>
            <h2 className="text-headline font-semibold text-ink">发出的申请</h2>
            <ul className="mt-space-3 flex flex-col divide-y divide-separator">
              {outgoing.map((l) => (
                <li key={l.peerId} className="flex items-center justify-between gap-space-3 py-space-3">
                  <p className="text-body text-ink">
                    @{l.username ?? '（没设用户名）'}
                    <span className="ml-space-2 text-caption-1 text-ink-4">等对方确认</span>
                  </p>
                  <form action={removeFriend}>
                    <input type="hidden" name="id" value={l.linkId} />
                    <button type="submit" className={BTN_SOFT}>
                      撤回
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── 共享开关 ─────────────────────────────────────────── */}
        <section className={CARD}>
          <h2 className="text-headline font-semibold text-ink">好友能看到我什么</h2>
          <form action={saveShares} className="mt-space-4 flex flex-col gap-space-3">
            <label className="flex items-start gap-space-3 text-body text-ink">
              <input
                type="checkbox"
                name="share_meals"
                defaultChecked={profile?.shareMeals ?? true}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                饮食记录
                <span className="block text-caption-1 text-ink-4">吃了什么、多少热量</span>
              </span>
            </label>
            <label className="flex items-start gap-space-3 text-body text-ink">
              <input
                type="checkbox"
                name="share_training"
                defaultChecked={profile?.shareTraining ?? true}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--color-brand)]"
              />
              <span>
                训练记录
                <span className="block text-caption-1 text-ink-4">有氧多久、练了哪些动作</span>
              </span>
            </label>
            <button type="submit" className={`${BTN} self-start`}>
              保存
            </button>
          </form>
        </section>

        {/* ── 好友列表 ─────────────────────────────────────────── */}
        <section className={CARD}>
          <h2 className="text-headline font-semibold text-ink">
            好友
            <span className="ml-space-2 text-caption-1 font-normal text-ink-4">
              {accepted.length} 人
            </span>
          </h2>
          {accepted.length === 0 ? (
            <p className="mt-space-3 text-footnote text-ink-3">
              还没有好友。先设个用户名，再让朋友把你也加上 —— 申请是双向确认的。
            </p>
          ) : (
            <ul className="mt-space-3 flex flex-col divide-y divide-separator">
              {accepted.map((l) => (
                <li key={l.peerId} className="flex items-center justify-between gap-space-3 py-space-3">
                  <Link
                    href={`/friends/${l.peerId}`}
                    className="min-w-0 flex-1 text-body text-ink transition-opacity hover:opacity-70"
                  >
                    @{l.username ?? '（没设用户名）'}
                    <span className="ml-space-2 text-caption-1 text-ink-4">看他的记录 →</span>
                  </Link>
                  <form action={removeFriend}>
                    <input type="hidden" name="id" value={l.linkId} />
                    <button type="submit" className={BTN_SOFT}>
                      删除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-space-1 text-caption-1 text-ink-4">
          好友之间只能看训练和饮食记录。生日、身高、目标体重这些东西不会共享 ——
          数据库层面就挡住了，不是靠页面不显示。
        </p>
      </main>
    </>
  );
}
