#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
//  data/*.csv  →  drizzle/0003_seed_foods.sql
// ═══════════════════════════════════════════════════════════════════════
//
//  运行：node scripts/build-seed.mjs
//
//  【为什么种子数据要编译成迁移，而不是写成一个 seed 脚本】
//
//  两者的区别在"什么时候跑"：
//
//    迁移（migration）  ──→ 由 drizzle-kit migrate 自动执行，且【只执行一次】
//                           （执行记录写在自己维护的 __drizzle_migrations 表里）
//    seed 脚本          ──→ 需要人记得手动跑。新环境部署时忘了跑，
//                           网站能打开，但搜索任何食物都是空的
//
//  食物库不是"演示数据"，它是【产品的一部分】—— 没有它，记录饮食
//  这个核心功能根本不可用。所以它必须和建表语句一起、在同一个
//  命令里被装上。这就是把它做成迁移的理由。
//
//  【为什么还要一个生成脚本，而不是手写 SQL】
//
//  CSV 是数据的"源文件"，人可读、可 diff、可用 Excel 打开核对。
//  SQL 是"编译产物"。生成脚本负责在两者之间做校验 —— 校验失败就
//  拒绝生成，这样错误数据永远进不了数据库。
//
// ═══════════════════════════════════════════════════════════════════════

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = join(ROOT, 'data');
const OUT_FILE = join(ROOT, 'drizzle', '0003_seed_foods.sql');

// ── 确定性 UUID ────────────────────────────────────────────────────────
//
//  【为什么不用 gen_random_uuid()】
//
//  如果用随机 UUID，那么同一份 CSV 在 A 环境和 B 环境会生成【不同的 id】。
//  后果：
//    · 两个人对照数据库排查问题，看到的 id 完全不一样，没法对话
//    · 种子数据不能"重新导入"—— 因为认不出哪一行是同一行
//    · 导出的 CSV 数据无法跨环境比对
//
//  用 UUIDv5（名字 → 哈希 → UUID）就没有这个问题：同一个 slug
//  在任何机器、任何时间都得到同一个 UUID。这叫"确定性 id"。
//
//  为什么不直接在 Postgres 里调 uuid_generate_v5()？
//  那需要安装 uuid-ossp 扩展。Supabase 能装，但自建 Postgres 未必开了，
//  而我们的迁移要能在任何 Postgres 上跑。预先算好、写死在 SQL 里，
//  零依赖，最稳。
//
//  ⚠️ 这个命名空间是【本项目的身份】，一旦改了，所有食物 id 全变，
//     已有的饮食记录会全部失去关联。永远不要改它。
const NAMESPACE = '7b1c9e42-5d3a-4f68-9c07-2e8b4a6f1d53';

function uuidV5(name) {
  const nsBytes = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1')
    .update(Buffer.concat([nsBytes, Buffer.from(name, 'utf8')]))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // 版本位 = 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // 变体位 = RFC 4122
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── CSV 解析 ───────────────────────────────────────────────────────────
// 只需要处理我们自己的数据，所以支持 RFC 4180 的双引号转义就够了，
// 不需要引一个 csv 库。
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch !== '\r') field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }

  const header = rows.shift();
  return rows
    .filter((r) => r.length > 1 || r[0] !== '')
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// ── SQL 字面量 ─────────────────────────────────────────────────────────
function q(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}
function num(v) {
  return v === '' || v === null || v === undefined ? 'NULL' : String(Number(v));
}
function text(v) {
  return v === '' || v === null || v === undefined ? 'NULL' : q(v);
}
function arr(items) {
  if (items.length === 0) return `ARRAY[]::text[]`;
  return `ARRAY[${items.map(q).join(', ')}]`;
}

// ── 校验 ───────────────────────────────────────────────────────────────
const errors = [];
const warnings = [];

//  categories：与 data/foods.csv 中实际使用的分类保持一致
const CATEGORIES = new Set([
  '谷薯', '豆类', '蔬菜', '菌藻', '水果', '畜肉', '禽肉', '水产', '蛋类',
  '奶类', '坚果', '油脂', '糕点零食', '饮料', '调味品', '快餐外卖', '菜肴',
]);

