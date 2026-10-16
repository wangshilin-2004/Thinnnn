import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 默认忽略清单：构建产物、依赖、以及 drizzle 自动生成的 SQL/快照
  //
  // .next-build/** 是给 next.config.ts 的 NEXT_DIST_DIR 用的备选产物目录。
  // 教训：加了这个目录却忘了加进忽略清单，`npm run lint` 会去扫构建产物，
  // 报出 8153 个问题、其中 500 个 error —— 而你的代码一行没错。
  // 忽略清单和构建目录是**一对**，加一个必须加另一个。
  globalIgnores([
    '.next/**',
    '.next-build/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    'drizzle/**',
    'tests/**',
  ]),
]);

export default eslintConfig;
