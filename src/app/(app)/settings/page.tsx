import { redirect } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { getCurrentUser } from '@/lib/auth';
import { listInviteCodes, isInviteOwner } from '@/lib/invite-admin';

import { InviteCodes } from './invite-codes';
import { EmailForm, PasswordForm, SignOutButton } from './settings-forms';

/* 别在这里写「 · 轻记」—— 根布局的 title.template 会再拼一次，
   结果就是「设置 · 轻记 · 轻记」。其他页面都只写裸标题。 */
export const metadata = { title: '设置' };

/* 必须 force-dynamic：这一页渲染的是「你是谁」，取决于请求带来的 Cookie。
 * 让 Next 把它静态化的话，构建时算出来的那份 HTML（没有登录态）
 * 会被所有请求共用 —— 表现就是「登录之后打开设置页，
 * 显示的是上一个用户，或者干脆被弹回登录页」。 */
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  /* requireUser() 也能用（它内部就是这个 + 重定向），
   * 这里显式写 if (!user) 是因为页面还要拿 user.email 来渲染，
   * 分开写能少一次类型断言。 */
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  /* 邀请码卡片只给管理员渲染。
   * 判断依据是环境变量 OWNER_EMAILS 里有没有这个邮箱 —— 见 src/lib/invite.ts。
   * 普通用户看不到这一块，也调不动那两个 action（它们各自还有一次校验）。 */
  const isOwner = isInviteOwner(user.email);
  let inviteCodes: Awaited<ReturnType<typeof listInviteCodes>> = [];
  let inviteLoadFailed = false;
  if (isOwner) {
    try {
      inviteCodes = await listInviteCodes();
    } catch (error) {
      /* 读失败最常见的原因是 Vercel 上漏配 SUPABASE_SERVICE_ROLE_KEY。
       * 这里捕获而不让它冒泡：漏配一个可选功能的管理变量，
       * 不该把整个设置页（改密码、改邮箱、退出登录）都带成 500。 */
      console.error('[settings] 读取邀请码失败', error);
      inviteLoadFailed = true;
    }
  }

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
        <header className="flex flex-col gap-1">
          <p className="text-subhead text-ink-3">账号</p>
          <h1 className="text-title-1 font-semibold tracking-title text-ink">设置</h1>
        </header>

        <EmailForm current={user.email ?? '（这个账号没有邮箱）'} />

        <PasswordForm />

        <section className="flex flex-col gap-space-3 rounded-xl border border-hairline bg-card p-space-5">
          <h2 className="text-headline font-semibold text-ink">导出数据</h2>
          <p className="prose-measure text-footnote text-ink-3">
            把全部记录下载成 CSV。Excel、Numbers、WPS 都能直接打开，
            换工具或者想自己算点什么都行 —— 数据是你的，不该被锁在这个网站里。
          </p>
          <div className="flex flex-wrap gap-space-3">
            {/* 用 <a download> 而不是按钮：下载必须由浏览器发起一个真 GET，
                 fetch + Blob 那套会把整个文件读进内存再存盘，几百条记录的
                 CSV 没问题，但没必要多绕一层。 */}
            <a
              href="/settings/export?kind=meals"
              download
              className="touch-target inline-flex items-center justify-center rounded-md border border-separator bg-sunken px-space-5 py-space-3 text-subhead font-semibold text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              饮食记录
            </a>
            <a
              href="/settings/export?kind=weights"
              download
              className="touch-target inline-flex items-center justify-center rounded-md border border-separator bg-sunken px-space-5 py-space-3 text-subhead font-semibold text-ink transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              体重记录
            </a>
          </div>
        </section>

        {isOwner && inviteLoadFailed && (
          <section className="flex flex-col gap-space-3 rounded-xl border border-hairline bg-card p-space-5">
            <h2 className="text-headline font-semibold text-ink">邀请码</h2>
            <p className="prose-measure text-footnote text-ink-3">
              读不出邀请码列表。这张表只有服务端的数据库连接能读，所以最常见的原因是数据库连不上
              —— 服务端日志里能看到具体报错。其他的设置不受影响。
            </p>
          </section>
        )}

        {isOwner && !inviteLoadFailed && <InviteCodes codes={inviteCodes} />}

        <section className="flex flex-col gap-space-3 rounded-xl border border-hairline bg-card p-space-5">
          <h2 className="text-headline font-semibold text-ink">退出登录</h2>
          <p className="prose-measure text-footnote text-ink-3">
            这台设备上的登录状态会被清掉。换台设备或借别人用之前点一下。
          </p>
          <SignOutButton />
        </section>
      </main>
    </>
  );
}
