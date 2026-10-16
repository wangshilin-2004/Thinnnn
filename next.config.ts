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
};

export default nextConfig;
