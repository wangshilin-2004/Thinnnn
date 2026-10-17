/**
 * ═══════════════════════════════════════════════════════════════════════
 *  迁移验证：把 drizzle/ 下的真实迁移文件跑一遍
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  运行：npm run db:verify
 *
 *  【这个脚本和普通单元测试的区别】
 *  它不测"我以为的 schema"，它测【真正会被部署的那两个 .sql 文件】。
 *
 *  为什么这很重要：一个只在 TS 里描述、从未在真 Postgres 上执行过的
 *  schema，和"能部署"之间隔着十万八千里。这里的断言每一条都对应一个
 *  会真实发生的线上事故：
 *
 *    · 漏了 GRANT          → 上线第一天所有查询 42501
 *    · 触发器用了 EXCLUDED → 每次记一顿饭就把当天体重清空
 *    · 改日期只重算一天     → 历史热量永远多算
 *    · RLS 没生效          → 朋友能看到你的体重（隐私事故）
 *    · 部分唯一索引写错     → 一个新用户连第二条份量都存不进去
 *
 *  【为什么用 PGlite】
 *  @electric-sql/pglite 是把 PostgreSQL 17 编译成 WebAssembly 的 npm 包，
 *  `npm i` 即得 —— 不需要 Docker、不需要 brew install postgres。
 *  跑的是真引擎（真 parser、真 planner、真 RLS 实现），
 *  唯一的差别是它默认单连接、且我们自建的角色没有 Supabase 那些预置权限
 *  —— 而这个"差别"恰好帮我们抓到了 GRANT 漏洞（见 docs/04 §11.2）。
 */

import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── 断言计数器 ────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? `  → ${detail}` : ''}`);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `  \x1b[31m${detail}\x1b[0m` : ''}`);
  }
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

const db = new PGlite();

// ═══════════════════════════════════════════════════════════════════════
//  0. 搭一个最小的「Supabase 仿真层」
// ═══════════════════════════════════════════════════════════════════════
//  真实 Supabase 项目里，下面这些东西在项目创建时就已经存在了，
//  迁移脚本可以直接用。PGlite 里是空的，所以要自己造。
//
//  注意：造得【尽量贴近真实定义】，否则测出来的"通过"没有意义。
//  比如 auth.uid() 这里用的就是 Supabase 官方的那段实现。

await db.exec(`
  create schema if not exists auth;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    created_at timestamptz not null default now()
  );

  -- Supabase 预置的两个角色
  create role anon nologin;
  create role authenticated nologin;

  -- 真实 Supabase 里 anon 默认就持有 public 的 USAGE —— PostgREST 以 anon
  -- 身份调用 RPC 时靠它才能解析函数名。这里必须补上，否则 0008 的
  -- 「未登录也能校验邀请码」会在本地假失败（线上其实是通的）。
  grant usage on schema public to anon;

  -- auth.uid() 的真实实现：从 JWT claims 里取 sub
  create or replace function auth.uid() returns uuid
  language sql stable
  as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    )::uuid
  $$;
`);

// ═══════════════════════════════════════════════════════════════════════
//  1. 按顺序执行真实迁移文件
// ═══════════════════════════════════════════════════════════════════════

section('【A】执行真实迁移文件');

function runMigration(file) {
  const sql = readFileSync(join(ROOT, 'drizzle', file), 'utf8');
  // drizzle 用 `--> statement-breakpoint` 分隔语句，实测这里照做，
  // 确保我们跑的和 drizzle-kit migrate 跑的是同一批语句。
  const statements = sql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
  return statements;
}

const statements0000 = runMigration('0000_init_tables.sql');
const statements0001 = runMigration('0001_security_and_triggers.sql');
const statements0002 = runMigration('0002_add_slug_and_label_uniqueness.sql');
const statements0003 = runMigration('0003_seed_foods.sql');
const statements0004 = runMigration('0004_foods_integrity_checks.sql');
const statements0005 = runMigration('0005_harden_grants_and_cascade_fix.sql');
const statements0006 = runMigration('0006_summary_target_snapshot.sql');
const statements0007 = runMigration('0007_fix_account_deletion.sql');
const statements0008 = runMigration('0008_invite_codes_consume.sql');

let migrationError = null;
try {
  for (const stmt of statements0000) await db.exec(stmt);
  console.log(`  · 0000_init_tables.sql 执行完成（${statements0000.length} 条语句）`);

  for (const stmt of statements0001) await db.exec(stmt);
  console.log(`  · 0001_security_and_triggers.sql 执行完成（${statements0001.length} 条语句）`);

  for (const stmt of statements0002) await db.exec(stmt);
  console.log(`  · 0002_add_slug_and_label_uniqueness.sql 执行完成（${statements0002.length} 条语句）`);

  for (const stmt of statements0003) await db.exec(stmt);
  console.log(`  · 0003_seed_foods.sql 执行完成（${statements0003.length} 条语句）`);

  for (const stmt of statements0004) await db.exec(stmt);
  console.log(`  · 0004_foods_integrity_checks.sql 执行完成（${statements0004.length} 条语句）`);

  for (const stmt of statements0005) await db.exec(stmt);
  console.log(`  · 0005_harden_grants_and_cascade_fix.sql 执行完成（${statements0005.length} 条语句）`);

  for (const stmt of statements0006) await db.exec(stmt);
  console.log(`  · 0006_summary_target_snapshot.sql 执行完成（${statements0006.length} 条语句）`);

  for (const stmt of statements0007) await db.exec(stmt);
  console.log(`  · 0007_fix_account_deletion.sql 执行完成（${statements0007.length} 条语句）`);

  for (const stmt of statements0008) await db.exec(stmt);
  console.log(`  · 0008_invite_codes_consume.sql 执行完成（${statements0008.length} 条语句）`);
} catch (e) {
  migrationError = e;
}

check(
  '八个迁移文件都能在真 Postgres 上按序跑通',
  migrationError === null,
  migrationError ? `${migrationError.message}` : '',
);

