#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────────────────
 * 鉴权边界检查（HTTP 层）
 *
 * 为什么需要这个脚本：
 *
 *   `npm run db:verify` 证明的是「数据库不会把别人的行给我」。
 *   但还有另一件事它测不到：**未登录的请求能不能打开受保护的页面。**
 *
 *   这两件事是独立的。RLS 写得再严，只要某个 page.tsx 忘了写
 *   `await requireUser()`，那个页面就会正常渲染 —— 可能渲染出一堆 0、
 *   也可能直接报错，但**它返回的是 200**。从外面看就是「这个页面是公开的」。
 *
 *   这个错误没有任何其他机制能拦住：
 *     · typecheck 不知道哪些页面该受保护
 *     · eslint 不知道
 *     · db:verify 在数据库层，看不到 HTTP
 *
 *   所以只能真的起一个生产服务、真的发一次没带 cookie 的请求。
 *
 * 为什么【不】放进 `npm run verify`：
 *
 *   它需要一份生产构建产物（`next build`，40 秒左右），而且会占用一个端口。
 *   混进日常检查里，某天构建产物过期或端口被占就会失败，
 *   久了大家就不信这个命令了。跟 db:verify:hosted 是同一个理由。
 *
 * 用法：
 *   NEXT_DIST_DIR=.next-build npx next build     # 先构建（改了代码就要重来）
 *   npm run auth:verify                           # 再跑这个
 * ──────────────────────────────────────────────────────────────────────────── */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = process.env.BOUNDARY_PORT ?? '3457';
const BASE = `http://127.0.0.1:${PORT}`;
const BUILD_DIR = '.next-build';

/* 未登录时必须被弹走的路径。
 * 加新页面时记得往这里补一行 —— 这是这个脚本唯一需要人工维护的地方。 */
const PROTECTED = ['/dashboard', '/trends', '/log/meal', '/onboarding', '/settings'];

/* 公开路径：这些必须能打开，否则就是「锁死所有人」而不是「挡住外人」 */
const PUBLIC = [
  ['/', 200],
  ['/login', 200],
  ['/nope-404', 404],
];

let passed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failures.push(`${name}${detail ? ' —— ' + detail : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? ' —— ' + detail : ''}`);
  }
}

if (!existsSync(`${BUILD_DIR}/BUILD_ID`)) {
  console.error(
    `\n找不到 ${BUILD_DIR}/BUILD_ID —— 需要先构建：\n\n` +
      `  NEXT_DIST_DIR=${BUILD_DIR} npx next build\n`,
  );
  process.exit(1);
}

const buildId = readFileSync(`${BUILD_DIR}/BUILD_ID`, 'utf8').trim();
console.log(`\n生产构建 BUILD_ID = ${buildId}`);
console.log(`在 ${BASE} 起一个临时服务，发不带 cookie 的请求。\n`);

const server = spawn('npx', ['next', 'start', '-p', PORT], {
  env: { ...process.env, NEXT_DIST_DIR: BUILD_DIR },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (d) => (serverLog += d));
server.stderr.on('data', (d) => (serverLog += d));

function cleanup() {
  if (!server.killed) server.kill('SIGTERM');
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

/* 等端口起来。不是死等固定秒数 —— 机器忙的时候 3 秒不够，
 * 空闲的时候等 15 秒又是白等。 */
let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(500);
  try {
    const r = await fetch(`${BASE}/login`, { redirect: 'manual' });
    if (r.status > 0) { ready = true; break; }
  } catch { /* 还没起来 */ }
}

if (!ready) {
  console.error('服务 30 秒内没起来。它自己的输出：\n');
  console.error(serverLog.split('\n').slice(-25).join('\n'));
  cleanup();
  process.exit(1);
}

/* ── 受保护路径：必须是 307，且指向 /login ── */
console.log('受保护路径（未登录时必须弹回登录页）');
for (const path of PROTECTED) {
  /* redirect:'manual' 是关键 —— 默认的 fetch 会自己跟着跳转，
   * 那样拿到的永远是终点页的 200，这个测试就变成了永远绿的。 */
  const res = await fetch(BASE + path, { redirect: 'manual' });
  const loc = res.headers.get('location') ?? '';
  check(
    `${path} → ${res.status}${loc ? ' ' + loc : ''}`,
    res.status === 307 && loc.includes('/login'),
    res.status === 200
      ? '❗ 返回了 200 —— 这个页面没有 requireUser()，任何人打开都能看到'
      : res.status === 500
        ? '返回 500，多半是数据库连不上（这时重定向还没发生就抛了）'
        : `期望 307 且 Location 含 /login，实际 ${res.status} ${loc}`,
  );
}

/* ── 公开路径：不能把所有人都挡在外面 ── */
console.log('\n公开路径（这些必须能打开）');
for (const [path, want] of PUBLIC) {
  const res = await fetch(BASE + path, { redirect: 'manual' });
  check(`${path} → ${res.status}`, res.status === want, `期望 ${want}`);
}

/* ── 带 cookie 但不合法：不能因为「有 cookie」就放行 ── */
console.log('\n伪造会话（不能让一个乱写的 cookie 混进去）');
for (const path of ['/dashboard', '/settings']) {
  const res = await fetch(BASE + path, {
    redirect: 'manual',
    headers: { cookie: 'sb-ctxpmzloverrwgevoqbb-auth-token=not-a-real-session' },
  });
  check(`${path} → ${res.status}（伪造 cookie 无效）`, res.status === 307, `实际 ${res.status}`);
}

cleanup();

console.log('\n' + '─'.repeat(64));
if (failures.length) {
  console.log(`\x1b[31m\x1b[1m${failures.length} 项失败\x1b[0m`);
  for (const f of failures) console.log('  · ' + f);
  process.exit(1);
}
console.log(`\x1b[32m\x1b[1m全部通过：${passed} 项断言\x1b[0m`);
console.log('─'.repeat(64) + '\n');
