'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* 底部标签栏。
 *
 * 为什么底部而不是顶部：这一屏 90% 的使用场景是「单手拿手机」——
 * 站着称完体重、坐在工位上记午饭。手机屏幕 6.1 英寸以上时，
 * 拇指自然覆盖区域在下三分之一，顶部导航要换手才能点到。
 * Apple 自带的健康、健身 App 用的也是这个模式。
 *
 * 为什么是客户端组件：只有它需要知道「当前在哪一页」来高亮。
 * 用 usePathname() 而不是从父组件传 pathname —— 传给客户端组件的
 * props 会被序列化进 RSC payload，而 pathname 每次导航都变，
 * 等于让整页重新渲染。
 *
 * 高度组成：内容 56px + 底部安全区。iPhone 的 Home Indicator 会盖住
 * 最下面约 34px，env(safe-area-inset-bottom) 在非全面屏上是 0，
 * 所以这个写法在两种机器上都对 —— 不需要写两套样式。
 * （前提：layout.tsx 的 viewport 里设了 viewportFit: 'cover'，
 *   否则 env() 在所有机型上都取 0。） */

const TABS = [
  {
    href: '/dashboard',
    label: '今天',
    /* 图标用内联 SVG 而不是图标库：三个图标写死在需要的地方，
     * 比引入一个 40 KB 的包再 tree-shake 更可控 —— 
     * 而且能保证描边粗细和 Apple SF Symbols 的观感一致（1.8px / 圆头）。 */
    icon: (
      <>
        <path d="M4 7.5h16" />
        <path d="M4 12h16" />
        <path d="M4 16.5h10" />
      </>
    ),
  },
  {
    href: '/log/meal',
    label: '记一餐',
    icon: (
      <>
        <circle cx="12" cy="12" r="8.2" />
        <path d="M12 8.4v7.2M8.4 12h7.2" />
      </>
    ),
  },
  {
    href: '/fitness',
    label: '训练',
    /* 哑铃：一根横杆 + 两端各两片配重。
     * 不加中间的握把细线 —— 11px 字号旁边的小图标只有 24px，
     * 多一根线就糊成一团了。 */
    icon: (
      <>
        <path d="M6.8 8.6v6.8M4.2 10.2v3.6" />
        <path d="M17.2 8.6v6.8M19.8 10.2v3.6" />
        <path d="M6.8 12h10.4" />
      </>
    ),
  },
  {
    href: '/history',
    label: '回顾',
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="3.2" />
        <path d="M3.5 9.6h17" />
        <path d="M8 3.2v3.4M16 3.2v3.4" />
      </>
    ),
  },
  {
    href: '/trends',
    label: '趋势',
    icon: (
      <>
        <path d="M4 17.5 9 11l4 3.5L20 6.5" />
        <path d="M20 11V6.5h-4.5" />
      </>
    ),
  },
] as const;

export function AppTabBar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="主导航"
      className="sticky bottom-0 z-50 border-t border-hairline bg-canvas/80 backdrop-blur-xl backdrop-saturate-150"
    >
      <ul className="mx-auto flex max-w-content pb-safe-nav">
        {TABS.map((tab) => {
          /* startsWith 而不是 ===：/log/meal 下将来可能有 /log/meal/xxx
           * 子页面，那时标签仍然该高亮。
           * 这里本来还写了 `tab.href !== '/'` 来防止根路径匹配一切，但 TABS 是
           * `as const`，href 的类型是字面量联合（'/dashboard' | '/log/meal' | …），
           * 根本不含 '/' —— TS 直接把这个判断报成「不可能成立」。字面量联合的好处：
           * 手滑写错路径会当场编译失败，而不是上线后才发现标签永远不高亮。 */
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);

          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`touch-target flex h-14 flex-col items-center justify-center gap-0.5 transition-colors ${
                  active ? 'text-accent-blue' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  {tab.icon}
                </svg>
                <span className="text-caption-2 font-medium">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
