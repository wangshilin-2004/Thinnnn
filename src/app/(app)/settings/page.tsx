import { redirect } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import { getCurrentUser } from '@/lib/auth';

import { EmailForm, PasswordForm, SignOutButton } from './settings-forms';

export const metadata = { title: '设置 · 轻记' };

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
