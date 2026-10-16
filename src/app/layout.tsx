import type { Metadata, Viewport } from 'next';

/* 自托管 Inter：非苹果设备用它兜底，避免落到 Arial。
 * 走 @fontsource 而不是 next/font 的原因：next/font 会在构建时下载字体，
 * 内网/离线环境直接构建失败；@fontsource 把 woff2 放在 node_modules 里，
 * 构建过程完全离线。两者都自带 unicode-range，按需加载汉字的开销是一样的。
 * 顺序很重要：必须在 globals.css 之前引入，这样我们的 token 才能覆盖它。 */
import '@fontsource-variable/inter';
import './globals.css';

import { themeInitScript } from '@/lib/theme';

/* 标题与描述写中文，直接决定浏览器标签页与分享卡片的呈现。
 * 没有写 metadataBase：本项目还没有确定线上域名，乱填会让 OG 图链接变成
 * 错误的绝对地址；等部署时补上即可。 */
export const metadata: Metadata = {
  title: {
    default: '轻记 · 体重与饮食可视化',
    template: '%s · 轻记',
  },
  description: '记录体重与每日饮食，用图表看清热量收支与营养结构的变化趋势。',
  applicationName: '轻记',
  keywords: ['体重管理', '饮食记录', '热量', '营养', '数据可视化'],
  /* iOS 添加到主屏后按独立 App 运行；配合 globals.css 里那套
   * env(safe-area-inset-*) 工具类，刘海屏与底部指示条才不会压住内容。 */
  appleWebApp: {
    capable: true,
    title: '轻记',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
    date: false,
    address: false,
    email: false,
  },
};

/* Next.js 16 里 viewport 必须【单独具名导出】，不能再塞进 metadata。
 * metadata.viewport 已被标记 @deprecated，塞进去会被忽略。 */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /* cover 是使用 env(safe-area-inset-*) 的前提。
   * 默认值 auto 会让页面四周留出安全区，env() 全部取到 0，刘海屏修复直接失效。
   * 与那套 .pt-safe / .pb-safe 工具类是一对，只能同时成立。 */
  viewportFit: 'cover',
  colorScheme: 'dark light',
  /* 两个 themeColor 分别对应深/浅两套画布色。
   * 注意 media 必须写 prefers-color-scheme 而不是 .dark：
   * <meta> 的 media 只能求值媒体查询，读不到 class，
   * 所以用户在深色系统下手动切成浅色时，这个 meta 不会跟着变。
   * 这是该 API 的固有限制——真正跟着 class 变的是 CSS 里的 color-scheme。 */
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
};

/* 防白闪（FOUC）脚本。
 *
 * 为什么必须是「内联 + 阻塞」：主题 class 只有落到 <html> 上才生效，
 * 而 React 要等 JS 包下载并 hydrate 之后才能改 DOM。中间这段时间浏览器已经
 * 画过一帧了，用户会看到白底一闪。内联脚本在 HTML 解析到 <head> 时就同步执行，
 * 早于任何外部资源与首次绘制，是唯一能赶在首帧之前的时机。
 * 代价是它不能被压缩器优化、也不能抽成外部文件——抽出去就又变成异步的了。
 *
 * 脚本内容与那个可调用的 applyStoredTheme() 是**同一份源码**（见 src/lib/theme.ts），
 * 靠 toString() 生成。原因：错误边界接管文档时 <head> 里的内联脚本不会执行，
 * 那边只能自己再调一次函数；两处逻辑若各写一份，迟早改一漏一。 */

/* 服务端渲染时 <html> 上【故意不写】 dark：
 * 主题由上面的脚本在客户端决定，静态 HTML 里写死会让 React 在 hydrate 时
 * 发现 class 对不上而报警告。交给脚本去加，首帧之前就会生效，不会有闪烁。 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    /* suppressHydrationWarning 必须挂在 <html> 上 —— 属性会被脚本改掉的就是它。
     * 这里踩过一次：一开始加在了下面那个 <script> 上，因为注释是写在 script 旁边的，
     * 手就跟着注释走了。但 warning 说的是「<html> 的 class 和客户端不一致」，
     * 加在 script 上一点用都没有，开发浮层照样显示 "1 Issue"。
     *
     * React 的这个属性只作用于元素**自身**的属性与文本，不向下传递，
     * 所以子孙节点（body 及整棵树）的校验完全不受影响，不会掩盖真实的手水不合。
     * 这正是 next-themes 等主题库的标准做法。 */
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          /* 这个也留着：脚本节点本身的属性同样由内联 HTML 决定，
           * 留一个 suppress 可以让将来往上面加 data-* 时不至于又炸一次。 */
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: themeInitScript }}
        />
      </head>
      {/* antialiased 必须挂在 body 上：它设置的是 -webkit-font-smoothing
       * 与 -moz-osx-font-smoothing。macOS 上关闭次像素渲染后字重会整体变细，
       * 这正是苹果官网的观感。副作用是 ≤13px 的小字（caption-1 / caption-2）
       * 会比系统默认更虚一些，深色模式下尤其明显；真觉得糊就把这两档
       * 调成 500 字重，不要退回默认渲染——那样整页的精致感就没了。
       * bg-canvas / text-ink 走 token，深色下自动变成纯黑底与 #F5F5F7。 */}
      <body className="font-sans antialiased bg-canvas text-ink">{children}</body>
    </html>
  );
}
