'use client';

import { Moon, Sun } from 'lucide-react';

import { THEME_STORAGE_KEY } from '@/lib/theme';

/* 深浅色切换。
 *
 * 这个组件里【没有 useState】，这是刻意的。三个理由：
 *
 * 1. 图标由 CSS 决定，不由 JS 状态决定。
 *    主题的真实来源是 <html> 上有没有 .dark 这个 class（见 layout.tsx 里的
 *    阻塞式内联脚本）。如果这里再用一份 React state 去镜像它，就有两份真相，
 *    一旦不同步（比如用户在另一个标签页切了主题）图标就会说谎。
 *    用 dark: 变体读同一份真相，永远一致。
 *
 * 2. 首帧就是对的，且不会 hydration 失败。
 *    服务端渲染时不知道主题，如果靠 useEffect 读 localStorage 再 setState，
 *    图标会先渲染成错的、挂载后再跳一下。走 CSS 的话，内联脚本已经在首次绘制
 *    之前把 .dark 放好了，第一帧就渲染正确的那个图标。
 *
 * 3. 点击时直接读 DOM，不读闭包里的旧值。
 *    handleToggle 每次都重新问一遍 classList，所以连点、或者别的组件改过主题
 *    之后再点，行为都正确。
 *
 * 写成两个图标叠在一起而不是条件渲染：只有一个会显示，另一个 display:none，
 * 不占布局、不产生点击热区，代价只是多一个 16px 的 SVG 节点。 */
export function ThemeToggle() {
  function handleToggle() {
    const root = document.documentElement;
    /* 切换的依据是「当前是不是深色」，而不是「localStorage 里存了什么」。
     * 无痕模式下 localStorage 可能抛异常，但 classList 一定能读。 */
    const nextIsDark = !root.classList.contains('dark');

    root.classList.toggle('dark', nextIsDark);

    /* color-scheme 要跟着改：它决定浏览器自己画的那部分 UI（滚动条、
     * 输入框自动填充底色、下拉菜单）。不同步的话深色页面会配一条白色滚动条。 */
    root.style.colorScheme = nextIsDark ? 'dark' : 'light';

    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextIsDark ? 'dark' : 'light');
    } catch {
      /* Safari 无痕模式 / 阻止跨站跟踪下会抛 SecurityError。
       * 存不下就存不下，本次会话内切换仍然生效，不影响功能。 */
    }
  }

  return (
    <button
      type="button"
      onClick={handleToggle}
      /* aria-label 写成陈述「这个按钮做什么」，而不是描述当前状态——
       * 因为真正的状态已经在视觉上表达了，而读屏用户需要的是动作。 */
      aria-label="切换深色或浅色主题"
      title="切换深色或浅色主题"
      /* touch-target 撑到 44×44 的 HIG 最小热区；
       * 视觉上仍是一个 36px 的圆，靠负外边距在视觉上不显得笨重。 */
      className="touch-target rounded-full text-ink-2 transition-colors hover:text-ink hover:bg-raised"
    >
      <Sun className="hidden size-[18px] dark:block" aria-hidden strokeWidth={1.75} />
      <Moon className="block size-[18px] dark:hidden" aria-hidden strokeWidth={1.75} />
    </button>
  );
}
