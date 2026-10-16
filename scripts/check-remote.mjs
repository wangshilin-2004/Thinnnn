/* 对【真实 Supabase】做一次体检：迁移到底有没有把东西建对。
 *
 * 为什么不能只看 drizzle-kit migrate 的「applied successfully」：
 *   它只说明 SQL 没报错。没报错 ≠ 建对了 —— 比如 RLS 忘了开、
 *   策略建在错的表上、触发器没挂到 auth.users、GRANT 漏了某个角色，
 *   这些都不会让迁移失败，但会让线上以「静默 0 行」的形态坏掉。
 *
 * 为什么不用 tests/verify-migrations.mjs：
 *   那个脚本要在 PGlite 里造假 auth.users、假角色，才能从零验证迁移文件。
 *   真实 Supabase 已经有真 auth.users 和真角色，我要验的是「装完之后长什么样」，
 *   所以这里做的是**事后体检**（introspect），不是重放。
 *
 * 用法：node scripts/check-remote.mjs
 */

import postgres from 'postgres';

process.loadEnvFile('.env.local');

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('✖ .env.local 里没有 DIRECT_URL / DATABASE_URL');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, ssl: 'require', onnotice: () => {} });

let pass = 0;
let fail = 0;

function check(ok, label, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  } else {
    fail += 1;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `  \x1b[2m${detail}\x1b[0m` : ''}`);
  }
}

try {
  const [ver] = await sql`select version() as v`;
  console.log(`\n连接成功：${ver.v.split(',')[0]}\n`);

  // ── 1. 表 ──────────────────────────────────────────────────────────
  console.log('【1】表');
  const tables = await sql`
    select c.relname as name, c.relrowsecurity as rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`;
  const names = tables.map((t) => t.name);
  const expected = [
    'daily_summary', 'food_favorites', 'food_servings', 'foods',
    'invite_codes', 'meal_items', 'measurements', 'profiles',
  ];
  check(
    expected.every((e) => names.includes(e)),
    `8 张业务表都在`,
    `实际 ${names.length} 张：${names.join(', ')}`,
  );
  const noRls = tables.filter((t) => !t.rls).map((t) => t.name);
  check(noRls.length === 0, '每张表的 RLS 都是开着的', noRls.length ? `未开：${noRls.join(', ')}` : '');
  check(!names.includes('users'), '没有误建 public.users（认证归 auth schema 管）');

  // ── 2. 策略 ────────────────────────────────────────────────────────
  console.log('\n【2】RLS 策略');
  const pol = await sql`
    select tablename, count(*)::int as n
    from pg_policies where schemaname = 'public' group by tablename`;
  const polMap = Object.fromEntries(pol.map((p) => [p.tablename, p.n]));
  for (const t of ['profiles', 'foods', 'food_servings', 'meal_items', 'measurements', 'daily_summary', 'food_favorites']) {
    check((polMap[t] ?? 0) > 0, `${t} 有策略`, `${polMap[t] ?? 0} 条`);
  }
  check((polMap['invite_codes'] ?? 0) === 0, 'invite_codes 刻意 0 条策略（谁都读不到）');

  // ── 3. 关键约束 ────────────────────────────────────────────────────
  console.log('\n【3】约束与索引');
  const idx = await sql`
    select indexname from pg_indexes where schemaname = 'public'`;
  const idxNames = idx.map((i) => i.indexname);
  check(
    idxNames.includes('food_servings_one_default'),
    '「每个食物最多一个默认份量」的部分唯一索引在',
    'WHERE is_default',
  );
  check(
    idxNames.includes('foods_slug_uniq'),
    '内置食物 slug 唯一索引在',
  );

  const cons = await sql`
    select conname, contype from pg_constraint
    where connamespace = 'public'::regnamespace`;
  const fks = cons.filter((c) => c.contype === 'f');
  check(fks.length >= 6, `指向 auth.users 的外键 ≥ 6 个`, `实际 ${fks.length} 个`);

  // 外键必须真的指向 auth.users，且是 CASCADE
  const fkDetail = await sql`
    select con.conname,
           cl2.relname as ref_table, ns2.nspname as ref_schema,
           con.confdeltype as del
    from pg_constraint con
    join pg_class cl2 on cl2.oid = con.confrelid
    join pg_namespace ns2 on ns2.oid = cl2.relnamespace
    where con.connamespace = 'public'::regnamespace and con.contype = 'f'`;
  // 外键要分两类验，不能一刀切：
  //   ① 指向 auth.users 的「归属」外键 —— 必须 CASCADE，删用户要连带清干净
  //   ② public 内部的引用外键（meal_items→foods 等）—— 属于数据完整性，
  //      指向 public.foods 才是对的，指向 auth.users 反而是 bug
  // （第一版这里断言「所有外键都指向 auth.users」，于是把那 4 个内部外键
  //   误报成异常。断言写错的代价和代码写错一样：你会去修一个不存在的问题。）
  const toAuth = fkDetail.filter((f) => f.ref_schema === 'auth');
  const internal = fkDetail.filter((f) => f.ref_schema === 'public');
  const badAuth = toAuth.filter((f) => !(f.ref_table === 'users' && f.del === 'c'));
  check(
    toAuth.length >= 6 && badAuth.length === 0,
    `指向 auth.users 的外键 ${toAuth.length} 个，全部 ON DELETE CASCADE`,
    badAuth.length ? `异常：${badAuth.map((f) => f.conname).join(', ')}` : '',
  );
  check(
    internal.length > 0,
    `public 内部的引用外键 ${internal.length} 个（foods / food_servings）`,
    internal.map((f) => f.conname).join(', '),
  );

  // ── 4. 触发器（这里是原先唯一没验证过的假设） ───────────────────────
  console.log('\n【4】触发器 —— 尤其看挂在 auth.users 上的那个');
  const trg = await sql`
    select t.tgname, c.relname as tbl, n.nspname as sch
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal
    order by n.nspname, c.relname`;
  const authTrg = trg.find((t) => t.sch === 'auth' && t.tbl === 'users');
  check(
    !!authTrg,
    'on_auth_user_created 已挂在 auth.users 上',
    authTrg ? `触发器名 ${authTrg.tgname}` : '没挂上 —— 注册时不会自动建档！',
  );
  const pubTrg = trg.filter((t) => t.sch === 'public').map((t) => t.tbl);
  for (const t of ['meal_items', 'measurements', 'profiles', 'foods']) {
    check(pubTrg.includes(t), `public.${t} 上的触发器在`);
  }

  // ── 5. 函数 ────────────────────────────────────────────────────────
  console.log('\n【5】函数');
  const fns = await sql`
    select p.proname, p.prosecdef as secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'`;
  const fnNames = fns.map((f) => f.proname);
  for (const f of ['refresh_daily_summary', 'trg_meal_items_sync_summary', 'sync_one_weight',
    'trg_measurements_sync_weight', 'touch_updated_at', 'handle_new_user']) {
    check(fnNames.includes(f), `${f} 存在`);
  }
  // SECURITY DEFINER 的函数必须锁死 search_path，否则可被劫持
  const definerNoPath = await sql`
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
        where cfg like 'search_path=%'
      )`;
  check(definerNoPath.length === 0, 'SECURITY DEFINER 函数都设了 search_path',
    definerNoPath.length ? `缺：${definerNoPath.map((f) => f.proname).join(', ')}` : '');

  // ── 6. 数据 ────────────────────────────────────────────────────────
  console.log('\n【6】种子数据');
  const [{ n: foodCount }] = await sql`select count(*)::int as n from public.foods`;
  check(foodCount === 194, `内置食物 194 条`, `实际 ${foodCount}`);
  const [{ n: servCount }] = await sql`select count(*)::int as n from public.food_servings`;
  check(servCount === 204, `份量 204 条`, `实际 ${servCount}`);
  const [{ n: builtin }] = await sql`select count(*)::int as n from public.foods where source = 'builtin'`;
  check(builtin === foodCount, '所有食物都是 builtin（不混用户自建）');

  // ── 7. 权限（GRANT 那道门） ────────────────────────────────────────
  console.log('\n【7】GRANT —— RLS 之外的另一道门');
  const grants = await sql`
    select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
    from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon', 'authenticated')
    group by table_name, grantee order by table_name, grantee`;
  const anonGrants = grants.filter((g) => g.grantee === 'anon');
  check(anonGrants.length === 0, 'anon 在 public schema 里一个权限都没有',
    anonGrants.length ? `有：${anonGrants.map((g) => `${g.table_name}(${g.privs})`).join(', ')}` : '');
  const authGrants = Object.fromEntries(
    grants.filter((g) => g.grantee === 'authenticated').map((g) => [g.table_name, g.privs]),
  );
  check(!!authGrants['meal_items'], 'authenticated 对 meal_items 有权限', authGrants['meal_items'] ?? '无');
  check(
    (authGrants['daily_summary'] ?? '') === 'SELECT',
    'daily_summary 只给 authenticated SELECT（写入归触发器）',
    authGrants['daily_summary'] ?? '无',
  );
  check(!authGrants['invite_codes'], 'authenticated 对 invite_codes 没有权限');

  // 这一条是 0005 的核心断言。
  // TRUNCATE 是表级操作，**RLS 对它无效** —— 有权限就是「一条语句清空全库」。
  // 它是 Supabase 默认授权里悄悄带上的，GRANT 加不回来也删不掉，只有 REVOKE 能收。
  const truncatable = grants.filter(
    (g) => g.grantee === 'authenticated' && g.privs.split(',').includes('TRUNCATE'),
  );
  check(
    truncatable.length === 0,
    'authenticated 在任何表上都没有 TRUNCATE（RLS 管不了它）',
    truncatable.length ? `有：${truncatable.map((g) => g.table_name).join(', ')}` : '',
  );

  // ── 8. 端到端：以 authenticated 身份真的插一条 ──────────────────────
  console.log('\n【8】端到端写入（这一步才真正证明 RLS 路径通）');
  const testEmail = `selfcheck+${Date.now()}@example.invalid`;
  const [newUser] = await sql`
    insert into auth.users (id, email, created_at)
    values (gen_random_uuid(), ${testEmail}, now())
    returning id`;
  const profileCount = await sql`
    select count(*)::int as n from public.profiles where id = ${newUser.id}`;
  check(profileCount[0].n === 1, '插入 auth.users 后 profiles 自动建档（handle_new_user 生效）');

  // 以真实 authenticated 角色 + 伪造 JWT 身份执行
  await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: newUser.id })}, true)`;
    await tx`set local role authenticated`;
    const [food] = await tx`select id, name from public.foods where slug = 'rice-white-cooked'`;
    check(!!food, '以 authenticated 身份能读到内置食物', food?.name ?? '');
    const [serv] = await tx`
      select label, grams from public.food_servings where food_id = ${food.id} and is_default`;
    check(!!serv, '能读到默认份量', serv ? `${serv.label} = ${serv.grams}g` : '');
    await tx`
      insert into public.meal_items
        (user_id, log_date, meal_type, food_id, quantity_g, food_name,
         kcal, protein_g, fat_g, carb_g)
      values (${newUser.id}, current_date, 'lunch', ${food.id}, 150, ${food.name},
              174, 3.9, 0.45, 38.85)`;
    const [sum] = await tx`
      select intake_kcal, item_count from public.daily_summary
      where user_id = ${newUser.id} and log_date = current_date`;
    check(
      Number(sum?.intake_kcal) === 174 && sum?.item_count === 1,
      '写入后 daily_summary 被触发器自动汇总（SECURITY DEFINER 生效）',
      sum ? `${sum.intake_kcal} kcal / ${sum.item_count} 项` : '没有汇总行',
    );
  });

  // 换个身份，确认读不到别人的数据
  await sql.begin(async (tx) => {
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: newUser.id })}, true)`;
    await tx`set local role authenticated`;
    const other = await tx`
      select count(*)::int as n from public.meal_items
      where user_id <> ${newUser.id}`;
    check(other[0].n === 0, 'RLS 挡住了别人的数据（跨用户查询返回 0 行）');
  });

  // 清理测试用户（CASCADE 会带走 profiles / meal_items / daily_summary）
  await sql`delete from auth.users where id = ${newUser.id}`;
  const leftover = await sql`
    select
      (select count(*)::int from public.profiles where id = ${newUser.id}) as p,
      (select count(*)::int from public.meal_items where user_id = ${newUser.id}) as m,
      (select count(*)::int from public.daily_summary where user_id = ${newUser.id}) as d`;
  check(
    leftover[0].p === 0 && leftover[0].m === 0 && leftover[0].d === 0,
    '删用户时 CASCADE 清掉了全部关联数据',
  );

  // ── 收尾 ───────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(58)}`);
  if (fail === 0) {
    console.log(`\x1b[32m\x1b[1m真实 Supabase 体检通过：${pass} 项\x1b[0m`);
  } else {
    console.log(`\x1b[31m\x1b[1m${fail} 项失败 / 共 ${pass + fail} 项\x1b[0m`);
  }
  console.log(`${'─'.repeat(58)}\n`);
  process.exitCode = fail === 0 ? 0 : 1;
} catch (err) {
  console.error('\n\x1b[31m体检中断：\x1b[0m', err.message);
  if (err.hint) console.error('提示：', err.hint);
  process.exitCode = 1;
} finally {
  await sql.end();
}
