'use client';

import { useEffect } from 'react';

import { applyStoredTheme, THEME_STORAGE_KEY } from '@/lib/theme';

/* 全站错误边界。
 *
 * 为什么这个文件值得单独写：
 *
 * 1. 生产构建会把服务端异常的真实信息**替换成一个不透明的 digest**
 *    （框架故意的，避免把数据库结构、连接串之类泄漏给浏览器）。
 *    所以这里读不到「到底哪里错了」，只能按**最可能的原因排序**给指引。
 *
 * 2. 对这一个项目来说，最可能的原因是**免费版 Supabase 休眠**：
 *    连续 7 天没有任何请求，项目会被暂停；下次访问时数据库连不上。
 *    这是免费档的已知行为，不是 bug，而且用户自己能修（面板上点一下）。
 *    如果只显示一个英文错误页，用户会以为是自己代码写坏了。
 *
 * 3. 第二可能是环境变量没配对 —— 那正是 Vercel 首次部署最容易踩的坑，
 *    所以把排查入口指向 docs/05-部署.md 里那张症状对照表。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /* 自己应用一次主题，不能指望 <head> 里那段内联脚本。
     *
     * 实测（生产构建，2026-10-16）：页面抛错时 Next 会生成一个
     * `<html id="__next_error__">` 的错误文档，此时 <head> 里的内联脚本
     * **存在但不会执行** —— 它由 React 在客户端插入，而这样插入的 <script> 不执行。
     * 结果是错误页停在浅色主题：深色模式下满屏白底，比错误本身更让人以为网站坏了。
     *
     * 这里补一次是可靠的：错误边界是客户端组件，只在 JS 运行时才会渲染，
     * 所以这个 effect 一定会跑。 */
    applyStoredTheme(document.documentElement, THEME_STORAGE_KEY);

    // 留在浏览器控制台，方便真出问题时排查（用户不会看，我调试时会看）
    console.error('[轻记] 未捕获错误:', error);
  }, [error]);

  return (
    <main className="screen-min flex flex-col justify-center px-space-5">
      <div className="content-max mx-auto w-full max-w-[480px]">
        <h1 className="text-title-1 font-semibold text-ink">没能加载出来</h1>
        <p className="prose-measure mt-space-3 text-body text-ink-2">
          数据没读出来。先点下面的按钮重试一次 —— 多数情况是网络抖了一下。
        </p>

        <button
          type="button"
          onClick={reset}
          className="touch-target mt-space-6 inline-flex items-center rounded-full bg-brand px-space-5 text-callout font-medium text-on-accent"
        >
          重试
        </button>

        <section className="mt-space-8 rounded-lg border border-hairline bg-card p-space-4">
          <h2 className="text-headline font-semibold text-ink">还不行的话，按顺序查这三条</h2>

          <ol className="mt-space-3 space-y-space-4">
            <li>
              <p className="text-callout font-medium text-ink">
                1. 数据库是不是休眠了
              </p>
              <p className="mt-space-1 text-footnote text-ink-2">
                Supabase 免费版连续 7 天没有请求会暂停项目。登录
                supabase.com，项目上会显示 <span className="text-ink">Paused</span>，
                点 <span className="text-ink">Restore</span> 唤醒，等一两分钟即可。
                <span className="text-ink-3">数据不会丢。</span>
              </p>
            </li>

            <li>
              <p className="text-callout font-medium text-ink">2. 环境变量配全了吗</p>
              <p className="mt-space-1 text-footnote text-ink-2">
                Vercel 上需要 5 个变量（两个 <code className="text-ink-3">NEXT_PUBLIC_SUPABASE_*</code>、
                <code className="text-ink-3">DATABASE_URL</code>、<code className="text-ink-3">DIRECT_URL</code>、
                <code className="text-ink-3">SUPABASE_SERVICE_ROLE_KEY</code>）。
                改完必须 <span className="text-ink">重新部署</span>才生效，热重载不会带上新变量。
              </p>
            </li>

            <li>
              <p className="text-callout font-medium text-ink">3. 迁移跑过了吗</p>
              <p className="mt-space-1 text-footnote text-ink-2">
                表不存在时也是这个页面。本地跑
                <code className="text-ink-3"> npm run db:migrate</code> 把表建到线上库。
              </p>
            </li>
          </ol>

          <p className="mt-space-4 text-caption-1 text-ink-4">
            排查清单和更多症状对照见仓库里的 docs/05-部署.md。
          </p>
        </section>
      </div>
    </main>
  );
}
