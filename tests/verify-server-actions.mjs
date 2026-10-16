#!/usr/bin/env node
/* 检查 'use server' 文件有没有导出非 async 函数的东西。
 *
 * 为什么需要这个检查：Next 规定 'use server' 文件只能导出 async 函数，
 * 违反时的报错发生在**模块求值**阶段 —— 也就是真正调用那个 action 的瞬间。
 * 结果是三重防线全部失灵：
 *
 *   - 页面 GET 返回 200（渲染不加载 actions 模块）
 *   - `next build` 通过（构建不执行 actions 模块）
 *   - `tsc --noEmit` 通过（这是运行时约束，不是类型约束）
 *
 * 只有用户点了那个按钮才会 500。我在 login/actions.ts 上实测撞到过一次：
 * 导出 `LOGIN_INITIAL` 这个对象，导致「发登录链接」按钮直接把页面打进错误边界，
 * 登录功能整体不可用 —— 而 build / typecheck / 首屏全绿。
 *
 * 所以这个坑必须用静态扫描兜住，不能指望哪一层自动发现。
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/* 必须用 fileURLToPath 而不是 new URL(...).pathname：
 * 本仓库路径里有中文，pathname 会给出百分号编码的
 * `.../%E5%B0%8F%E7%82%B9%E5%AD%90/src`，readdirSync 直接 ENOENT。 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

/** 递归收集 src/ 下所有 .ts/.tsx。 */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walk(p, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/* 判断一个文件是不是 'use server' 模块。
 * 指令必须是文件的第一条语句，但前面允许有注释与空行，所以逐行找第一个
 * 非空、非注释的行来判断。 */
function isUseServer(src) {
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) continue;
    return /^['"]use server['"];?$/.test(line);
  }
  return false;
}

/* 找出所有顶层 export，并判断它是不是「异步函数」或「类型」。
 *
 * 用逐行正则而不是解析器：这里要拦的是很粗的一类错误（导出了值），
 * 假阴性风险远大于假阳性。真解析器要引依赖，而这是个零依赖的校验脚本。 */
const ALLOWED = [
  /^export\s+async\s+function\s+\w+/, // 唯一的合法形式
  /^export\s+type\s+\w+/, // 编译后消失，不产生运行时导出
  /^export\s+interface\s+\w+/, // 同上
];

const BAD_PATTERNS = [
  { re: /^export\s+(const|let|var)\s+(\w+)/, what: '导出了变量/对象' },
  { re: /^export\s+function\s+(\w+)/, what: '导出了同步函数（Next 要求 async）' },
  { re: /^export\s+class\s+(\w+)/, what: '导出了 class' },
  { re: /^export\s+enum\s+(\w+)/, what: '导出了 enum（运行时会产生对象）' },
  { re: /^export\s+default\b/, what: '导出了 default' },
  { re: /^export\s+\{/, what: '用了 export { } 列表（无法静态判断，请改成直接导出 async 函数）' },
  { re: /^export\s+\*\s+from/, what: '用了 export * from（会带出未知导出）' },
];

const files = walk(SRC).filter((f) => isUseServer(readFileSync(f, 'utf8')));
const problems = [];
let checked = 0;

for (const file of files) {
  const src = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file);
  const lines = src.split('\n');

  /* export 必须顶格写（模板字符串里的 export 前面有缩进，不会误伤）。
   * 这也是这个方案够用的原因：'use server' 文件里的导出本来就该顶格。 */
  lines.forEach((line, i) => {
    if (!line.startsWith('export')) return;
    checked++;
    if (ALLOWED.some((re) => re.test(line))) return;
    for (const { re, what } of BAD_PATTERNS) {
      const m = line.match(re);
      if (m) {
        problems.push({ file: rel, line: i + 1, what, text: line.trim().slice(0, 70) });
        return;
      }
    }
    problems.push({ file: rel, line: i + 1, what: '未知的导出形式', text: line.trim().slice(0, 70) });
  });
}

/* ── 第二遍：每个导出的 action 到底有没有入口 ────────────────────────
 *
 * 为什么值得单独查：'use server' 的导出不只是「一个函数」，它是一个
 * **可以从浏览器 POST 到的公开写接口**。没有调用方 = 一个没有界面入口、
 * 却对外开着的写接口，而且没人会因为改动它而跑测试。
 *
 * 真实案例：updateMealQuantity 就这样躺了很久 —— 实现是完整的（有 zod、
 * 有 requireUser、有 RLS），只是从来没接到界面上。用户记错份量时唯一的
 * 办法是删掉重记。这种「写完忘了接线」在单人项目里几乎必然发生。
 *
 * 已知局限：这是按名字在**全文**里找，注释里提一句也算「有调用方」。
 * 够用 —— 要抓的是「一处都没有」，那种情况下连注释都不会提它。
 */
const allSources = walk(SRC).map((f) => [f, readFileSync(f, 'utf8')]);
const orphans = [];

for (const file of files) {
  const src = allSources.find(([f]) => f === file)[1];
  for (const m of src.matchAll(/^export\s+async\s+function\s+(\w+)/gm)) {
    const name = m[1];
    if (name === 'default') continue;
    const re = new RegExp(`\\b${name}\\b`);
    const callers = allSources.filter(([f, s]) => f !== file && re.test(s));
    if (callers.length === 0) orphans.push({ file: relative(ROOT, file), name });
  }
}

console.log(`\n  扫描了 ${files.length} 个 'use server' 文件，共 ${checked} 条顶层导出`);
for (const f of files) console.log(`    · ${relative(ROOT, f)}`);

if (orphans.length) {
  console.log(`\n  ✗ ${orphans.length} 个 action 没有任何调用方（等于没有入口的公开写接口）：\n`);
  for (const o of orphans) {
    console.log(`    ${o.file}`);
    console.log(`      ${o.name}()\n`);
  }
  console.log('  要么把它接到界面上，要么删掉。');
  console.log('  确实需要留着（比如给将来的界面预留），就在别处引用一次并写清原因。\n');
  process.exit(1);
}

if (problems.length) {
  console.log(`\n  ✗ 发现 ${problems.length} 处违规：\n`);
  for (const p of problems) {
    console.log(`    ${p.file}:${p.line}`);
    console.log(`      ${p.what}`);
    console.log(`      ${p.text}\n`);
  }
  console.log('  \'use server\' 文件只能导出 async 函数。');
  console.log('  常量/类型请挪到同目录的 state.ts 之类的普通模块里。\n');
  process.exit(1);
}

console.log('\n  ✓ 全部合规：只导出了 async 函数与类型\n');
