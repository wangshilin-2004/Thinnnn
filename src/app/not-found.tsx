import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: '页面不存在' };

/* 自定义 404。
 *
 * Next 默认那个 404 是英文的（"This page could not be found."），
 * 对一个中文产品来说，用户看到英文会以为网站坏了或者自己点错了地方。
 *
 * 这里给两条出路而不是一条：回首页、去控制台。
 * 点错链接的人想去的是控制台，不是营销首页。
 */
export default function NotFound() {
  return (
    <main className="screen-min flex flex-col justify-center px-space-5">
      <div className="content-max mx-auto w-full max-w-[420px]">
        <p className="tabular text-caption-1 tracking-title text-ink-4">404</p>

        <h1 className="mt-space-2 text-title-1 font-semibold text-ink">这里没有东西</h1>
        <p className="prose-measure mt-space-3 text-body text-ink-2">
          链接可能输错了，或者这个页面已经不存在。
        </p>

        <div className="mt-space-6 flex flex-wrap gap-space-3">
          <Link
            href="/dashboard"
            className="touch-target inline-flex items-center rounded-full bg-brand px-space-5 text-callout font-medium text-on-accent no-underline"
          >
            去控制台
          </Link>
          <Link
            href="/"
            className="touch-target inline-flex items-center rounded-full border border-separator px-space-5 text-callout text-ink no-underline"
          >
            回首页
          </Link>
        </div>
      </div>
    </main>
  );
}