//  schema 上写死的 CHECK 约束，在这里先拦一遍 ——
//  等到 INSERT 时才发现，报错信息会是一句难懂的
//  'new row for relation "foods" violates check constraint'
const ALLOWED_SOURCES = new Set(['builtin', 'user', 'usda', 'off']);
const SOURCE_MAP = { knowledge: 'builtin' };

//  酒精饮品是 Atwater 公式的【已知例外】：酒精 7 kcal/g 不在这条公式里。
//  白酒/啤酒/红酒的实测热量会明显高于 4p+9f+4c+2fib 的推算值。
//  这不是数据错误 —— 是对"热量从哪来"的理解不完整。
const ALCOHOL_IDS = new Set(['baijiu', 'beer', 'red-wine']);

function checkFood(f) {
  const where = `foods.csv 第 ${f.__line} 行 (${f.id})`;

  if (!f.id) errors.push(`${where}: id 为空`);
  if (!f.name) errors.push(`${where}: name 为空`);
  if (f.name && f.name.length > 40) errors.push(`${where}: name 过长（${f.name.length} 字）`);

  if (!CATEGORIES.has(f.category)) {
    errors.push(`${where}: category "${f.category}" 不在允许的 17 类里`);
  }

  //  source 必须映射到 schema 允许的枚举值
  const mappedSource = SOURCE_MAP[f.source] ?? f.source;
  if (!ALLOWED_SOURCES.has(mappedSource)) {
    errors.push(
      `${where}: source "${f.source}" 映射后为 "${mappedSource}"，` +
        `但 schema CHECK 只允许 ${[...ALLOWED_SOURCES].join(' / ')}`,
    );
  }

  //  数值范围 —— 对照 schema 上的 CHECK 约束
  const limits = [
    ['kcal', 0, 900],
    ['protein_g', 0, 100],
    ['fat_g', 0, 100],
    ['carb_g', 0, 100],
  ];
  for (const [col, lo, hi] of limits) {
    const v = Number(f[col]);
    if (f[col] === '' || Number.isNaN(v)) {
      errors.push(`${where}: ${col} 不是数字（"${f[col]}"）`);
    } else if (v < lo || v > hi) {
      //  超上限最常见的真实原因：把「每份」的值填进了「每 100g」的列
      errors.push(`${where}: ${col} = ${v}，超出 schema 允许的 [${lo}, ${hi}]`);
    }
  }
  if (f.fiber_g !== '' && (Number(f.fiber_g) < 0 || Number(f.fiber_g) > 100)) {
    errors.push(`${where}: fiber_g = ${f.fiber_g} 超出 [0, 100]`);
  }
  if (f.sodium_mg !== '' && Number(f.sodium_mg) < 0) {
    errors.push(`${where}: sodium_mg = ${f.sodium_mg} 为负`);
  }

  //  ── Atwater 交叉验算 ──────────────────────────────────────────────
  //  用各营养素反推热量，和标注热量对比。
  //  这是食物数据库最重要的一条自检：它能抓到"热量和营养素对不上"
  //  ——通常意味着录错了一列。
  //
  //  容差 max(25 kcal, 20%)：
  //    小热量食物（如白粥 46 kcal）绝对误差容易超过 20%，
  //    所以给一个 25 kcal 的绝对下限兜底。
  if (!ALCOHOL_IDS.has(f.id)) {
    const p = Number(f.protein_g) || 0;
    const fat = Number(f.fat_g) || 0;
    const carb = Number(f.carb_g) || 0;
    const fib = Number(f.fiber_g) || 0;
    //  碳水用 4 kcal/g：本 CSV 的 carb_g 是【可利用碳水】（= 总碳水 − 纤维），
    //  纤维单独用 2 kcal/g 计。如果 carb_g 用的是总碳水，这条公式会重复计算纤维。
    const atwater = 4 * p + 9 * fat + 4 * carb + 2 * fib;
    const kcal = Number(f.kcal);
    const tol = Math.max(25, kcal * 0.2);
    const diff = Math.abs(atwater - kcal);
    if (diff > tol) {
      errors.push(
        `${where}: Atwater 校验失败 —— ` +
          `4×${p} + 9×${fat} + 4×${carb} + 2×${fib} = ${atwater.toFixed(1)} kcal，` +
          `但标注 ${kcal} kcal，差 ${diff.toFixed(1)}（容差 ${tol.toFixed(1)}）`,
      );
    }
  }
}

