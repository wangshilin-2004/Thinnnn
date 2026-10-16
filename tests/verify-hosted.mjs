/**
 * ═══════════════════════════════════════════════════════════════════════
 *  线上库验证：在【真实的 Supabase】上把 RLS、连接池、触发器、注销跑一遍
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  运行：npm run db:verify:hosted
 *
 *  ⚠️ 这个脚本会连真实的 Supabase 项目，并且【真的增删账号】。
 *     它不进 `npm run verify`，就是为了不让日常测试顺手改线上数据。
 *     为此它做了三件事：
 *       1. 只创建带时间戳的一次性账号（iso-*@example.invalid），绝不碰已有数据；
 *       2. 结尾一定删干净，并断言级联真的清空了；
 *       3. 删不掉就报错退出（非 0），不会留下说不清的残留。
 *
 *  【为什么 PGlite 那一套还不够】
 *  tests/verify-migrations.mjs 已经把 SQL 层钉死了，但它测不到四件事
 *  —— 因为这四件事恰恰是 PGlite 造不出来的：
 *    V1  postgres 角色能不能 SET LOCAL ROLE authenticated
 *        （PGlite 是单连接超级用户，权限模型不同）
 *    V2  auth.users 上的触发器在真实 Supabase 里有没有权限建档
 *        （PGlite 的 auth.users 是我们自己造的）
 *    V7  Supabase 的连接池（Supavisor）下 SET LOCAL 还成不成立
 *        （事务级 SET LOCAL 理论安全，但理论要验）
 *    V8  RLS 的端到端双账号隔离 —— 这是 DoD 硬指标
 *
 *  【两个把「假阳性」当「通过」的坑，都在这份脚本里踩过】
 *
 *  坑一：把 tx 从「事务回调」里返回出去
 *    postgres.js 的 sql.begin(cb) 在 cb 返回时就提交事务，
 *    而 `set local role` 是【事务级】的 —— 提交之后角色就回退成连接默认的
 *    postgres（超级用户，RLS 对它无效）。
 *    于是所有隔离断言都会「通过」：查得到、写不进限制、anon 也不受限。
 *    第一版就是这么写的，10 项「通过」全是假的。
 *    → 现在每个断言都在事务【内部】执行，并且每次都先断言
 *      current_user / auth.uid() 真的是我们以为的那个身份。
 *
 *  坑二：用「有没有报错」判断一条写入被没被拦
 *    RLS 的两道门失败方式完全不同：
 *      · 缺 POLICY → 静默 0 行，【不报错】（USING 直接把行过滤掉）
 *      · 缺 GRANT  → 报错 42501
 *    所以「内置食物只读」这件事必须断言【受影响行数 == 0】。
 *    断言 err === null 会得出「篡改成功了」的错误结论（第二版就这么错的）。
 *
 *  另一个机制：语句报错后事务已中止，而 postgres.js 会在提交时把那个错误
 *  重新抛出来。所以【预期被拒】的用例必须让回调 throw 以强制 ROLLBACK，
 *  否则连接会带着一个半死的事务继续跑，后面全部报错。
 */

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

process.loadEnvFile('.env.local');

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

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DIRECT = process.env.DIRECT_URL;
const POOLED = process.env.DATABASE_URL;

for (const [k, v] of Object.entries({
  NEXT_PUBLIC_SUPABASE_URL: URL_,
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  DIRECT_URL: DIRECT,
  DATABASE_URL: POOLED,
})) {
  if (!v) {
    console.error(
      `\x1b[31m缺少 ${k}\x1b[0m —— 这个脚本需要完整的 .env.local（含 service_role key）。`,
    );
    process.exit(1);
  }
}

console.log(`\n\x1b[1m目标项目：${URL_}\x1b[0m`);
console.log('⚠️  会创建并删除一次性测试账号（iso-*@example.invalid），随后断言删干净。\n');

const admin = createClient(URL_, KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const STAMP = Date.now();
const EMAIL_A = `iso-a-${STAMP}@example.invalid`;
const EMAIL_B = `iso-b-${STAMP}@example.invalid`;

const { data: createdA, error: errA } = await admin.auth.admin.createUser({ email: EMAIL_A, email_confirm: true });
const { data: createdB, error: errB } = await admin.auth.admin.createUser({ email: EMAIL_B, email_confirm: true });
if (errA || errB) {
  console.error('建测试账号失败：', errA?.message, errB?.message);
  process.exit(1);
}
const ua = createdA.user.id;
const ub = createdB.user.id;
console.log(`账号 A = ${ua}\n账号 B = ${ub}`);

const sql = postgres(DIRECT, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} });

