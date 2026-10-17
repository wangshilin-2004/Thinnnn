import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // 允许用环境变量把构建产物写到别的地方。
  //
  // 为什么需要：`next dev` 和 `next build` 默认**都写 .next/**，
  // 同时跑会互相破坏（构建会把 dev 的增量编译状态覆盖掉，
  // 表现为热更新失灵或者直接 500）。
  // 于是「验证生产构建」和「保持本地服务可用」变成二选一。
  //
  // 有了这个开关，验证时用 NEXT_DIST_DIR=.next-build，
  // 构建产物落到另一个目录，本地开发服务器一秒都不用停。
  distDir: process.env.NEXT_DIST_DIR ?? '.next',

  // 关掉左下角那个开发指示器小气泡。
  // 它本身无害，但会**遮住页面底部内容** —— 而我的目视验收流程是
  // 用 cdp.mjs 截图然后看图，那个气泡正好压在免责声明和底部导航上，
  // 让人分不清「被气泡挡住」和「被布局挤掉了」。
  // 遮挡导致验收不可信，比少一个调试入口的代价大。
  devIndicators: false,

  // ────────────────────────────────────────────────────────────
  // ADR-007：先部署到 Vercel（本文件保持默认即可）。
  // 将来迁移到自建服务器时，把下面这行解开注释，
  // `next build` 会额外产出一个 .next/standalone 目录——
  // 里面是「只带运行时必需文件」的精简版，可以直接塞进 Docker 镜像。
  // 现在不解开，是因为它会让本地构建多产出一份无用目录。
  // ────────────────────────────────────────────────────────────
  // output: 'standalone',

  experimental: {
    // Server Actions 默认只允许 1MB 请求体。
    // 我们在 P1 阶段不会有文件上传，但饮食记录将来可能带照片，先留出余量。
    serverActions: { bodySizeLimit: '2mb' },
  },

  // ────────────────────────────────────────────────────────────
  // 安全响应头。
  //
  // 为什么放这里而不是 middleware：headers() 是**静态配置**，在
  // 边缘层就加上了，不消耗函数执行时间，也不会因为 middleware 里
  // 某次判断失误而漏掉某个路径。
  //
  // 部署后实测发现线上**只有 HSTS**（Vercel 自动加的），
  // X-Content-Type-Options / Referrer-Policy / X-Frame-Options
  // 全都是没有的 —— Next.js 不会自动加这些，得自己声明。
  // ────────────────────────────────────────────────────────────
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // 禁止浏览器「猜」响应类型。没有它，一个内容其实是 HTML
          // 的响应可能被浏览器当页面执行（MIME sniffing）。
          { key: 'X-Content-Type-Options', value: 'nosniff' },

          // 不让别的站点把我们嵌进 iframe —— 防点击劫持。
          // 本站没有任何需要被嵌入的场景，所以直接 DENY 而非 SAMEORIGIN。
          { key: 'X-Frame-Options', value: 'DENY' },

          // 跨站跳转时只带域名，不带完整路径。
          // 认证回调的 URL 里可能带 token，别把它漏给第三方。
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

          // 明确关掉用不到的能力。
          // 不声明的意思不是「禁用」，而是「没限制」。
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

/*
 * ── 关于 Content-Security-Policy：故意没加 ──
 *
 * CSP 是防 XSS 最有用的一道防线，但 Next.js 的 App Router 会在 HTML 里
 * 内联一批启动脚本（hydration 用）。没有 nonce 机制的话，CSP 里必须写
 * script-src 'unsafe-inline' —— 而它恰恰放行了内联脚本，等于把 CSP 最想
 * 防的那类攻击又放开，只剩心理安慰。
 *
 * 真要上 CSP，得做 nonce 传递：middleware 生成随机 nonce → 写进请求头 →
 * Next.js 读出来塞进每个 script 标签。改动面不小，且要逐个确认内联点。
 *
 * 结论：宁可不加，也不要加一个看起来有、实际上漏的 CSP。
 * 真要做，单独立一个任务，别混在日常提交里。
 */

export default nextConfig;
