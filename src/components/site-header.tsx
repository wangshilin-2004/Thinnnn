import Link from 'next/link';

import { ThemeToggle } from './theme-toggle';

/* 顶部导航。
 *
 * 用 bg-canvas/70 + backdrop-blur 而不是 .glass 工具类：
 * .glass 会额外叠一层 135° 斜向光泽，那在「大面积卡片」上是厚度感，
 * 在一条 52px 高的横条上会变成一条莫名其妙的斜线。导航只需要
 * 「透出底下内容 + 提饱和」这两件事，手写三个工具类更准。
 *
 * sticky 而不是 fixed：fixed 会让元素脱离文档流，正文必须自己加一段
 * 等高 padding 去补，一旦导航高度改了（比如移动端换行）就会错位。
 * sticky 保留占位，正文自然接在下面，没有这个耦合。
 * z-50 是给后面的图表和玻璃卡片留出层级余量。 */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-hairline bg-canvas/70 backdrop-blur-xl backdrop-saturate-150">
      <div className="content-max flex h-[52px] items-center justify-between gap-4">
        {/* 点按区域（hit area）与视觉大小是两件事。
         * HIG 要求可点目标 ≥44×44pt，但导航里放一个 44px 高的胶囊会显得笨重。
         * 做法：外层的 <Link> 撑到 44px 当可点区域，内层 <span> 保持 36px 画胶囊。
         * 为什么不用伪元素撑：伪元素能扩大可点范围，但 getBoundingClientRect()
         * 量不到它 —— 于是 cdp.mjs diag 会一直报「目标偏小」，
         * 你就再也分不清是真小还是假小。可测量的实现 > 聪明但测不到的实现。
         * 这个坑肉眼看不出来，是 diag 量出来的。 */}
        <Link
          href="/"
          className="-mx-2 inline-flex h-11 items-center px-2 text-headline font-medium text-ink transition-opacity hover:opacity-70"
        >
          轻记
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/#principles"
            className="hidden h-11 items-center text-ink-2 transition-colors hover:text-ink sm:inline-flex"
          >
            <span className="inline-flex h-9 items-center rounded-full px-3 text-subhead">
              设计原则
            </span>
          </Link>
          <ThemeToggle />
          {/* 「开始记录」原来指向 /login —— 已登录的人点它会被弹回 /dashboard，
              等于白点一下。它想说的其实是「去记一顿」，所以改成直接进记录页。 */}
          <Link
            href="/log/meal"
            className="inline-flex h-11 items-center text-on-accent transition-opacity hover:opacity-90"
          >
            {/* 主按钮用品牌色实心块。这里用了 --on-accent（纯白）压色块，
             * 对比度约 3.6:1 —— 不到 4.5:1，是刻意接受的：
             * 苹果自家的实心按钮就是这个水平（systemBlue + 白字约 4.0:1），
             * 而 17px semibold 的可读性在实测里没问题。
             * 需要严格达标的场景（正文、长段落）用 --brand-text 那一档。 */}
            <span className="inline-flex h-9 items-center rounded-full bg-brand px-4 text-subhead font-semibold">
              开始记录
            </span>
          </Link>
          <Link
            href="/settings"
            aria-label="设置"
            className="inline-flex h-11 items-center text-ink-2 transition-colors hover:text-ink"
          >
            <span className="inline-flex h-9 items-center rounded-full px-3 text-subhead">
              设置
            </span>
          </Link>
        </div>
      </div>
    </header>
  );
}
