#!/usr/bin/env node
// 本地开发数据库：PGlite（编译成 WASM 的 PostgreSQL 17）跑在 Node 里，
// 再用 PGLiteSocketServer 把它暴露成**真的 Postgres 网络端口**。
//
// 为什么这么做：
//   1. 不需要 Docker、不需要 brew install postgresql —— 那些路在本机沙箱下都断了。
//   2. 应用连的是真 Postgres 协议端口，所以 `src/db` 里的代码、
//      postgres.js 驱动、drizzle 全都不需要为「本地」写特例分支。
//   3. 顺带把 ADR-007 那个「换数据库只改 DATABASE_URL」的说法当场验证掉：
//      如果本地库能跑、Supabase 也能跑，说明确实没有绑定。
//
// 用法：
//   node scripts/dev-db.mjs            启动（持久化到 .pglite/）
//   node scripts/dev-db.mjs --reset    先删库再启动
//
// 端口 55432，故意不用 5432 —— 免得哪天本机真装了个 Postgres 撞端口。

import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { SUPABASE_SHIM, loadMigrations } from './db-shim.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, '.pglite');
const PORT = Number(process.env.DEV_DB_PORT || 55432);
const HOST = '127.0.0.1';

if (process.argv.includes('--reset')) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('已删除 .pglite/，将重建');
}

console.log(`启动 PGlite…${existsSync(DATA_DIR) ? '（复用已有数据）' : '（首次创建）'}`);
const db = new PGlite(DATA_DIR);
await db.waitReady;

// ── 建 Supabase 仿真层 + 按 journal 顺序补跑迁移 ──────────────────────────
await db.exec(SUPABASE_SHIM);

/* 自己记一张已应用表，而不是复用 drizzle 的 __drizzle_migrations。
 * 原因：本地库是我用 PGlite API 直接喂 SQL 的，而 drizzle-kit migrate
 * 记的是它自己的 hash 格式。硬去伪造那张表只会让人以为本地和线上状态一致，
 * 实际不一致 —— 不如老实记自己的账，并在启动时把差异打出来。 */
await db.exec(`
  create table if not exists dev_applied_migrations (
    tag text primary key,
    applied_at timestamptz not null default now()
  );
`);

const done = new Set(
  (await db.query('select tag from dev_applied_migrations')).rows.map((r) => r.tag),
);
const pending = loadMigrations(ROOT).filter((m) => !done.has(m.tag));

if (pending.length === 0) {
  console.log(`迁移已是最新（${done.size} 个）`);
} else {
  for (const m of pending) {
    for (const stmt of m.statements) await db.exec(stmt);
    await db.query('insert into dev_applied_migrations (tag) values ($1)', [m.tag]);
    console.log(`  ✓ ${m.tag}（${m.statements.length} 条语句）`);
  }
}

const counts = await db.query(`
  select
    (select count(*) from public.foods)          as foods,
    (select count(*) from public.food_servings)  as servings,
    (select count(*) from public.profiles)       as profiles
`);
const c = counts.rows[0];
console.log(`数据：foods=${c.foods}  food_servings=${c.servings}  profiles=${c.profiles}`);

// ── 暴露成 Postgres 端口 ──────────────────────────────────────────────────
/* maxConnections 默认是 1，对 Next.js 太紧：开发时 HMR 会留下旧连接，
 * 页面并发请求也会同时要连接。PGlite 内部本来就按查询排队，
 * 所以多开几条连接是安全的，只是并发执行仍然是串行的。 */
const server = new PGLiteSocketServer({
  db, port: PORT, host: HOST, maxConnections: 12,
});
await server.start();

const URL = `postgresql://postgres:postgres@${HOST}:${PORT}/postgres`;
console.log(`
──────────────────────────────────────────────────────────
  本地开发库已就绪（真 PostgreSQL 17 引擎）
  ${URL}

  在 .env.development.local 里写：
  DATABASE_URL="${URL}"
  DIRECT_URL="${URL}"
──────────────────────────────────────────────────────────
Ctrl-C 停止。数据在 .pglite/，删掉即可重来（或跑 --reset）。
`);

const bye = async () => {
  console.log('\n正在关闭…');
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