/** 以某个角色执行一组断言 —— 断言必须在事务【内部】跑（见文件头「坑一」）。 */
const runAs = (role, uid, fn) =>
  sql.begin(async (tx) => {
    await tx.unsafe(`set local role ${role}`);
    if (uid) {
      await tx.unsafe(`set local request.jwt.claims = '${JSON.stringify({ sub: uid, role })}'`);
    }
    // 守卫：先确认身份真的是我们以为的那个，否则后面的断言毫无意义
    const [who] = await tx`select current_user as cu, auth.uid()::text as uid`;
    if (who.cu !== role) throw new Error(`身份没切过去：current_user=${who.cu}，期望 ${role}`);
    if (uid && who.uid !== uid) throw new Error(`auth.uid() 不对：${who.uid}，期望 ${uid}`);
    return fn(tx);
  });

const runAsAdmin = (fn) => sql.begin(async (tx) => { await tx.unsafe('reset role'); return fn(tx); });

/** 预期被拒的用例：让回调 throw，强制 postgres.js 回滚这个已中止的事务。 */
async function expectRejected(label, role, uid, fn) {
  let msg = null;
  try {
    await runAs(role, uid, async (t) => {
      try {
        await fn(t);
      } catch (e) {
        msg = `${e.code ?? ''} ${e.message}`;
        throw e; // ← 必须抛出去，见文件头最后一段
      }
    });
  } catch {
    /* 预期内 */
  }
  check(label, msg !== null, '竟然成功了');
  return msg;
}

/**
 * anon 最理想是被 GRANT 挡在门外（42501 报错），
 * 次之是「能查但静默 0 行」。两种都安全，只有「查到数据」才是事故。
 */
async function anonCannotSee(table) {
  let outcome;
  try {
    await runAs('anon', null, async (t) => {
      const n = (await t.unsafe(`select count(*)::int as n from public.${table}`))[0].n;
      outcome = n === 0 ? '静默 0 行（缺 POLICY）' : `事故：看到 ${n} 行`;
    });
  } catch (e) {
    outcome = e.code === '42501' ? '被 GRANT 挡住（42501，最严）' : `意外错误 ${e.code} ${e.message}`;
  }
  check(
    `anon 拿不到 ${table} 的数据 → ${outcome}`,
    !outcome.startsWith('事故') && !outcome.startsWith('意外'),
    outcome,
  );
}

