// Supabase 仿真层 + 迁移装载器 —— 测试（tests/verify-migrations.mjs）与
// 本地开发库（scripts/dev-db.mjs）共用。
//
// 为什么要共用：这套东西一旦有两份拷贝，就会出现「测试里过了、本地库跑不起来」
// 这类最难查的漂移。仿真层只有一份定义，两边行为才一致。
//
// 仿真层造的东西，在真实 Supabase 项目里是**项目创建时就已经存在**的：
// auth schema、auth.users 表、anon / authenticated 两个角色、auth.uid()。
// 迁移脚本可以直接用它们，所以脱离 Supabase 跑迁移就得自己补上。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/* 尽量贴近真实定义 —— 造得不像，「通过」就没有意义。
 * 比如 auth.uid() 这里用的是 Supabase 官方那段实现，不是我自己编的。 */
export const SUPABASE_SHIM = `
  create schema if not exists auth;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );

  -- 写成幂等的：本地开发库是持久化的，重启时会再跑一遍这段
  do $$
  begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
      create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
      create role authenticated nologin;
    end if;
  end
  $$;

  create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $fn$;
`;

/** 读 drizzle 的 journal，拿到按顺序排列的迁移文件清单。
 *
 * 为什么读 journal 而不是硬编码文件名：硬编码的话，以后加了 0005 却忘了改
 * 这个列表，本地库就会悄悄少一张表，而测试可能仍然全过。 */
export function loadMigrations(root) {
  const journal = JSON.parse(
    readFileSync(join(root, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  );
  return journal.entries
    .slice()
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = readFileSync(join(root, 'drizzle', `${entry.tag}.sql`), 'utf8');
      // 和 drizzle-kit migrate 用同一个分隔规则，保证跑的是同一批语句
      const statements = sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      return { tag: entry.tag, idx: entry.idx, statements };
    });
}

/** 把全部迁移按顺序执行到给定连接上。返回已执行的 tag 列表。 */
export async function applyAllMigrations(db, root, onProgress) {
  await db.exec(SUPABASE_SHIM);
  const applied = [];
  for (const m of loadMigrations(root)) {
    for (const stmt of m.statements) await db.exec(stmt);
    applied.push(m.tag);
    onProgress?.(m);
  }
  return applied;
}