// ── 主流程 ─────────────────────────────────────────────────────────────
const foodsRaw = parseCsv(readFileSync(join(DATA_DIR, 'foods.csv'), 'utf8'));
const servingsRaw = parseCsv(readFileSync(join(DATA_DIR, 'food_servings.csv'), 'utf8'));

foodsRaw.forEach((f, i) => { f.__line = i + 2; }); // +2 = 表头 + 1-based
servingsRaw.forEach((s, i) => { s.__line = i + 2; });

//  1. 逐行校验
foodsRaw.forEach(checkFood);

//  2. id 唯一性
const seen = new Map();
for (const f of foodsRaw) {
  if (seen.has(f.id)) {
    errors.push(`foods.csv: id "${f.id}" 重复（第 ${seen.get(f.id)} 行和第 ${f.__line} 行）`);
  }
  seen.set(f.id, f.__line);
}

//  2b. 酒精豁免的失效保护
//
//  ALCOHOL_IDS 是一个【硬编码的 id 名单】。如果哪天有人把 baijiu 改名成
//  chinese-liquor，豁免就会静默失效 —— 然后构建会以一句难懂的
//  Atwater 错误失败（"差 298.0，容差 59.6"），排查半天才发现是名单过期。
//  这里提前把它变成一句说人话的报错。
const foodIds = new Set(foodsRaw.map((f) => f.id));
for (const id of ALCOHOL_IDS) {
  if (!foodIds.has(id)) {
    errors.push(
      `ALCOHOL_IDS 里的 "${id}" 在 foods.csv 中不存在 —— 酒精豁免已失效。` +
        `若该食物被改名，请同步更新 scripts/build-seed.mjs 的 ALCOHOL_IDS。`,
    );
  }
}

//  3. 份量表的引用完整性 + 每个食物最多一个默认份量
const defaultsPerFood = new Map();
for (const s of servingsRaw) {
  const where = `food_servings.csv 第 ${s.__line} 行`;
  if (!foodIds.has(s.food_id)) {
    errors.push(`${where}: food_id "${s.food_id}" 在 foods.csv 里不存在（引用完整性）`);
  }
  if (!s.label) errors.push(`${where}: label 为空`);
  const g = Number(s.grams);
  if (s.grams === '' || Number.isNaN(g)) errors.push(`${where}: grams 不是数字`);
  else if (g <= 0) errors.push(`${where}: grams = ${g}，必须 > 0`);
  else if (g > 3000) errors.push(`${where}: grams = ${g}，超过 3000g 上限（疑似填错单位）`);

  if (s.is_default === 'true') {
    const n = (defaultsPerFood.get(s.food_id) ?? 0) + 1;
    defaultsPerFood.set(s.food_id, n);
    if (n > 1) {
      //  这条被数据库的部分唯一索引 food_servings_one_default 拦，
      //  在这里先报出来能给出更清楚的定位信息。
      errors.push(`${where}: "${s.food_id}" 有第 ${n} 个默认份量（数据库只允许 1 个）`);
    }
  }
}

//  4. 内置食物必须【每一个都有默认份量】
//     没有默认份量，用户点进搜索结果的瞬间就得先想"多少克"，
//     「10 秒记一顿饭」直接破功（需求 P2）。
const withDefault = new Set(
  servingsRaw.filter((s) => s.is_default === 'true').map((s) => s.food_id),
);
const missingDefault = foodsRaw.filter((f) => !withDefault.has(f.id));
if (missingDefault.length) {
  errors.push(
    `${missingDefault.length} 个食物没有默认份量（记录时会强迫用户想克数）：` +
      missingDefault.slice(0, 10).map((f) => f.id).join(', ') +
      (missingDefault.length > 10 ? ' …' : ''),
  );
}