let fatal = null;
try {
  // ── V2 ──────────────────────────────────────────────────────────────
  section('【V2】auth.users 触发器在真实 Supabase 上建档');
  await runAsAdmin(async (t) => {
    const n = (await t`select count(*)::int as n from public.profiles where id in (${ua}, ${ub})`)[0].n;
    check('两个新账号各有 1 行 profiles（handle_new_user 触发器生效）', n === 2, `实际 ${n}`);
  });

  // ── V1 / V7 ─────────────────────────────────────────────────────────
  section('【V1/V7】SET LOCAL ROLE authenticated 在两种连接池上都可用');
  for (const [label, url] of [
    ['会话池 5432 (DIRECT_URL)', DIRECT],
    ['事务池 6543 (DATABASE_URL)', POOLED],
  ]) {
    const conn = postgres(url, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} });
    try {
      const r = await conn.begin(async (tx) => {
        await tx.unsafe('set local role authenticated');
        await tx.unsafe(`set local request.jwt.claims = '${JSON.stringify({ sub: ua })}'`);
        return (await tx`select current_user as cu, auth.uid()::text as uid`)[0];
      });
      check(
        `${label}：current_user=authenticated 且 auth.uid() 正确`,
        r.cu === 'authenticated' && r.uid === ua,
        JSON.stringify(r),
      );
    } catch (e) {
      check(`${label}：SET LOCAL ROLE 可用`, false, e.message);
    } finally {
      await conn.end();
    }
  }

  // ── 造数据：A 记一餐 + 一次体重 ─────────────────────────────────────
  await runAs('authenticated', ua, async (t) => {
    const [food] = await t`select id from public.foods where slug='rice-white-cooked'`;
    await t`insert into public.meal_items (user_id, log_date, meal_type, food_id, quantity_g, food_name, kcal, protein_g, fat_g, carb_g)
            values (${ua},'2026-10-16','lunch',${food.id},150,'白米饭',174,3.9,0.45,38.85)`;
    await t`insert into public.measurements (user_id, metric, measured_on, value, unit)
            values (${ua},'weight','2026-10-16',79.4,'kg')`;
  });

  // ── V8：DoD 硬指标 ──────────────────────────────────────────────────
  section('【V8】RLS 双账号端到端隔离（DoD 硬指标）');

  await runAs('authenticated', ua, async (t) => {
    const n = (await t`select count(*)::int as n from public.meal_items`)[0].n;
    check('A 看得见自己的 1 条饮食记录', n === 1, `实际 ${n}`);
  });

  await runAs('authenticated', ua, async (t) => {
    const n = (await t`select count(*)::int as n from public.meal_items where user_id = ${ub}`)[0].n;
    check('A 显式查 B 的 user_id → 0 行（是数据库拦的，不是应用层）', n === 0, `实际 ${n}`);
  });

  await runAs('authenticated', ua, async (t) => {
    const n = (await t`select count(*)::int as n from public.measurements where user_id in (${ua},${ub})`)[0].n;
    check('A 查「自己+B」的体重 → 只看见自己的 1 条', n === 1, `实际 ${n}`);
  });

  await expectRejected('A 伪造一条属于 B 的体重记录 → 被 WITH CHECK 拒绝', 'authenticated', ua, (t) =>
    t`insert into public.measurements (user_id, metric, measured_on, value, unit)
       values (${ub},'weight','2026-10-16',60.0,'kg')`,
  );

  await runAs('authenticated', ub, async (t) => {
    const n = (await t`select count(*)::int as n from public.measurements`)[0].n;
    check('B 那边没有任何记录（伪造写入确实没落地）', n === 0, `实际 ${n}`);
  });

  //  内置食物只读：RLS 的 USING 静默过滤 → 不报错、影响 0 行。
  //  所以必须断言【受影响行数】，断言「有没有报错」会得出相反结论。
  await runAs('authenticated', ua, async (t) => {
    const r = await t`update public.foods set kcal = 9999 where owner_id is null`;
    check(`A 篡改公共食物库 → 影响 0 行（实际 ${r.count} 行）`, r.count === 0, `改动了 ${r.count} 行`);
  });
  await runAs('authenticated', ua, async (t) => {
    const [f] = await t`select kcal from public.foods where slug='rice-white-cooked'`;
    check('公共食物 kcal 仍是 116（篡改没落地）', Number(f.kcal) === 116, `实际 ${f.kcal}`);
  });

  await anonCannotSee('meal_items');
  await anonCannotSee('measurements');
  await anonCannotSee('daily_summary');

  // ── 0007：带数据的账号能不能删掉 ─────────────────────────────────────
  section('【0007】真实库上：带数据的账号能删掉');

  await runAsAdmin(async (t) => {
    const n = (await t`select count(*)::int as n from public.daily_summary where user_id in (${ua},${ub})`)[0].n;
    check('删之前 A/B 名下有汇总行（否则下面的删除是空跑假阳性）', n >= 1, `实际 ${n}`);
  });

  for (const [label, uid] of [
    ['A（有饮食+体重，正是线上删不掉的那种）', ua],
    ['B（只有建档）', ub],
  ]) {
    const { error } = await admin.auth.admin.deleteUser(uid);
    check(`admin API 删除账号 ${label} 成功`, !error, error?.message ?? '');
  }

  await runAsAdmin(async (t) => {
    const n = (
      await t`select
          (select count(*)::int from public.profiles      where id in (${ua},${ub}))
        + (select count(*)::int from public.meal_items    where user_id in (${ua},${ub}))
        + (select count(*)::int from public.measurements  where user_id in (${ua},${ub}))
        + (select count(*)::int from public.daily_summary where user_id in (${ua},${ub})) as n`
    )[0].n;
    check('级联删干净：profiles/meal_items/measurements/daily_summary 全 0 行', n === 0, `实际残留 ${n}`);
  });
} catch (e) {
  fatal = e;
} finally {
  await sql.end();
}

// ── 兜底清场：万一中途炸了，也别把测试账号留在线上 ─────────────────────
for (const uid of [ua, ub]) {
  try {
    await admin.auth.admin.deleteUser(uid);
  } catch {
    /* 已经删掉了就会报 not found，忽略 */
  }
}

console.log(`\n${'─'.repeat(64)}`);
if (fatal) {
  console.log(`\x1b[31m\x1b[1m执行中断：${fatal.message}\x1b[0m`);
}
if (fail === 0 && !fatal) {
  console.log(`\x1b[32m\x1b[1m真实 Supabase 上全部通过：${pass} 项\x1b[0m`);
} else {
  console.log(`\x1b[31m\x1b[1m${pass} 通过 / ${fail} 失败\x1b[0m`);
  for (const f of failures) console.log(`  · ${f}`);
}
console.log(`${'─'.repeat(64)}\n`);

process.exit(fail === 0 && !fatal ? 0 : 1);
