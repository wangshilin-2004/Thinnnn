import type { MetadataRoute } from 'next';

/**
 * Web App Manifest —— 「添加到主屏幕」时系统读的就是这个文件。
 *
 * Next.js 的约定：放一个 `manifest.ts` 在 app/ 下，它会自动编译成
 * /manifest.webmanifest 并在 <head> 里插好 <link rel="manifest">。
 * 不需要手动写 link 标签，也不需要往 public/ 里丢静态 json。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '轻记 · 体重与饮食可视化',
    // short_name 是图标下面显示的那几个字。iOS/Android 都会在装不下时截断，
    // 所以它必须比 name 短得多 —— 这里只留品牌名。
    short_name: '轻记',
    description: '把体重和吃进去的东西记在同一条时间轴上，看清减脂到底发生了什么。',
    lang: 'zh-CN',

    // start_url 用 /dashboard 而不是 /：
    // 从主屏幕点开是要「用工具」，不是「再看一遍首页宣传」。
    // 未登录时 /dashboard 会 307 到 /login，这条链路已经在生产模式实测过。
    start_url: '/dashboard',
    scope: '/',

    // standalone = 去掉 Safari 的地址栏和工具栏，看起来就是个 App。
    display: 'standalone',
    orientation: 'portrait',

    // background_color 是启动瞬间那张白/黑底的颜色（iOS 用图标 + 这个色拼启动图）。
    // 必须和 globals.css 的 --color-canvas 深色值一致，否则打开时会闪一下白屏。
    background_color: '#000000',
    theme_color: '#000000',

    // 分类只是给应用商店/桌面做归类的提示，浏览器不强制使用。
    categories: ['health', 'fitness', 'lifestyle'],

    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // maskable 是给 Android 用的：系统会自己裁形状（圆的、方的、水滴形），
      // 所以这张图必须留出安全边距，否则折线末端会被裁掉。
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