if (migrationError) {
  console.error('\n\x1b[31m迁移执行失败，后续断言无法进行。\x1b[0m');
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════
//  2. 结构断言
// ═══════════════════════════════════════════════════════════════════════

section('【B】表结构与外键');

const EXPECTED_TABLES = [
  'profiles',
  'foods',
  'food_servings',
  'meal_items',
  'measurements',
  'daily_summary',
  'food_favorites',
  'invite_codes',
];

const { rows: tableRows } = await db.query(`
  select tablename from pg_tables where schemaname = 'public' order by tablename
`);
const actualTables = tableRows.map((r) => r.tablename);
check(
  `8 张业务表全部建成（实际 ${actualTables.length} 张）`,
  EXPECTED_TABLES.every((t) => actualTables.includes(t)),
  `缺少：${EXPECTED_TABLES.filter((t) => !actualTables.includes(t)).join(', ')}`,
);

check(
  'auth.users 没有被迁移脚本创建（应由 Supabase 提供）',
  !actualTables.includes('users'),
  '迁移脚本里出现了 auth.users —— 会在真实 Supabase 上撞车',
);

// 指向 auth.users 的外键
const { rows: fkRows } = await db.query(`
  select conrelid::regclass::text as tbl, conname
  from pg_constraint
  where contype = 'f' and confrelid = 'auth.users'::regclass
  order by tbl
`);
const fkTables = fkRows.map((r) => r.tbl.replace(/^public\./, '').replace(/"/g, ''));
const EXPECTED_FK_TABLES = [
  'daily_summary',
  'food_favorites',
  'foods',
  'meal_items',
  'measurements',
  'profiles',
];
check(
  `6 个指向 auth.users 的外键存在（实际 ${fkRows.length} 个）`,
  EXPECTED_FK_TABLES.every((t) => fkTables.includes(t)),
  `缺少：${EXPECTED_FK_TABLES.filter((t) => !fkTables.includes(t)).join(', ')}`,
);

check(
  '外键都是 ON DELETE CASCADE（删账号时数据跟着清）',
  fkRows.length === 6 &&
    (
      await db.query(`
        select count(*)::int c from pg_constraint
        where contype='f' and confrelid='auth.users'::regclass and confdeltype='c'
      `)
    ).rows[0].c === 6,
);

// RLS 是否全部开启
const { rows: rlsRows } = await db.query(`
  select relname, relrowsecurity from pg_class
  where relnamespace = 'public'::regnamespace and relkind = 'r'
  order by relname
`);
const rlsOff = rlsRows.filter((r) => !r.relrowsecurity).map((r) => r.relname);
check(
  '8 张表全部开启了 RLS（漏一张就是一次数据泄露）',
  rlsOff.length === 0,
  `未开启：${rlsOff.join(', ')}`,
);

// 策略数量
const { rows: policyRows } = await db.query(`
  select tablename, count(*)::int c from pg_policies
  where schemaname = 'public' group by tablename order by tablename
`);
const policyCount = Object.fromEntries(policyRows.map((r) => [r.tablename, r.c]));
check(
  'meal_items 四类操作各有策略（select/insert/update/delete）',
  policyCount.meal_items === 4,
  `实际 ${policyCount.meal_items}`,
);
check(
  'daily_summary 只有 1 条策略（只读，客户端写不进）',
  policyCount.daily_summary === 1,
  `实际 ${policyCount.daily_summary}`,
);
check(
  'invite_codes 一条策略都没有（deny by default）',
  policyCount.invite_codes === undefined,
  `实际 ${policyCount.invite_codes}`,
);

// ═══════════════════════════════════════════════════════════════════════
//  3. 约束断言
// ═══════════════════════════════════════════════════════════════════════

section('【C】约束');

//  ⚠️ 这是一条【测试夹具】，不是内置食物。
//
//  它以 postgres 超级用户身份运行，所以 owner_id 留 NULL 也不会被 RLS 拦 ——
//  结果就是它长得像一条"对所有人可见的内置食物"。
//
//  两条纪律（都由一次真实的断言失败换来）：
//    ① 必须给 slug —— 迁移 0004 的 foods_builtin_needs_slug 会拒绝
//       "owner_id IS NULL 且 slug IS NULL" 的行，因为那种行没有稳定身份，
//       种子数据永远无法重新导入它
//    ② 统计内置食物时要用 `source = 'builtin'`（种子数据写入的值），
//       而不是 `owner_id is null`（会被这条夹具污染）
const food = (
  await db.query(
    `insert into public.foods (name, category, kcal, slug)
     values ('测试用米饭','谷薯',116,'test-fixture-rice') returning id`,
  )
).rows[0].id;

await db.query(
  `insert into public.food_servings (food_id,label,grams,is_default) values ($1,'1碗',150,true)`,
  [food],
);

let dupBlocked = false;
try {
  await db.query(
    `insert into public.food_servings (food_id,label,grams,is_default) values ($1,'1大碗',250,true)`,
    [food],
  );
} catch (e) {
  dupBlocked = e.message.includes('food_servings_one_default') || e.message.includes('duplicate');
}
check('部分唯一索引拦住第二个「默认份量」', dupBlocked);

let multiNonDefault = true;
try {
  await db.query(
    `insert into public.food_servings (food_id,label,grams,is_default) values ($1,'1小碗',100,false)`,
    [food],
  );
  await db.query(
    `insert into public.food_servings (food_id,label,grams,is_default) values ($1,'1大碗',250,false)`,
    [food],
  );
} catch {
  multiNonDefault = false;
}
check('多个「非默认份量」不被误拦（证明是部分索引而非普通唯一约束）', multiNonDefault);

let kcalBlocked = false;
try {
  await db.query(`insert into public.foods (name,category,kcal) values ('坏数据','油脂',1500)`);
} catch {
  kcalBlocked = true;
}
check('kcal > 900 被 CHECK 拦住（防「每份」填进「每100g」列）', kcalBlocked);

let mealTypeBlocked = false;
try {
  await db.query(`
    insert into public.meal_items (user_id,log_date,meal_type,food_name,quantity_g,kcal)
    values (gen_random_uuid(),'2026-10-16','brunch','x',100,100)
  `);
} catch {
  mealTypeBlocked = true;
}
check('非法 meal_type 被 CHECK 拦住', mealTypeBlocked);

// ═══════════════════════════════════════════════════════════════════════
//  4. 触发器断言
// ═══════════════════════════════════════════════════════════════════════

section('【D】触发器');

const u1 = (await db.query(`insert into auth.users (email) values ('u1@test.com') returning id`))
  .rows[0].id;
const u2 = (await db.query(`insert into auth.users (email) values ('u2@test.com') returning id`))
  .rows[0].id;

const { rows: profileRows } = await db.query(`select count(*)::int c from public.profiles`);
check(
  '注册时自动建 profiles（AFTER INSERT ON auth.users 触发器可用）',
  profileRows[0].c === 2,
  `实际 ${profileRows[0].c} 行`,
);

// 预置当天的体重和目标（模拟用户早上称过体重、设过目标）
await db.query(
  `insert into public.daily_summary (user_id,log_date,target_kcal) values ($1,'2026-10-16',1800)`,
  [u1],
);

// 插入两条饮食记录
await db.query(`
  insert into public.meal_items (user_id,log_date,meal_type,food_name,quantity_g,kcal,protein_g,fat_g,carb_g)
  values ($1,'2026-10-16','lunch','白米饭',200,232,4.8,0.6,51.6)
`, [u1]);
await db.query(`
  insert into public.meal_items (user_id,log_date,meal_type,food_name,quantity_g,kcal,protein_g,fat_g,carb_g)
  values ($1,'2026-10-16','lunch','鸡胸肉',150,198,34.5,4.3,0)
`, [u1]);

let s = (
  await db.query(
    `select * from public.daily_summary where user_id=$1 and log_date='2026-10-16'`,
    [u1],
  )
).rows[0];

check('INSERT 触发汇总：232 + 198 = 430 kcal', Number(s.intake_kcal) === 430, `实际 ${s.intake_kcal}`);
check('汇总重算没有清空 target_kcal', Number(s.target_kcal) === 1800, `实际 ${s.target_kcal}`);
check('item_count 正确', s.item_count === 2, `实际 ${s.item_count}`);

// ── 体重同步 ──
await db.query(`
  insert into public.measurements (user_id,metric,measured_on,value,unit)
  values ($1,'weight','2026-10-16',70.5,'kg')
`, [u1]);
s = (
  await db.query(
    `select * from public.daily_summary where user_id=$1 and log_date='2026-10-16'`,
    [u1],
  )
).rows[0];
check('体重写入 measurements 后自动同步到 daily_summary', Number(s.weight_kg) === 70.5, `实际 ${s.weight_kg}`);
check(
  '体重同步没有破坏已有的热量汇总（430 应保持）',
  Number(s.intake_kcal) === 430,
  `实际 ${s.intake_kcal}`,
);

// 同一天再记一次体重。应用层走的是 ON CONFLICT DO UPDATE
//（见 src/app/(app)/log/weight/actions.ts），而上面两条只覆盖了 INSERT 和 DELETE。
// UPDATE 命中的是触发器里另一段分支（AFTER UPDATE vs AFTER INSERT），
// 只测 INSERT 会漏掉它 —— 而「发现记错了、改一下」恰恰是最高频的操作。
await db.query(`
  insert into public.measurements (user_id,metric,measured_on,value,unit)
  values ($1,'weight','2026-10-16',69.8,'kg')
  on conflict (user_id,metric,measured_on)
  do update set value = excluded.value
`, [u1]);
const weightRows = (
  await db.query(
    `select count(*)::int as n from public.measurements
     where user_id=$1 and metric='weight' and measured_on='2026-10-16'`,
    [u1],
  )
).rows[0];
s = (
  await db.query(
    `select * from public.daily_summary where user_id=$1 and log_date='2026-10-16'`,
    [u1],
  )
).rows[0];
check(
  '同一天重复记体重是覆盖而不是新增（仍为 1 行）',
  weightRows.n === 1,
  `实际 ${weightRows.n} 行`,
);
check(
  '覆盖后 daily_summary.weight_kg 同步为 69.8',
  Number(s.weight_kg) === 69.8,
  `实际 ${s.weight_kg}`,
);

// 删除体重记录 → weight_kg 应变回 NULL，但行保留
await db.query(`delete from public.measurements where user_id=$1 and metric='weight'`, [u1]);
s = (
  await db.query(
    `select * from public.daily_summary where user_id=$1 and log_date='2026-10-16'`,
    [u1],
  )
).rows[0];
check(
  '删除体重记录后 weight_kg 变回 NULL，但汇总行保留（图表不断档）',
  s !== undefined && s.weight_kg === null,
  `weight_kg=${s?.weight_kg}`,
);

// ── 改日期：两天都要重算 ──
await db.query(`
  update public.meal_items set log_date='2026-10-17'
  where user_id=$1 and food_name='鸡胸肉'
`, [u1]);

const d16 = (
  await db.query(
    `select intake_kcal from public.daily_summary where user_id=$1 and log_date='2026-10-16'`,
    [u1],
  )
).rows[0];
const d17 = (
  await db.query(
    `select intake_kcal from public.daily_summary where user_id=$1 and log_date='2026-10-17'`,
    [u1],
  )
).rows[0];
check('改日期 → 旧日期重算为 232', Number(d16.intake_kcal) === 232, `实际 ${d16.intake_kcal}`);
check('改日期 → 新日期建出 198', Number(d17?.intake_kcal) === 198, `实际 ${d17?.intake_kcal}`);

// ── 删空一天 ──
await db.query(`delete from public.meal_items where user_id=$1 and log_date='2026-10-17'`, [u1]);
const d17b = (
  await db.query(
    `select intake_kcal, item_count from public.daily_summary where user_id=$1 and log_date='2026-10-17'`,
    [u1],
  )
).rows;
check(
  '删空一天 → 汇总归零但行保留',
  d17b.length === 1 && Number(d17b[0].intake_kcal) === 0,
  JSON.stringify(d17b),
);

// ── updated_at ──
const before = (await db.query(`select updated_at from public.profiles where id=$1`, [u1])).rows[0]
  .updated_at;
await db.query(`update public.profiles set display_name='测试' where id=$1`, [u1]);
const after = (await db.query(`select updated_at from public.profiles where id=$1`, [u1])).rows[0]
  .updated_at;
check(
  'touch_updated_at 触发器生效（UPDATE 后 updated_at 前进）',
  new Date(after).getTime() >= new Date(before).getTime(),
  `${before} → ${after}`,
);

// ═══════════════════════════════════════════════════════════════════════
//  5. RLS 端到端断言（以 authenticated 角色真的跑一遍）
// ═══════════════════════════════════════════════════════════════════════
//
//  这是整个脚本最有价值的部分。
//  前面的断言都是以超级用户（postgres）身份跑的 —— 而 postgres 是表的
//  属主，【会绕过 RLS】。所以那些断言完全测不到 RLS。
//
//  这里切换到真实的 authenticated 角色 + 伪造 JWT claims，
//  走一遍用户真正会走的路径。

section('【E】RLS 与权限（以 authenticated 角色实测）');

async function actAs(userId) {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ]);
  await db.query(`set role authenticated`);
}

async function actAsAdmin() {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
}

await actAs(u1);

// ── E1: 端到端写入路径 ──
//  这一条同时证明了四件事，缺任何一件都会失败：
//    ① authenticated 对 meal_items 有 INSERT 权限（GRANT 第一道门）
//    ② WITH CHECK 通过（RLS 第二道门）
//    ③ 触发器能写 daily_summary，尽管 authenticated 只有它的 SELECT 权限
//       （SECURITY DEFINER 生效）
//    ④ REVOKE ... FROM PUBLIC 没有把触发器函数弄坏
let e2eOk = true;
let e2eErr = '';
try {
  await db.query(`
    insert into public.meal_items (user_id,log_date,meal_type,food_name,quantity_g,kcal)
    values ($1,'2026-10-18','dinner','测试餐',100,300)
  `, [u1]);
} catch (e) {
  e2eOk = false;
  e2eErr = e.message;
}
check('【端到端】authenticated 插入记录成功（GRANT + RLS + 触发器全链路）', e2eOk, e2eErr);

if (e2eOk) {
  const own = (
    await db.query(
      `select intake_kcal from public.daily_summary where user_id=$1 and log_date='2026-10-18'`,
      [u1],
    )
  ).rows;
  check(
    '【端到端】触发器写入的汇总行，authenticated 能读到自己那条',
    own.length === 1 && Number(own[0].intake_kcal) === 300,
    JSON.stringify(own),
  );
}

// ── E2: 用户隔离 ──
const otherRows = (
  await db.query(`select * from public.meal_items where user_id = $1`, [u2])
).rows;
check(
  'U1 显式查询 U2 的记录 → 返回 0 行（隔离在数据库层，不是应用层）',
  otherRows.length === 0,
  `实际返回 ${otherRows.length} 行`,
);

const otherProfiles = (await db.query(`select * from public.profiles`)).rows;
check(
  'U1 只能看到自己的 profiles（共 1 行，而不是 2 行）',
  otherProfiles.length === 1 && otherProfiles[0].id === u1,
  `实际 ${otherProfiles.length} 行`,
);

// ── E3: 伪造写入 ──
let forgedBlocked = false;
try {
  await db.query(`
    insert into public.meal_items (user_id,log_date,meal_type,food_name,quantity_g,kcal)
    values ($1,'2026-10-18','dinner','伪造',100,300)
  `, [u2]);
} catch (e) {
  forgedBlocked = e.message.includes('row-level security') || e.message.includes('policy');
}
check('U1 伪造 user_id=U2 写入 → 被 WITH CHECK 挡下', forgedBlocked);

// ── E4: 内置食物只读 ──
const visibleFoods = (await db.query(`select * from public.foods`)).rows;
check('内置食物（owner_id IS NULL）对所有登录用户可见', visibleFoods.length >= 1);

const { rows: tamperRows } = await db.query(
  `update public.foods set kcal=999 where owner_id is null returning id`,
);
check(
  '内置食物对客户端只读：UPDATE 影响 0 行（篡改不了公共食物库）',
  tamperRows.length === 0,
  `实际影响 ${tamperRows.length} 行`,
);

// ── E5: daily_summary 只读 ──
let summaryWriteBlocked = false;
try {
  await db.query(`
    insert into public.daily_summary (user_id,log_date,intake_kcal) values ($1,'2026-10-19',99999)
  `, [u1]);
} catch {
  summaryWriteBlocked = true;
}
check('daily_summary 客户端写不进（派生数据只能由触发器维护）', summaryWriteBlocked);

// ── E6: invite_codes 三不沾 ──
let inviteBlocked = false;
try {
  const r = (await db.query(`select * from public.invite_codes`)).rows;
  inviteBlocked = r.length === 0; // 没 GRANT 的话会直接报错，到这里说明能查但没策略
} catch (e) {
  inviteBlocked = e.message.includes('permission denied') || e.message.includes('42501');
}
check('invite_codes 对 authenticated 完全不可访问', inviteBlocked);

// ── E7: SECURITY DEFINER 函数不能直接被调用 ──
let funcBlocked = false;
try {
  await db.query(`select public.refresh_daily_summary($1,'2026-10-18')`, [u1]);
} catch (e) {
  funcBlocked = e.message.includes('permission denied');
}
check(
  'SECURITY DEFINER 函数无法被客户端直接调用（防止借权限）',
  funcBlocked,
);

await actAsAdmin();

// ═══════════════════════════════════════════════════════════════════════
//  6. anon 权限断言
// ═══════════════════════════════════════════════════════════════════════

section('【F】anon（未登录访客）不该有任何权限');

async function actAsAnon() {
  await db.query(`reset role`);
  await db.query(`select set_config('request.jwt.claims', '', false)`);
  await db.query(`set role anon`);
}

await actAsAnon();

let anonBlocked = false;
try {
  await db.query(`select * from public.meal_items`);
} catch (e) {
  anonBlocked = e.message.includes('permission denied');
}
check('anon 读 meal_items → permission denied（REVOKE 生效）', anonBlocked);

let anonProfilesBlocked = false;
try {
  await db.query(`select * from public.profiles`);
} catch (e) {
  anonProfilesBlocked = e.message.includes('permission denied');
}
check('anon 读 profiles → permission denied', anonProfilesBlocked);

await actAsAdmin();

// ═══════════════════════════════════════════════════════════════════════
//  7. numeric 类型行为（影响应用层代码）
// ═══════════════════════════════════════════════════════════════════════

section('【G】驱动层类型行为');

const numRow = (
  await db.query(`select intake_kcal, item_count from public.daily_summary where user_id=$1 limit 1`, [
    u1,
  ])
).rows[0];
check(
  'numeric 列返回 JS string 而非 number（应用层必须显式转换，否则 "430" + 1 = "4301"）',
  typeof numRow.intake_kcal === 'string',
  `实际 typeof = ${typeof numRow.intake_kcal}`,
);
check(
  'integer 列返回 JS number',
  typeof numRow.item_count === 'number',
  `实际 typeof = ${typeof numRow.item_count}`,
);

// ═══════════════════════════════════════════════════════════════════════
//  8. 种子数据（0003_seed_foods.sql）
// ═══════════════════════════════════════════════════════════════════════
//  种子迁移最容易出的问题是"跑起来没报错，但数据是错的/少了一半"。
//  这一节专门盯住那些【不报错但很致命】的情况。

section('【H】内置食物库种子数据');

await actAsAdmin();

// ── H1: 条数 ──
//  ⚠️ 这里用 `source = 'builtin'` 而不是 `owner_id is null` 来数内置食物。
//
//  种子数据把 source 写成 'builtin'，这是它的契约。而【C】节的测试夹具
//  （见第 246 行的说明）以 postgres 身份插入，owner_id 留 NULL，
//  但 source 走列默认值 'user' —— 所以按 source 计数不会被它污染。
//
//  用契约字段计数，比用"看起来像内置"的间接特征（owner_id IS NULL）可靠。
const seedCounts = (
  await db.query(`
    select
      (select count(*)::int from public.foods where source = 'builtin')  as foods,
      (select count(*)::int from public.food_servings s
         join public.foods f on f.id = s.food_id
        where f.source = 'builtin')                                      as servings,
      (select count(*)::int from public.foods
        where source = 'builtin' and is_verified)                        as verified
  `)
).rows[0];

check('内置食物装载 194 条', seedCounts.foods === 194, `实际 ${seedCounts.foods}`);
check('份量装载 204 条', seedCounts.servings === 204, `实际 ${seedCounts.servings}`);
check(
  'high confidence 的 126 条标记为 is_verified（其余 68 条是菜肴/外卖估算值）',
  seedCounts.verified === 126,
  `实际 ${seedCounts.verified}`,
);

// ── H2: 每个食物【恰好】一个默认份量 ──
//  这是需求 P2「10 秒记一顿饭」的数据层保证。
//  0 个默认份量 → 用户必须自己想克数；2 个 → 下拉框里出现两个选项。
//  两种都会让"10 秒"破功，而数据库不会因此报错。
const defaultStats = (
  await db.query(`
    select count(*)::int as n,
           count(*) filter (where d = 0)::int as zero,
           count(*) filter (where d > 1)::int as multi
    from (
      select f.id, (select count(*) from public.food_servings s
                    where s.food_id = f.id and s.is_default) as d
      from public.foods f where f.source = 'builtin'
    ) t
  `)
).rows[0];
check(
  '每个内置食物恰好有 1 个默认份量（0 个会让用户被迫想克数，2 个会让下拉框出现重复项）',
  defaultStats.zero === 0 && defaultStats.multi === 0,
  `${defaultStats.zero} 个没有默认份量，${defaultStats.multi} 个有多个`,
);

// ── H3: 确定性 UUID ──
//  这条断言守的是"跨环境可复现"。如果哪天有人把 build-seed.mjs 里的
//  NAMESPACE 改了，或者改用 gen_random_uuid()，这条会立刻红。
//  （改了命名空间的后果：所有食物 id 变化，已有饮食记录的 food_id 全部悬空。）
const rice = (
  await db.query(`select id, kcal, name from public.foods where slug = 'rice-white-cooked'`)
).rows[0];
check(
  '白米饭的 UUID 是确定性生成的（跨环境可复现）',
  rice?.id === '58e53dac-ad2c-5df7-81fc-67ee6e8f4bf5',
  `实际 ${rice?.id}`,
);

// ── H4: 别名搜索真的能命中 ──
//  「米饭」是白米饭的别名而不是正名 —— 用户输入"米饭"必须搜得到。
//  这条同时验证了 text[] 数组被正确解析（CSV 里是 `米饭|大米饭|白饭|蒸米饭`）。
const aliasHit = (
  await db.query(`select name from public.foods where aliases @> ARRAY['米饭']::text[]`)
).rows;
check(
  '按别名「米饭」能搜到白米饭（数组解析 + GIN 倒排索引正确）',
  aliasHit.length === 1 && aliasHit[0].name === '白米饭',
  JSON.stringify(aliasHit),
);

const nameHit = (
  await db.query(`select name from public.foods where name ilike '%鸡胸%'`)
).rows;
check('按名称模糊搜「鸡胸」能命中', nameHit.length >= 1, JSON.stringify(nameHit));

// ── H5: 幂等性 —— 重复执行不产生重复行 ──
const seededBefore = seedCounts.foods;
for (const stmt of statements0003) await db.exec(stmt);
const afterRerun = (
  await db.query(`select count(*)::int as n from public.foods where source = 'builtin'`)
).rows[0].n;
check(
  '重复执行种子迁移不产生重复行（ON CONFLICT (id) DO UPDATE 幂等）',
  afterRerun === seededBefore,
  `重跑前 ${seededBefore} 条 → 重跑后 ${afterRerun} 条`,
);

// ── H6: 幂等【且能更新】──
//  幂等有两种实现，差别很大：
//    ON CONFLICT DO NOTHING → 重跑无副作用，但数据修好了也推不出去
//    ON CONFLICT DO UPDATE   → 重跑会把已有行更新成 CSV 的最新值  ← 我们选的
//  这条断言就是用来区分这两者的。只测 H5 是测不出区别的。
await db.query(`update public.foods set kcal = 500 where slug = 'rice-white-cooked'`);
for (const stmt of statements0003) await db.exec(stmt);
const afterFix = (
  await db.query(`select kcal from public.foods where slug = 'rice-white-cooked'`)
).rows[0].kcal;
check(
  '重跑种子会把已改动的数据修正回 CSV 值（DO UPDATE 而非 DO NOTHING）',
  Number(afterFix) === 116,
  `实际 ${afterFix}`,
);

// ── H7: 种子数据 → 记录 → 汇总，全链路打通 ──
//  前面各节测的都是"手写的测试数据"。这一条换成【真实的食物库数据】，
//  走一遍用户真正会走的路：搜索到白米饭 → 记 150 克 → 汇总表出数。
await actAs(u1);
let realFoodOk = true;
let realFoodErr = '';
try {
  await db.query(
    `
    insert into public.meal_items
      (user_id, log_date, meal_type, food_id, food_name, quantity_g, kcal, protein_g)
    select $1, '2026-11-01', 'lunch', f.id, f.name, 150,
           round(f.kcal * 1.5, 1), round(f.protein_g * 1.5, 1)
    from public.foods f where f.slug = 'rice-white-cooked'
  `,
    [u1],
  );
} catch (e) {
  realFoodOk = false;
  realFoodErr = e.message;
}
check('【全链路】用真实食物库数据记录 150g 白米饭成功', realFoodOk, realFoodErr);

if (realFoodOk) {
  const summary = (
    await db.query(
      `select intake_kcal, protein_g, item_count from public.daily_summary
       where user_id = $1 and log_date = '2026-11-01'`,
      [u1],
    )
  ).rows[0];
  //  116 kcal/100g × 150g = 174 kcal；2.6 g/100g × 150g = 3.9 g
  check(
    '【全链路】汇总表算出 174 kcal（= 116 × 1.5）',
    Number(summary?.intake_kcal) === 174,
    `实际 ${summary?.intake_kcal}`,
  );
  check(
    '【全链路】汇总表算出 3.9 g 蛋白质',
    Number(summary?.protein_g) === 3.9,
    `实际 ${summary?.protein_g}`,
  );
  check('【全链路】item_count = 1', summary?.item_count === 1, `实际 ${summary?.item_count}`);
}

// ── H8: 内置食物对【未登录访客】不可见 ──
//  食物库不是秘密，但"anon 拿不到任何业务数据"是我们承诺的安全边界。
//  放开它需要显式改 0001 的 REVOKE，不该是默认行为。
await actAsAnon();
let anonSeesFoods = -1;
try {
  anonSeesFoods = (
    await db.query(`select count(*)::int as n from public.foods`)
  ).rows[0].n;
} catch {
  anonSeesFoods = -2; // 被 GRANT 挡住（报错）也是合格结果
}
check(
  'anon 读不到内置食物库（要么 42501 报错，要么 0 行）',
  anonSeesFoods <= 0,
  `实际返回 ${anonSeesFoods} 行`,
);

await actAsAdmin();

// ── H9: 迁移 0004 的两条完整性约束真的生效 ──
//  这两条守的是"RLS 挡得住用户，挡不住我们自己写错的代码"那个洞。
//  postgres 是表属主会绕过 RLS，但 CHECK 约束对所有角色一视同仁。
await actAsAdmin();

let noSlugBlocked = false;
let noSlugErr = '';
try {
  //  模拟服务端代码写错的场景：忘了写 slug，于是造出一条
  //  全局可见、却没有稳定身份、种子数据永远无法重新导入的内置食物
  await db.query(`insert into public.foods (name, category, kcal) values ('漏了slug','谷薯',100)`);
} catch (e) {
  noSlugBlocked = true;
  noSlugErr = e.message;
}
check(
  '【0004】builtin 食物缺 slug 被 CHECK 拒绝（挡住"服务端代码写错"这个洞）',
  noSlugBlocked,
  noSlugErr || '竟然插入成功了',
);

let blankNameBlocked = false;
try {
  await db.query(`insert into public.foods (name, category, kcal, slug) values ('   ','谷薯',100,'blank-name-test')`);
} catch {
  blankNameBlocked = true;
}
check(
  '【0004】全空白的食物名被 CHECK 拒绝（notNull 只防 NULL，不防空串）',
  blankNameBlocked,
  blankNameBlocked ? '' : '竟然插入成功了',
);

//  反向验证：合法的用户自建食物（有 owner_id、无 slug）必须【仍然能插入】。
//  否则这条约束就是把正常功能一起关掉了 —— 只测"坏的被拒绝"是不够的。
let userFoodOk = false;
let userFoodErr = '';
try {
  await db.query(
    `insert into public.foods (name, category, kcal, owner_id) values ('我的自制沙拉','蔬菜',80,$1)`,
    [u1],
  );
  userFoodOk = true;
} catch (e) {
  userFoodErr = e.message;
}
check(
  '【0004】用户自建食物（有 owner_id、无 slug）仍可正常插入 —— 约束没有误伤正常功能',
  userFoodOk,
  userFoodErr,
);

// ═══════════════════════════════════════════════════════════════════════
//  【I】0005：级联删除 + 权限白名单
// ═══════════════════════════════════════════════════════════════════════
section('【I】0005：删用户不再被外键挡住 + 权限收紧');

// ── I1: 删 auth.users 时必须能级联清干净 ──
//  这是 0005 修掉的真 bug，值得永久回归：
//    删 auth.users → 级联删 meal_items → meal_items 的 AFTER DELETE 触发器
//    去 refresh_daily_summary → 它 INSERT 回 daily_summary 时 auth.users 那行
//    已经不在了 → 外键报错 → 【整个删用户操作被回滚】。
//  在 PGlite 上跑是为了让它进 CI：以后改触发器不用连真库就能发现砸了这条路径。
const cascadeUserId = (
  await db.query(`insert into auth.users (email) values ('cascade-check@example.invalid') returning id`)
).rows[0].id;

await actAs(cascadeUserId);
const cascadeFoodId = (
  await db.query(`select id from public.foods where slug = 'rice-white-cooked'`)
).rows[0].id;
await db.query(
  `insert into public.meal_items
     (user_id, log_date, meal_type, food_id, quantity_g, food_name, kcal, protein_g, fat_g, carb_g)
   values ($1,'2026-11-01','lunch',$2,150,'白米饭',174,3.9,0.45,38.85)`,
  [cascadeUserId, cascadeFoodId],
);

//  先确认触发器真的写了汇总行 —— 否则下面的删除测试是【空跑】：
//  daily_summary 里没有该用户的行，就不会触发那个外键错误，测试会假阳性通过。
await actAsAdmin();
const beforeDelete = (
  await db.query(`select count(*)::int as n from public.daily_summary where user_id=$1`, [cascadeUserId])
).rows[0].n;
check(
  '【0005】删用户前 daily_summary 确实有行（否则下面两条是空跑假阳性）',
  beforeDelete === 1,
  `实际 ${beforeDelete} 行`,
);

let cascadeErr = null;
try {
  await db.query(`delete from auth.users where id=$1`, [cascadeUserId]);
} catch (e) {
  cascadeErr = e.message;
}
check(
  '【0005】删 auth.users 不再被 daily_summary 的外键挡住（HAVING EXISTS 守卫生效）',
  cascadeErr === null,
  cascadeErr ?? '',
);

const leftovers = (
  await db.query(
    `select (select count(*)::int from public.profiles       where id=$1)
          + (select count(*)::int from public.meal_items     where user_id=$1)
          + (select count(*)::int from public.daily_summary  where user_id=$1)
          + (select count(*)::int from public.measurements   where user_id=$1)
          + (select count(*)::int from public.food_favorites where user_id=$1) as n`,
    [cascadeUserId],
  )
).rows[0].n;
check(
  '【0005】级联删干净：profiles / meal_items / daily_summary / measurements / food_favorites 全 0 行',
  leftovers === 0,
  `实际残留 ${leftovers} 行`,
);

// ── I2: authenticated 不能 TRUNCATE ──
//  ⚠ PGlite 里 authenticated 是我们手建的空角色，本来就没权限 —— 直接断言会
//  【永远通过】（假阳性）。所以先模拟 Supabase 的默认授权把 TRUNCATE 发出去，
//  再重跑 0005，看它能不能收干净。这同时验证了 0005 幂等。
const countPrivs = async (types) =>
  (
    await db.query(
      `select count(*)::int as n from information_schema.role_table_grants
        where table_schema='public' and grantee='authenticated'
          and privilege_type = any($1::text[])`,
      [types],
    )
  ).rows[0].n;

await actAsAdmin();
await db.exec(`grant truncate, references, trigger on public.daily_summary to authenticated`);
const injected = await countPrivs(['TRUNCATE', 'REFERENCES', 'TRIGGER']);
check(
  '【0005】已注入模拟的 Supabase 默认授权（否则下一条是假阳性）',
  injected > 0,
  `实际注入后 ${injected} 项`,
);

for (const stmt of statements0005) await db.exec(stmt);

const afterRevoke = await countPrivs(['TRUNCATE', 'REFERENCES', 'TRIGGER']);
check(
  '【0005】重跑后 TRUNCATE / REFERENCES / TRIGGER 全被收回（同时证明 0005 幂等）',
  afterRevoke === 0,
  `实际剩 ${afterRevoke} 项`,
);

//  反向验证：收紧不能把正常功能一起关掉。REVOKE ALL 之后必须重新 GRANT 白名单。
const stillInsertable = await countPrivs(['INSERT']);
check(
  '【0005】重跑后 INSERT 白名单仍在 —— 收紧没有误伤正常写入',
  stillInsertable > 0,
  `实际剩 ${stillInsertable} 项`,
);

// ── 收尾：把 0006 重新应用一次 ────────────────────────────────────────
//  ⚠️ 上面为了验证 0005 的幂等，把 statements0005 又跑了一遍。而 0005 里也有
//  CREATE OR REPLACE FUNCTION public.refresh_daily_summary ——
//  于是它把 0006 刚装上的「带 target_kcal」的版本【打回了旧版】。
//
//  这不是 0005 写错了，而是迁移文件的一个真实性质：
//  CREATE OR REPLACE 是「覆盖」，重跑老迁移就会覆盖新迁移对同一个函数的改动。
//  生产环境不会踩到（drizzle 记了 __drizzle_migrations，已应用的不会再跑），
//  但测试里会 —— 而且症状极具迷惑性：
//    · 走 refresh_daily_summary 的「记一餐」路径 → target_kcal 变回 NULL
//    · 走 sync_one_weight 的「只记体重」路径 → 正常（因为 0005 只对它 REVOKE，
//      没有重新定义它，所以 0006 的版本活了下来）
//  两个函数一个对一个不对，很容易被误判成「SQL 写错了」。
//  以后再有迁移重定义函数，同样要在这一段之后补跑最新那一个。
for (const stmt of statements0006) await db.exec(stmt);

//  同一条道理也适用于 0007：它重定义了 sync_one_weight。
//  当前 0005 只对它做 REVOKE、没有重新定义，所以函数体没被打回去；
//  但这里仍然显式补跑一次 —— 理由和上面一样，是为了让这条规则【不依赖
//  某个老迁移恰好没碰这个函数】。哪天有人在 0005 里补上函数定义，
//  这一行就是唯一能救回 0007 的地方。
for (const stmt of statements0007) await db.exec(stmt);

// ═══════════════════════════════════════════════════════════════════════
//  【J】0006：daily_summary.target_kcal 的快照语义
// ═══════════════════════════════════════════════════════════════════════
section('【J】0006：target_kcal 有值，且不被重算覆盖');

//  这一节守的是一个「列存在但永远是 NULL」的 bug：
//    refresh_daily_summary 与 sync_one_weight 两个函数都会【创建】汇总行，
//    但两者的 INSERT 列表里都没有 target_kcal；而 ON CONFLICT DO UPDATE
//    又【故意】不写它（快照语义）—— 于是没有任何代码写这一列，永远 NULL。
//  用户可见的表现：趋势页画不出「目标热量」虚线，也就标不出高于该线的日子。
//  纯 SQL 层的 bug，PGlite 上就能钉死，不必连真库。
const snapUserId = (
  await db.query(`insert into auth.users (email) values ('target-snapshot@example.invalid') returning id`)
).rows[0].id;

await actAs(snapUserId);
const snapFoodId = (
  await db.query(`select id from public.foods where slug = 'rice-white-cooked'`)
).rows[0].id;

//  J1：先设目标再记一餐 —— 新建的汇总行应当快照到 1800
await db.query(`update public.profiles set target_kcal = 1800 where id = $1`, [snapUserId]);
await db.query(
  `insert into public.meal_items
     (user_id, log_date, meal_type, food_id, quantity_g, food_name, kcal, protein_g, fat_g, carb_g)
   values ($1,'2026-12-01','lunch',$2,150,'白米饭',174,3.9,0.45,38.85)`,
  [snapUserId, snapFoodId],
);

await actAsAdmin();
const j1 = (
  await db.query(
    `select target_kcal from public.daily_summary where user_id=$1 and log_date='2026-12-01'`,
    [snapUserId],
  )
).rows[0]?.target_kcal;
check('【0006】记一餐后，汇总行快照到了当时的目标（1800）', j1 === 1800, `实际 ${j1}`);

//  J2：改目标 → 同一天再记一餐触发重算 → 历史行必须【保持】1800。
//  这是整节的重点：它把「快照」和「每次现算」区分开。
//  若有人日后"顺手"把 target_kcal 加进 DO UPDATE 分支，这条会立刻变红。
await actAs(snapUserId);
await db.query(`update public.profiles set target_kcal = 1600 where id = $1`, [snapUserId]);
await db.query(
  `insert into public.meal_items
     (user_id, log_date, meal_type, food_id, quantity_g, food_name, kcal, protein_g, fat_g, carb_g)
   values ($1,'2026-12-01','dinner',$2,100,'白米饭',116,2.6,0.3,25.9)`,
  [snapUserId, snapFoodId],
);

await actAsAdmin();
const j2 = (
  await db.query(
    `select target_kcal, intake_kcal from public.daily_summary where user_id=$1 and log_date='2026-12-01'`,
    [snapUserId],
  )
).rows[0];
check(
  '【0006】改目标后重算，历史行 target_kcal 仍是 1800（快照没被覆盖）',
  j2?.target_kcal === 1800,
  `实际 ${j2?.target_kcal}`,
);
//  这条是上一条的「非空跑证明」：如果 DO UPDATE 分支压根没执行，
//  上一条也会通过，但那是假阳性。intake 变了才说明重算真的跑过。
check(
  '【0006】同一次重算确实更新了 intake_kcal（证明 DO UPDATE 真的执行了）',
  Number(j2?.intake_kcal) === 290,
  `实际 ${j2?.intake_kcal}`,
);

//  J3：换一天记一餐 —— 新行才取当下的新目标 1600
await actAs(snapUserId);
await db.query(
  `insert into public.meal_items
     (user_id, log_date, meal_type, food_id, quantity_g, food_name, kcal, protein_g, fat_g, carb_g)
   values ($1,'2026-12-02','lunch',$2,150,'白米饭',174,3.9,0.45,38.85)`,
  [snapUserId, snapFoodId],
);

await actAsAdmin();
const j3 = (
  await db.query(
    `select target_kcal from public.daily_summary where user_id=$1 and log_date='2026-12-02'`,
    [snapUserId],
  )
).rows[0]?.target_kcal;
check('【0006】新的一天取当下的新目标（1600）', j3 === 1600, `实际 ${j3}`);

//  J4：只有体重、没记饭的日子走的是 sync_one_weight 那条路径，
//  它同样会【创建】汇总行，所以也必须在 INSERT 里带上 target_kcal。
//  只修 refresh_daily_summary 的话，「只称了体重」的日子会继续是 NULL ——
//  而恰恰是这类日子最需要目标线做参照。
await actAs(snapUserId);
await db.query(
  `insert into public.measurements (user_id, metric, measured_on, value, unit)
   values ($1,'weight','2026-12-03',79.4,'kg')`,
  [snapUserId],
);

await actAsAdmin();
const j4 = (
  await db.query(
    `select target_kcal, weight_kg from public.daily_summary where user_id=$1 and log_date='2026-12-03'`,
    [snapUserId],
  )
).rows[0];
check(
  '【0006】只记体重的日子也快照了 target_kcal（sync_one_weight 路径）',
  j4?.target_kcal === 1600,
  `实际 ${j4?.target_kcal}`,
);
check(
  '【0006】同一行的体重也写进去了（证明这条路径真的建了行，上一条不是空跑）',
  Number(j4?.weight_kg) === 79.4,
  `实际 ${j4?.weight_kg}`,
);

// ═══════════════════════════════════════════════════════════════════════
//  【K】0007：记过体重的账号也能被删掉
// ═══════════════════════════════════════════════════════════════════════
section('【K】0007：记过体重的账号也能被删掉');

//  这一节守的是 I1【漏掉的那个数据形状】—— 也是一个值得记住的教训：
//    · I1 确实测了「删用户」，建的用户只有 meal_items、没有 measurements，
//      走的是 measurements 之外的路径，由 refresh_daily_summary 兜底
//      （那半 0005 已经修了）；
//    · 而 measurements 上挂着【另一个】AFTER DELETE 触发器
//      → trg_measurements_sync_weight → sync_one_weight，那一半没人动过。
//  于是 I1 一直是绿的，线上却删不掉任何记过体重的账号。
//
//  结论：一个「删用户」测试并不能证明删用户是安全的，
//  它只能证明【那个用户恰好带着的那份数据】是安全的。
//  用户身上挂几个触发器，就得建几种数据形状各测一遍。
//
//  线上真实报错（Supabase 面板与 admin API 都只回一句含糊的
//  "Database error deleting user"，看不出原因）：
//    insert or update on table "daily_summary" violates foreign key constraint
//    "daily_summary_user_id_fkey"   (code 23503)
//    where: SQL function "sync_one_weight" statement 1
//           SQL statement "SELECT public.sync_one_weight(OLD.user_id, OLD.measured_on)"
//           PL/pgSQL function public.trg_measurements_sync_weight() line 5 at PERFORM
const weighUserId = (
  await db.query(`insert into auth.users (email) values ('delete-with-weight@example.invalid') returning id`)
).rows[0].id;

//  只记体重、不记餐 —— 这就是线上那个删不掉的账号的形状。
await actAs(weighUserId);
await db.query(
  `insert into public.measurements (user_id, metric, measured_on, value, unit)
   values ($1,'weight','2026-12-10',79.4,'kg')`,
  [weighUserId],
);

await actAsAdmin();
const kBefore = (
  await db.query(`select count(*)::int as n from public.daily_summary where user_id=$1`, [weighUserId])
).rows[0].n;
check(
  '【0007】删用户前 daily_summary 确实有行（否则下面的删除是空跑假阳性）',
  kBefore === 1,
  `实际 ${kBefore} 行`,
);

let weighDelErr = null;
try {
  await db.query(`delete from auth.users where id=$1`, [weighUserId]);
} catch (e) {
  weighDelErr = `${e.message}${e.where ? ` | where: ${String(e.where).replace(/\s+/g, ' ')}` : ''}`;
}
check(
  '【0007】记过体重的账号能被删掉（sync_one_weight 的 WHERE EXISTS 守卫生效）',
  weighDelErr === null,
  weighDelErr ?? '',
);

const kLeft = (
  await db.query(
    `select (select count(*)::int from public.profiles      where id=$1)
          + (select count(*)::int from public.measurements  where user_id=$1)
          + (select count(*)::int from public.daily_summary where user_id=$1) as n`,
    [weighUserId],
  )
).rows[0].n;
check('【0007】级联删干净：profiles / measurements / daily_summary 全 0 行', kLeft === 0, `实际残留 ${kLeft} 行`);

//  K2：守护条件不能误伤正常记体重。
//  这一条是防「修好了删除，却把正常写入也堵死」——
//  WHERE EXISTS 写错表名或写反的话，这里会变红，而上面全绿。
const stillWeighId = (
  await db.query(`insert into auth.users (email) values ('still-can-weigh@example.invalid') returning id`)
).rows[0].id;
await actAs(stillWeighId);
await db.query(
  `insert into public.measurements (user_id, metric, measured_on, value, unit)
   values ($1,'weight','2026-12-11',81.2,'kg')`,
  [stillWeighId],
);
await actAsAdmin();
const k2 = (
  await db.query(
    `select weight_kg from public.daily_summary where user_id=$1 and log_date='2026-12-11'`,
    [stillWeighId],
  )
).rows[0]?.weight_kg;
check('【0007】账号还在时，记体重照旧能写进汇总行（修复没有误伤）', Number(k2) === 81.2, `实际 ${k2}`);

//  K3：更新体重那条分支（ON CONFLICT DO UPDATE）也得活着。
await actAs(stillWeighId);
await db.query(
  `update public.measurements set value = 80.5 where user_id=$1 and measured_on='2026-12-11'`,
  [stillWeighId],
);
await actAsAdmin();
const k3 = (
  await db.query(
    `select weight_kg from public.daily_summary where user_id=$1 and log_date='2026-12-11'`,
    [stillWeighId],
  )
).rows[0]?.weight_kg;
check('【0007】改体重能同步覆盖汇总行（ON CONFLICT 分支未被守护条件挡住）', Number(k3) === 80.5, `实际 ${k3}`);

// ═══════════════════════════════════════════════════════════════════════
//  【L】0008：邀请码门槛
// ═══════════════════════════════════════════════════════════════════════
section('【L】0008：邀请码门槛');

//  这一节真正要守的是【安全边界】，而不只是「函数能跑」：
//    · invite_codes 是 RLS 开启 + 零策略 + 零 GRANT 的「三不沾」表，
//      未登录的登录页（anon 角色）读不到它；
//    · 但登录页必须能校验码，所以给的是两个 SECURITY DEFINER 函数；
//    · 于是不变量是：**anon 能调函数，但读不到表**。
//
//  只测「函数返回 true」会把这条不变量整个漏掉 —— 那样即使有人顺手给
//  anon 补了一条 select 权限，这里也照样全绿，而邀请码列表已经对所有
//  访客公开了。

await actAsAdmin();
await db.query(`
  insert into public.invite_codes (code, note, max_uses, expires_at)
  values ('L-TEST-ONE','单次码',1, null),
         ('L-TEST-MANY','三次码',3, null),
         ('L-TEST-EXPIRED','过期码',1, now() - interval '1 day')
`);

//  用 anon 而不是 authenticated：登录页的访问者就是未登录状态，
//  以 authenticated 测等于测错了角色 —— 那条路在生产上根本不会走。
//  切身的辅助函数复用【F】组里已有的 actAsAnon()，不要重复定义。
await actAsAnon();

const lOk = (await db.query(`select public.invite_code_is_valid('L-TEST-ONE') as ok`)).rows[0].ok;
check('【0008】anon 能调用校验函数，未用过的码返回 true', lOk === true, `实际 ${lOk}`);

const lExpired = (await db.query(`select public.invite_code_is_valid('L-TEST-EXPIRED') as ok`)).rows[0].ok;
check('【0008】过期码校验返回 false', lExpired === false, `实际 ${lExpired}`);

const lMissing = (await db.query(`select public.invite_code_is_valid('L-NOT-EXIST') as ok`)).rows[0].ok;
check('【0008】不存在的码返回 false', lMissing === false, `实际 ${lMissing}`);

//  聊天窗口复制来的码常带前后空格、也可能被输入法转成小写。
//  归一化只在数据库这一层做一次，前后端就不会各写一套然后漂移。
const lNormalized = (await db.query(`select public.invite_code_is_valid('  l-test-one  ') as ok`)).rows[0].ok;
check('【0008】前后空格 + 小写会被归一化', lNormalized === true, `实际 ${lNormalized}`);

const lUse1 = (await db.query(`select public.consume_invite_code('L-TEST-ONE') as ok`)).rows[0].ok;
check('【0008】消耗 max_uses=1 的码成功', lUse1 === true, `实际 ${lUse1}`);

const lUse2 = (await db.query(`select public.consume_invite_code('L-TEST-ONE') as ok`)).rows[0].ok;
check('【0008】同一个码再消耗一次失败（已用尽）', lUse2 === false, `实际 ${lUse2}`);

const lAfterUse = (await db.query(`select public.invite_code_is_valid('L-TEST-ONE') as ok`)).rows[0].ok;
check('【0008】用尽后校验也说不可用（前端不会放行一个扣不掉的码）', lAfterUse === false, `实际 ${lAfterUse}`);

const lUseExpired = (await db.query(`select public.consume_invite_code('L-TEST-EXPIRED') as ok`)).rows[0].ok;
check('【0008】过期码不能被消耗', lUseExpired === false, `实际 ${lUseExpired}`);

for (let i = 0; i < 3; i += 1) {
  await db.query(`select public.consume_invite_code('L-TEST-MANY')`);
}
// 读 used_count 必须回到 admin —— 上面那些 consume 是 anon 调的就是要证明
// 「函数能改表，而调用者自己没有表权限」，这正是 SECURITY DEFINER 的意义。
await actAsAdmin();
const lUsed = (await db.query(`select used_count from public.invite_codes where code='L-TEST-MANY'`)).rows[0]
  .used_count;
check('【0008】max_uses=3 的码恰好扣满 3 次（不多不少）', Number(lUsed) === 3, `实际 ${lUsed}`);

const lOver = (await db.query(`select public.consume_invite_code('L-TEST-MANY') as ok`)).rows[0].ok;
check('【0008】越过上限后再扣返回 false（计数器不会涨到 4）', lOver === false, `实际 ${lOver}`);

await actAsAnon();

//  ── 安全边界：函数可用，表不可读 ──────────────────────────────────────
//  真实 Supabase 上 anon 手里有表级 GRANT，靠的是「RLS 开启 + 零策略」
//  把它挡成 0 行；本地 replica 里则直接是 permission denied。
//  两种情况都算通过 —— 要证明的是「读不到」，不是「用哪种方式读不到」。
let lRows = null;
let lErr = null;
try {
  lRows = (await db.query(`select code, note from public.invite_codes`)).rows;
} catch (e) {
  lErr = e.message;
}
check(
  '【0008】anon 直接读 invite_codes 被挡住（函数可用 ≠ 表可读）',
  lErr !== null || lRows.length === 0,
  lErr ?? `居然读到了 ${lRows.length} 行`,
);

await actAsAdmin();

const lDef = (
  await db.query(
    `select p.proname, p.prosecdef, coalesce(p.proconfig, '{}') as proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('invite_code_is_valid','consume_invite_code')
      order by p.proname`,
  )
).rows;
check(
  '【0008】两个函数都是 SECURITY DEFINER（否则 anon 会被 RLS 挡死）',
  lDef.length === 2 && lDef.every((r) => r.prosecdef === true),
  `实际 ${JSON.stringify(lDef.map((r) => [r.proname, r.prosecdef]))}`,
);
check(
  '【0008】两个函数的 search_path 都钉死了（防同名对象提权）',
  lDef.length === 2 && lDef.every((r) => r.proconfig.some((c) => c.startsWith('search_path='))),
  `实际 ${JSON.stringify(lDef.map((r) => [r.proname, r.proconfig]))}`,
);

// ═══════════════════════════════════════════════════════════════════════
//  结果
// ═══════════════════════════════════════════════════════════════════════

console.log(`\n${'─'.repeat(64)}`);
if (fail === 0) {
  console.log(`\x1b[32m\x1b[1m全部通过：${pass} 项断言\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${pass} 通过 / ${fail} 失败\x1b[0m`);
  console.log('\n失败项：');
  for (const f of failures) console.log(`  · ${f}`);
}
console.log(`${'─'.repeat(64)}\n`);

await db.close();
process.exit(fail === 0 ? 0 : 1);
