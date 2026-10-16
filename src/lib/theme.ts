/* 主题切换的单一真相来源。
 *
 * 为什么需要这个文件（而不是把逻辑写在两个地方）：
 *
 * 主题 class 必须在**两个时机**被应用：
 *   1. HTML 解析到 <head> 时（防白闪，此时 React 还没 hydrate）
 *   2. 服务端出错、错误边界接管文档时（见下面「一个真实的坑」）
 *
 * 这两处的代码如果各写一份，迟早会改一处忘一处，然后出现
 * 「正常页面是深色、出错页面是浅色」这种只在故障时才暴露的错位。
 * 所以下面这个函数既是可调用的函数，也是被内联进 <head> 的那段脚本的源码 ——
 * 用 `applyStoredTheme.toString()` 生成，物理上不可能不一致。
 *
 * 一个真实的坑（2026-10-16 实测）：
 * 生产构建里让页面抛错，Next 会生成一个 `<html id="__next_error__">` 的错误文档。
 * 这时 <head> 里那段内联脚本**存在但不会执行** —— 它是由 React 在客户端插入的，
 * 而通过 innerHTML 方式插入的 <script> 不执行。结果就是错误页停在浅色主题，
 * 深色模式下白得刺眼。实测：手动把那段脚本 eval 一遍，class 才变成 dark。
 *
 * 结论：错误边界不能依赖「<head> 里的脚本跑过了」。它是客户端组件，
 * 只在 JS 运行时才会渲染，所以在 effect 里自己应用一次是可靠且够用的。
 */

export const THEME_STORAGE_KEY = 'theme';

/**
 * 把用户存过的主题偏好应用到 <html> 上。
 *
 * 默认深色：只有用户明确选过 `light` 才移除 dark，其余情况（含首次访问）一律深色。
 * 这与 globals.css 用 `.dark` class 而非 `@media (prefers-color-scheme)` 是同一个决策 ——
 * 用户的手动选择优先于系统设置。
 *
 * 参数必须显式传入（不能引用模块作用域的常量）：这个函数会被 toString() 之后
 * 内联进 <head>，字符串化后拿不到模块作用域里的任何东西。
 */
export function applyStoredTheme(root: HTMLElement, storageKey: string): void {
  try {
    if (localStorage.getItem(storageKey) === 'light') {
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
    }
  } catch {
    /* 无痕模式、Safari 的「阻止跨站跟踪」、部分企业策略下访问 localStorage
     * 会直接抛 SecurityError。捕获后静默回落到默认深色 —— 这是能拿到的
     * 最接近用户意图的结果。 */
    root.classList.add('dark');
  }
  /* 同步给浏览器：决定原生滚动条、输入框、下拉菜单的明暗。
   * 只靠 CSS 里的 color-scheme 也够用，提前设是为了让首帧就是对的。 */
  root.style.colorScheme = root.classList.contains('dark') ? 'dark' : 'light';
}

/** 要被内联进 <head> 的防白闪脚本。必须是内联 + 同步执行，不能抽成外部文件。 */
export const themeInitScript = `(function(){(${applyStoredTheme.toString()})(document.documentElement,${JSON.stringify(
  THEME_STORAGE_KEY,
)});})();`;