//  5. 报告校验结果
console.log(`读取 ${foodsRaw.length} 条食物、${servingsRaw.length} 条份量`);
if (warnings.length) {
  console.log('\n⚠️  警告：');
  warnings.forEach((w) => console.log(`   · ${w}`));
}
if (errors.length) {
  console.error(`\n❌ 校验失败，共 ${errors.length} 项 —— 拒绝生成迁移文件：\n`);
  errors.forEach((e) => console.error(`   · ${e}`));
  process.exit(1);
}
console.log('✓ Atwater 交叉验算、数值范围、分类枚举、引用完整性、默认份量 全部通过');

//  顺手报告"最紧的几条"：容差余量最小的数据最可能是下一个出错的地方。
//  如果某天某条余量掉到接近 0，说明那行数据大概是录错了。
const margins = foodsRaw
  .filter((f) => !ALCOHOL_IDS.has(f.id))
  .map((f) => {
    const at = 4 * (+f.protein_g || 0) + 9 * (+f.fat_g || 0) + 4 * (+f.carb_g || 0) + 2 * (+f.fiber_g || 0);
    const tol = Math.max(25, +f.kcal * 0.2);
    return { id: f.id, margin: tol - Math.abs(at - +f.kcal) };
  })
  .sort((a, b) => a.margin - b.margin);
console.log(
  `  Atwater 余量最小：${margins.slice(0, 3).map((m) => `${m.id} ${m.margin.toFixed(1)}`).join(' / ')}` +
    `（豁免 ${ALCOHOL_IDS.size} 条酒精饮品：酒精 7 kcal/g 不在 Atwater 公式里）`,
);

//  6. 生成 SQL
const foodsSorted = [...foodsRaw].sort((a, b) => a.id.localeCompare(b.id));
const servingsSorted = [...servingsRaw].sort(
  (a, b) => a.food_id.localeCompare(b.food_id) || Number(a.sort_order) - Number(b.sort_order),
);

const foodValues = foodsSorted
  .map((f) => {
    const id = uuidV5(`food:${f.id}`);
    const aliases = f.aliases ? f.aliases.split('|').filter(Boolean) : [];
    const source = SOURCE_MAP[f.source] ?? f.source;
    //  confidence 不是数据库列，但它决定 is_verified：
    //    high   = 来自权威成分表，通过交叉验算
    //    medium = 估算值（菜肴、外卖 —— 真实做法差异极大）
    //  前端用 is_verified 决定要不要显示「估算」角标，这是对用户诚实。
    const isVerified = f.confidence === 'high';
    return (
      `  (${q(id)}, NULL, ${q(f.id)}, ${q(f.name)}, ${arr(aliases)}, ${q(f.category)}, ` +
      `${num(f.kcal)}, ${num(f.protein_g)}, ${num(f.fat_g)}, ${num(f.carb_g)}, ` +
      `${num(f.fiber_g)}, ${num(f.sodium_mg)}, ${q(source)}, ${text(f.source_ref)}, ` +
      `${isVerified ? 'true' : 'false'})`
    );
  })
  .join(',\n');

const servingValues = servingsSorted
  .map((s) => {
    const id = uuidV5(`serving:${s.food_id}:${s.label}`);
    const foodId = uuidV5(`food:${s.food_id}`);
    return (
      `  (${q(id)}, ${q(foodId)}, ${q(s.label)}, ${num(s.grams)}, ` +
      `${s.is_default === 'true' ? 'true' : 'false'}, ${Number(s.sort_order) || 0})`
    );
  })
  .join(',\n');

const highCount = foodsRaw.filter((f) => f.confidence === 'high').length;

