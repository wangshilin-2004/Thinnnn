/**
 * Tailwind CSS v4 的接入方式与 v3 完全不同：
 *
 *   v3：postcss.config.js 里写 `tailwindcss: {}` + 一个 tailwind.config.js
 *   v4：postcss.config.mjs 里写 `@tailwindcss/postcss: {}`，且不再需要
 *       tailwind.config.js —— 所有主题配置写在 CSS 里（见 src/app/globals.css 的 @theme）
 *
 * 少一个配置文件，也少一处「改了 config 但没生效」的困惑来源。
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