const sql = `-- ═══════════════════════════════════════════════════════════════════════
--  0003_seed_foods.sql —— 内置食物库种子数据
-- ═══════════════════════════════════════════════════════════════════════
--
--  ⚠️ 这个文件是【自动生成的，不要手改】。
--     改 data/foods.csv 或 data/food_servings.csv，然后重新运行：
--         node scripts/build-seed.mjs
--
--  数据来源与校验规则见 docs/05-食物库数据.md
--
--  ── 这批数据的来历 ──────────────────────────────────────────────────
--  194 条常见中式食物，由中国食物成分表第 6 版的知识体系构成。
--  营养值一律以【每 100 克可食部】为基准 —— 这是我们抄 wger 的核心设计：
--  日志表只存"吃了多少克"，热量在查询时换算。
--
--    high   ${String(highCount).padStart(3)} 条  来自权威成分表，通过 Atwater 交叉验算
--    medium ${String(foodsRaw.length - highCount).padStart(3)} 条  估算值（菜肴 / 快餐外卖，
--              按"200g 生料 + 10g 油"的标准做法推算，真实店铺差异可达 ±30%）
--
--  估算值这条不是数据质量问题，是【物理事实】：同一道"鱼香肉丝"，
--  不同餐馆的油量能差一倍。与其假装精确，不如在 UI 上标出来。
--
--  ── 为什么 source 是 'builtin' 而不是 CSV 里写的 'knowledge' ────────
--  foods 表上有一条 CHECK：source in ('builtin','user','usda','off')。
--  'knowledge' 是数据整理阶段的内部标记（表示"来自我自己的知识库、
--  没有可引用的在线数据源 ID"），它不是一个对应用有意义的取值。
--  映射成 'builtin' 后，含义变成"随产品一起发布的内置数据" —— 这才是
--  应用真正关心的区分：内置 / 用户自建 / 来自 USDA / 来自 OFF。
--  生成脚本会在 source 映射后不合法时直接拒绝出文件。
--
--  ── 为什么每一行都写死了 UUID ───────────────────────────────────────
--  这些 UUID 是 UUIDv5(命名空间, "food:<slug>") 算出来的，确定性生成：
--  同一个 slug 在任何机器上永远得到同一个 UUID。好处是种子可重复导入、
--  可跨环境比对。详见 scripts/build-seed.mjs 里的说明。
--
--  ── 幂等性 ──────────────────────────────────────────────────────────
--  两个 INSERT 都用 ON CONFLICT (id) DO UPDATE，重复执行不会产生重复行，
--  也会把已有的内置食物【更新】到 CSV 的最新值。
--  注意：更新内置食物不会影响用户已有的饮食记录 —— 因为 meal_items
--  同时存了快照值，历史上"当时算出来是多少"已经被记录下来了。
-- ═══════════════════════════════════════════════════════════════════════

INSERT INTO public.foods (
  id, owner_id, slug, name, aliases, category,
  kcal, protein_g, fat_g, carb_g, fiber_g, sodium_mg,
  source, source_ref, is_verified
) VALUES
${foodValues}
ON CONFLICT (id) DO UPDATE SET
  slug        = EXCLUDED.slug,
  name        = EXCLUDED.name,
  aliases     = EXCLUDED.aliases,
  category    = EXCLUDED.category,
  kcal        = EXCLUDED.kcal,
  protein_g   = EXCLUDED.protein_g,
  fat_g       = EXCLUDED.fat_g,
  carb_g      = EXCLUDED.carb_g,
  fiber_g     = EXCLUDED.fiber_g,
  sodium_mg   = EXCLUDED.sodium_mg,
  source      = EXCLUDED.source,
  source_ref  = EXCLUDED.source_ref,
  is_verified = EXCLUDED.is_verified,
  updated_at  = now();

--> statement-breakpoint

INSERT INTO public.food_servings (id, food_id, label, grams, is_default, sort_order) VALUES
${servingValues}
ON CONFLICT (id) DO UPDATE SET
  label      = EXCLUDED.label,
  grams      = EXCLUDED.grams,
  is_default = EXCLUDED.is_default,
  sort_order = EXCLUDED.sort_order;

-- ═══════════════════════════════════════════════════════════════════════
--  统计：内置食物 ${foodsRaw.length} 条，份量 ${servingsRaw.length} 条。
--  验证：npm run db:verify
-- ═══════════════════════════════════════════════════════════════════════
`;

writeFileSync(OUT_FILE, sql, 'utf8');

const bytes = Buffer.byteLength(sql, 'utf8');
console.log(
  `\n✓ 已写出 ${OUT_FILE.replace(ROOT + '/', '')}  ` +
    `(${foodsRaw.length} 食物 / ${servingsRaw.length} 份量 / ${(bytes / 1024).toFixed(1)} KB)`,
);
