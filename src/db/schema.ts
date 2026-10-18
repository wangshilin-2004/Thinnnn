/**
 * ═══════════════════════════════════════════════════════════════
 *  Drizzle Schema —— 数据库结构的唯一事实来源（Single Source of Truth）
 * ═══════════════════════════════════════════════════════════════
 *
 *  设计依据：docs/04-数据模型.md（已用 PGlite 跑过 22 项断言验证）
 *
 *  【这个文件里有什么 / 没有什么】
 *    ✅ 有：表、列、类型、外键、CHECK 约束、索引
 *    ❌ 没有：RLS 策略、触发器函数、GRANT
 *
 *  为什么分开？因为 drizzle-kit 认识前者，不认识后者。
 *  后者手写在 drizzle/0001_security_and_triggers.sql 里，
 *  但和这个文件在同一套迁移流水线中按顺序执行 —— 不会漏跑。
 *
 *  【改了这个文件之后要做什么】
 *    npm run db:generate   → 自动生成 drizzle/000X_xxx.sql
 *    npm run db:migrate    → 把迁移真正执行到数据库
 *  永远不要手动去数据库里改表结构，否则代码和数据库会漂移。
 */

import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// ═══════════════════════════════════════════════════════════════
//  ⚠️ 重要：为什么这个文件里【看不到】auth.users
// ═══════════════════════════════════════════════════════════════
//
//  所有指向 users 的外键（profiles.id、meal_items.user_id …）在这里
//  都只是普通的 `uuid` 列，**没有** .references()。外键约束写在
//  drizzle/0001_security_and_triggers.sql 里手写 SQL 添加。
//
//  【为什么不能在这里声明 auth.users】
//  直觉做法是在 TS 里写一份镜像：
//
//      const authUsers = pgSchema('auth').table('users', { id: uuid('id') });
//
//  实测下来这条路是错的，而且错得很危险：
//
//  1. `drizzle-kit generate` 不看数据库，只看 TS —— 它会生成
//         CREATE SCHEMA "auth";
//         CREATE TABLE "auth"."users" ("id" uuid PRIMARY KEY NOT NULL);
//     而在真实 Supabase 上，auth schema 和 auth.users **早就存在**，
//     迁移第一步就会报 "schema auth already exists" 而全线失败。
//
//  2. 更糟的是 `drizzle-kit push` —— 它拿 TS schema 和**线上数据库**
//     对比。它看到真实的 auth.users 有 email / encrypted_password /
//     created_at … 而镜像里只有 id，就会生成
//         ALTER TABLE auth.users DROP COLUMN "email", DROP COLUMN ...
//     把 Supabase 的认证系统整个拆掉。数据还在，但没人能登录了。
//
//  3. 即使侥幸跑通，drizzle-kit 从此会认为 auth.users 归它管，
//     每次 Supabase 升级 auth schema，你的迁移就想"修正"它。
//
//  【所以：auth schema 的所有权归 Supabase，我们不碰】
//  我们只做两件事：读 auth.uid()、用外键指向 auth.users(id)。
//  后者由手写迁移完成（见 0001 文件里的第 2 节）。
//
//  【代价与纪律】
//  以后新增任何带 user_id 的表，别忘了在同一个迁移里补上它的外键。
//  0001 文件末尾有一份「外键清单」用来核对，别漏。

// ═══════════════════════════════════════════════════════════════
//  1. profiles —— 用户档案与目标
// ═══════════════════════════════════════════════════════════════
//  与 auth.users 是 1:1。用一个 AFTER INSERT 触发器在注册时自动建档
//  （见 0001 迁移文件），这样无论用户从哪条路径注册都不会漏。

export const profiles = pgTable(
  'profiles',
  {
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    id: uuid('id').primaryKey(),

    displayName: text('display_name').notNull().default(''),

    // ── 社交身份（迁移 0010）───────────────────────────────
    // 加好友靠它，不用邮箱。格式在数据库里用 CHECK 钉死：
    // 3–20 位小写字母/数字/下划线，首字符必须是字母。
    username: text('username'),

    // 好友能看到我的什么。默认开 —— 「接受好友申请」本身就是同意，
    // 默认关的话加完好友两边都是空的，看起来像坏了。
    shareMeals: boolean('share_meals').notNull().default(true),
    shareTraining: boolean('share_training').notNull().default(true),

    // 关键字段：用户在哪个时区。所有「今天是几号」的计算都依赖它。
    // 详见 docs/04 §10 —— Vercel 服务器跑在 UTC，不处理时区会把
    // 北京时间早上的早餐记到昨天去。
    timezone: text('timezone').notNull().default('Asia/Shanghai'),

    // ── 计算 BMR 需要的输入 ────────────────────────────────
    // 存 birth_date 而不是 age：年龄每年会变，
    // 存 age 的话用户一年后回来 BMR 就是错的，而且你永远不知道
    // 他是哪年填的。存出生日期，永远算得对。
    sex: text('sex'),
    birthDate: date('birth_date', { mode: 'string' }),
    heightCm: numeric('height_cm', { precision: 5, scale: 1 }),
    activityLevel: text('activity_level'),

    // ── 目标 ───────────────────────────────────────────────
    goalType: text('goal_type'),
    startWeightKg: numeric('start_weight_kg', { precision: 5, scale: 2 }),
    targetWeightKg: numeric('target_weight_kg', { precision: 5, scale: 2 }),
    rateKgPerWeek: numeric('rate_kg_per_week', { precision: 3, scale: 2 }),

    // ── 计算结果（存下来而不是每次现算）────────────────────
    // 三个理由：
    //  1. 用户可能手动覆盖建议值（"系统说 1800，我就要 1700"）
    //  2. 历史要用「当时的目标」来评判 —— 今天改了目标，
    //     不该让上个月每天都看起来"超标"
    //  3. 省掉每次渲染的重算
    bmrKcal: integer('bmr_kcal'),
    tdeeKcal: integer('tdee_kcal'),
    targetKcal: integer('target_kcal'),
    targetProteinG: numeric('target_protein_g', { precision: 5, scale: 1 }),
    targetCarbG: numeric('target_carb_g', { precision: 5, scale: 1 }),
    targetFatG: numeric('target_fat_g', { precision: 5, scale: 1 }),

    // 公式版本号。营养学公式会更新（Mifflin-St Jeor 未必永远是最好
    // 的选择），存版本号将来能批量找出"哪些用户的目标是旧公式算的"。
    calcVersion: text('calc_version').notNull().default('v1'),

    // NULL = 还没走完引导流程。用它判断要不要把用户送去 /onboarding
    onboardedAt: timestamp('onboarded_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('profiles_sex_check', sql`${t.sex} is null or ${t.sex} in ('male','female')`),
    check(
      'profiles_activity_level_check',
      sql`${t.activityLevel} is null or ${t.activityLevel} in ('sedentary','light','moderate','active','very_active')`,
    ),
    check(
      'profiles_goal_type_check',
      sql`${t.goalType} is null or ${t.goalType} in ('lose','maintain','gain')`,
    ),
    check('profiles_height_cm_check', sql`${t.heightCm} is null or ${t.heightCm} between 50 and 260`),
    check(
      'profiles_rate_kg_per_week_check',
      sql`${t.rateKgPerWeek} is null or ${t.rateKgPerWeek} between 0 and 1.5`,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  2. foods —— 食物库（所有营养值以「每 100 克」为基准）
// ═══════════════════════════════════════════════════════════════
//  这条规则来自对 wger 源码的实测：它的 Ingredient.energy 字段
//  help_text 原文就是 'In kcal per 100g'。
//
//  为什么这条规则值钱：用户吃 200g 米饭，初学者会直接把「232 kcal」
//  写进日志表 —— 那样一旦发现食物库某条数据录错，全部历史都是错的，
//  而且没法自动修复（因为"吃了多少克"这个原始信息已经丢了）。
//  统一按每 100g 存 + 日志表存 quantity_g，任何时候都能重算。

export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // NULL = 系统内置（所有人可见）
    // 非 NULL = 用户自建（只有本人可见）
    // 这样设计让「全局食物库」和「我的自定义食物」共用一张表：
    // 查询不用 UNION，RLS 也能用一条表达式覆盖两种可见性。
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    ownerId: uuid('owner_id'),

    name: text('name').notNull(),

    // 稳定业务键。内置食物用它做种子数据的幂等键 ——
    // 有了它，「重新导入食物库」就是一句 ON CONFLICT (slug) DO UPDATE，
    // 而不是「先清空再插入」（那样用户的历史记录会因为 ON DELETE SET NULL
    // 全部失去 food_id，从此无法按当前食物库重算）。
    //
    // 用户自建食物留空（Postgres 的唯一索引不约束 NULL，
    // 所以任意多条 NULL 共存，不会互相冲突）。
    slug: text('slug'),

    // 别名，如「米饭」「大米饭」「白饭」
    aliases: text('aliases')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),

    // 拼音全拼 / 首字母，支持输入 mifan 或 mf 搜到「米饭」
    pinyin: text('pinyin'),
    pinyinInitials: text('pinyin_initials'),

    category: text('category').notNull(),

    // ── 营养值，全部是「每 100 克」────────────────────────
    // kcal 上限 900：纯油脂是 884-900 kcal/100g（9 kcal/g 的理论上限）。
    // 超过 900 一定是数据错了 —— 最常见的原因是把「每份」的值
    // 填进了「每 100g」的列。
    kcal: numeric('kcal', { precision: 6, scale: 1 }).notNull(),
    proteinG: numeric('protein_g', { precision: 5, scale: 1 }).notNull().default('0'),
    fatG: numeric('fat_g', { precision: 5, scale: 1 }).notNull().default('0'),
    carbG: numeric('carb_g', { precision: 5, scale: 1 }).notNull().default('0'),

    // 可空：很多食物没有可靠的纤维/钠数据，与其填 0 假装知道，不如留空
    fiberG: numeric('fiber_g', { precision: 5, scale: 1 }),
    sodiumMg: numeric('sodium_mg', { precision: 8, scale: 1 }),

    source: text('source').notNull().default('user'),
    sourceRef: text('source_ref'),

    // 为什么用「软标记」而不是硬 CHECK 校验 4p+9f+4c 是否等于 kcal：
    // 含酒精饮品（酒精 7 kcal/g）和含糖醇食品（赤藓糖醇约 0.2 kcal/g）
    // 会合理地偏离这个公式。硬 CHECK 会把合法数据挡在门外。
    isVerified: boolean('is_verified').notNull().default(false),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('foods_kcal_check', sql`${t.kcal} >= 0 and ${t.kcal} <= 900`),
    check('foods_protein_g_check', sql`${t.proteinG} >= 0 and ${t.proteinG} <= 100`),
    check('foods_fat_g_check', sql`${t.fatG} >= 0 and ${t.fatG} <= 100`),
    check('foods_carb_g_check', sql`${t.carbG} >= 0 and ${t.carbG} <= 100`),
    check(
      'foods_source_check',
      sql`${t.source} in ('builtin','user','usda','off')`,
    ),

    // ── 内置食物必须有 slug ──────────────────────────────────────────
    //
    //  这条约束来自一次实测发现：测试夹具以 postgres 超级用户身份插入了
    //  一条 owner_id 为 NULL 的食物，它立刻变成了一条"对所有人可见"
    //  的内置食物，而且没有 slug（没有稳定身份，无法被种子数据重新导入）。
    //
    //  它揭示的洞：
    //    · 已登录用户【造不出】这种行 —— foods 的 INSERT 策略要求
    //      owner_id = auth.uid()，而 auth.uid() 永不为 NULL
    //    · 但【服务端代码能】—— Server Action 走 postgres 直连，
    //      而 postgres 是表属主，天然绕过 RLS
    //
    //  也就是说，RLS 挡得住用户，挡不住我们自己写错的代码。
    //  这条 CHECK 是第二道防线，且它对所有角色一视同仁（CHECK 不受 RLS 影响）。
    //
    //  写成 "owner_id is not null or slug is not null"，
    //  等价于 "owner_id is null → slug is not null"，但避免了蕴含式在
    //  SQL 里容易写错的问题（`A implies B` 要写成 `not A or B`）。
    check('foods_builtin_needs_slug', sql`${t.ownerId} is not null or ${t.slug} is not null`),

    // ── 食物名不能是空白 ─────────────────────────────────────────────
    //  notNull() 只防 NULL，不防空字符串。一条 name = '' 的食物会在
    //  搜索结果里变成一个看不见的空白行 —— 用户点下去才发现选了个
    //  没有名字的东西。这是典型的"不报错但很烦人"的数据问题。
    //  btrim 是必要的：'   ' 全是空格，length > 0 也会通过。
    check('foods_name_not_blank', sql`length(btrim(${t.name})) > 0`),

    // 分类浏览
    index('foods_category_idx').on(t.category),

    // 内置食物的 slug 唯一。
    // 这里用普通唯一索引而不是部分索引（WHERE owner_id IS NULL），
    // 因为 Postgres 的唯一索引【本来就不约束 NULL】—— 用户自建食物的
    // slug 全是 NULL，多条 NULL 可以共存。少一个 WHERE 子句，
    // 也少一个 ON CONFLICT 推断时的坑。
    uniqueIndex('foods_slug_uniq').on(t.slug),

    // 别名搜索走 GIN（倒排索引）。数组的「包含」查询用 B-tree 索引
    // 完全用不上，必须 GIN —— 这是「索引类型要匹配查询类型」的典型例子。
    index('foods_aliases_gin').using('gin', t.aliases),

    // 部分索引：只给「用户自建食物」建索引。
    // 内置食物有几万条且 owner_id 全是 NULL，把它们也索引进去
    // 纯属浪费空间。WHERE 子句让索引只覆盖真正需要的那部分行。
    index('foods_owner_idx')
      .on(t.ownerId)
      .where(sql`${t.ownerId} is not null`),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  3. food_servings —— 常见份量（把「克」翻译成「碗 / 个 / 份」）
// ═══════════════════════════════════════════════════════════════
//  这张表直接服务需求 P2（记录太麻烦）。
//  减脂新人根本不知道「200 克米饭」是多少，但知道「一碗」。
//  没有这张表，「10 秒记一顿饭」就是空话。

export const foodServings = pgTable(
  'food_servings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),

    label: text('label').notNull(), // "1 碗" / "1 个" / "1 份"
    grams: numeric('grams', { precision: 7, scale: 1 }).notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('food_servings_grams_check', sql`${t.grams} > 0`),

    // 同一个食物不能有两个叫「1 碗」的份量 —— 那只会让用户在
    // 下拉框里看到两个一模一样的选项，然后随便点一个。
    // 它同时是种子数据的幂等键：重新导入份量时按 (food_id, label)
    // 命中已有行，而不是不断追加。
    uniqueIndex('food_servings_food_label_uniq').on(t.foodId, t.label),

    // ── 部分唯一索引：每个食物最多一个默认份量 ─────────────
    // 为什么不能写成 UNIQUE(food_id, is_default)？
    // 那样会限制每个食物只能有一行 is_default = false ——
    // 而一个食物显然可以有很多个「非默认」份量。
    // 部分索引的 WHERE 子句让唯一性只对 is_default = true 的行生效。
    uniqueIndex('food_servings_one_default')
      .on(t.foodId)
      .where(sql`${t.isDefault}`),

    index('food_servings_food_sort_idx').on(t.foodId, t.sortOrder),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  4. meal_items —— 饮食记录
// ═══════════════════════════════════════════════════════════════
//  【为什么是扁平的，而不是 meal_logs + meal_items 两层】
//  wger 用的是 Plan → Meal → MealItem 三级结构，那是为「饮食计划」
//  设计的（我要制定下周食谱），不是为「记录」设计的（我刚吃了什么）。
//  两层结构的代价：每次记录多一次 INSERT 和一次 JOIN，还要处理
//  「这一餐删空了要不要删父行」的一致性。收益是餐级备注/照片，
//  而 P0 不需要这些。—— 所以砍掉一层。

export const mealItems = pgTable(
  'meal_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    userId: uuid('user_id').notNull(),

    // 业务日：按用户时区算出来的「日历上那一格」，不是时间轴上的点。
    // 用 date 而不是 timestamptz —— 详见 docs/04 §10。
    logDate: date('log_date', { mode: 'string' }).notNull(),

    mealType: text('meal_type').notNull(),
    loggedAt: timestamp('logged_at', { withTimezone: true }).notNull().defaultNow(),

    // ON DELETE SET NULL 而不是 CASCADE：
    // 用户删掉一个自建食物时，不该连带删掉他三个月前的饮食记录。
    // 有下面的文本和营养快照，记录依然完整可读，只是失去了"重算"能力。
    foodId: uuid('food_id').references(() => foods.id, { onDelete: 'set null' }),

    // ── 快照：写入时算好，之后不可变 ──────────────────────
    // docs/04 §2 记录了这里的权衡：wger 选择「活算」（每次查询时用
    // 当前食物库换算），好处是修正食物库能回溯历史；坏处是用户看到的
    // 历史数字会在背后悄悄变化。
    //
    // 我们的决策是两者都存：快照负责显示（历史就该是历史），
    // food_id + quantity_g 负责「按当前食物库重算」这个主动操作。
    foodName: text('food_name').notNull(),
    quantityG: numeric('quantity_g', { precision: 7, scale: 1 }).notNull(),
    servingId: uuid('serving_id').references(() => foodServings.id, {
      onDelete: 'set null',
    }),
    servingLabel: text('serving_label'),

    kcal: numeric('kcal', { precision: 7, scale: 1 }).notNull(),
    proteinG: numeric('protein_g', { precision: 6, scale: 1 }).notNull().default('0'),
    fatG: numeric('fat_g', { precision: 6, scale: 1 }).notNull().default('0'),
    carbG: numeric('carb_g', { precision: 6, scale: 1 }).notNull().default('0'),

    note: text('note'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'meal_items_meal_type_check',
      sql`${t.mealType} in ('breakfast','lunch','dinner','snack')`,
    ),
    check('meal_items_quantity_g_check', sql`${t.quantityG} > 0 and ${t.quantityG} <= 5000`),
    check('meal_items_kcal_check', sql`${t.kcal} >= 0`),

    // ── 索引列顺序为什么是 (user_id, log_date) 而不是反过来 ──
    // B-tree 索引遵循「最左前缀原则」：只有查询条件包含最左边的列，
    // 索引才可能被用上。我们每一条查询都带 user_id（多用户隔离是硬
    // 要求），所以 user_id 必须放最左；(log_date, user_id) 这个顺序
    // 只能服务「查所有用户某天」—— 而我们永远不做这个查询。
    index('meal_items_user_date_idx').on(t.userId, t.logDate.desc()),

    // 服务「最近常吃」窗口函数
    index('meal_items_user_food_date_idx').on(t.userId, t.foodId, t.logDate.desc()),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  5. measurements —— 通用指标（体重不是专用表）
// ═══════════════════════════════════════════════════════════════
//  这是从 wger 学到的最有价值的一条：它把体重建成
//  Measurement(category × date × value)，同一个枚举里装着
//  体重、体脂、腰围、睡眠、步数……
//
//  红利：以后要加腰围/体脂/睡眠，不用建新表、不用改一行查询代码，
//  只多一个 metric 值。而且「趋势图」组件是通用的 —— 同一份代码
//  能画所有指标。

export const measurements = pgTable(
  'measurements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    userId: uuid('user_id').notNull(),

    metric: text('metric').notNull(),
    measuredOn: date('measured_on', { mode: 'string' }).notNull(),
    value: numeric('value', { precision: 7, scale: 3 }).notNull(),
    unit: text('unit').notNull(),

    // 精确时刻。同样 70kg，早上空腹和晚上睡前能差 1kg ——
    // 记录时刻对解读体重波动很重要。
    measuredAt: timestamp('measured_at', { withTimezone: true }),

    // 'calculated' 是给派生指标预留的位置（比如 7 日移动平均体重）。
    // 现在不写，但枚举里留位 —— 学自 wger 的 MeasurementSource。
    source: text('source').notNull().default('manual'),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'measurements_metric_check',
      sql`${t.metric} in ('weight','body_fat','waist','chest','hip','arm','thigh','neck','sleep_hours','steps')`,
    ),
    check(
      'measurements_source_check',
      sql`${t.source} in ('manual','calculated','imported')`,
    ),
    check('measurements_value_check', sql`${t.value} > 0`),

    // ── 这个唯一索引直接实现了需求 F3：「同一天重复记录 → 覆盖」────
    // 配合 INSERT ... ON CONFLICT (user_id, metric, measured_on)
    // DO UPDATE，一句 SQL 搞定「今天已经记过了就改掉」，
    // 不需要先 SELECT 判断存在性（那是竞态条件）。
    uniqueIndex('measurements_user_metric_date_uniq').on(
      t.userId,
      t.metric,
      t.measuredOn,
    ),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  6. daily_summary —— 日汇总（为差异化图表服务）
// ═══════════════════════════════════════════════════════════════
//  由触发器维护，客户端只读。

export const dailySummary = pgTable(
  'daily_summary',
  {
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    userId: uuid('user_id').notNull(),
    logDate: date('log_date', { mode: 'string' }).notNull(),

    // 触发器维护（源数据一变就重算）
    intakeKcal: numeric('intake_kcal', { precision: 8, scale: 1 }).notNull().default('0'),
    proteinG: numeric('protein_g', { precision: 7, scale: 1 }).notNull().default('0'),
    fatG: numeric('fat_g', { precision: 7, scale: 1 }).notNull().default('0'),
    carbG: numeric('carb_g', { precision: 7, scale: 1 }).notNull().default('0'),
    itemCount: integer('item_count').notNull().default(0),

    // ── 从 measurements 冗余过来的体重 ─────────────────────
    // 「热量摄入 vs 体重趋势」是本项目的差异化立足点，它需要两条
    // 时序。不冗余的话查询要 FULL OUTER JOIN 两张表再排序；
    // 冗余之后就是一次顺序扫描：
    //   SELECT log_date, intake_kcal, weight_kg FROM daily_summary
    //   WHERE user_id = $1 AND log_date >= $2 ORDER BY log_date;
    weightKg: numeric('weight_kg', { precision: 5, scale: 2 }),

    // ── 那一天的「目标」快照 ───────────────────────────────
    // 如果存的是「当前目标」，用户今天把目标从 1800 改成 2000，
    // 历史曲线会整条变形 —— 上个月看起来天天都"没吃够"。
    targetKcal: integer('target_kcal'),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 复合主键。(user_id, log_date) 既是唯一约束，也是图表查询要走的索引。
    primaryKey({ columns: [t.userId, t.logDate] }),
    check('daily_summary_intake_kcal_check', sql`${t.intakeKcal} >= 0`),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  7. food_favorites —— 常用食物
// ═══════════════════════════════════════════════════════════════
//  复合主键天然保证「不会重复收藏」，而且 (user_id, food_id) 这个
//  索引直接就服务「我的收藏列表」查询 —— 不需要额外建索引。
//
//  注意：「最近常吃」不需要建表，它是从 meal_items 用窗口函数实时
//  算出来的（见 src/lib/queries.ts）。

export const foodFavorites = pgTable(
  'food_favorites',
  {
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0001 迁移里手写添加
    userId: uuid('user_id').notNull(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.foodId] })],
);

// ═══════════════════════════════════════════════════════════════
//  8. invite_codes —— 邀请码（ADR-008）
// ═══════════════════════════════════════════════════════════════
//  这张表是「最小权限原则」最直接的示范：
//  RLS 开启 + 一条策略都不建 + 一个 GRANT 都不给 = 三不沾。
//  Postgres 的 RLS 默认拒绝（deny by default）：没有策略就是谁都不许。
//  只有服务端用 postgres 角色（超级用户，绕过 RLS）能读写它。

export const inviteCodes = pgTable(
  'invite_codes',
  {
    code: text('code').primaryKey(),
    note: text('note'),
    maxUses: integer('max_uses').notNull().default(1),
    usedCount: integer('used_count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('invite_codes_max_uses_check', sql`${t.maxUses} >= 1`),
    check('invite_codes_used_count_check', sql`${t.usedCount} >= 0`),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  9. cardio_sessions —— 有氧记录
// ═══════════════════════════════════════════════════════════════
//
//  【为什么有氧和无氧是两张表，而不是一张加个 type 列】
//  两者的记录形状根本不同：有氧是「一个项目 + 时长（+ 可选距离）」，
//  无氧是「一个动作 + 组数 × 次数（+ 可选重量）」。
//  硬塞进一张表，一半的列对另一半的行永远为 NULL，
//  CHECK 约束也只能写成「互斥」的一团，谁看都容易写错。
//
//  【为什么还要存名字快照】
//  和 meal_items 同一个理由（docs/04 §2）：动作目录是我们维护的内容
//  文件，删掉一条动作不该让三年前的训练记录变成空白。
//  activity_name / exercise_name 是写入时的快照 —— 历史就该是历史。

export const cardioSessions = pgTable(
  'cardio_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 外键 → auth.users(id) ON DELETE CASCADE，在 0009 迁移里手写添加
    userId: uuid('user_id').notNull(),

    // 业务日：和 meal_items 一样，是按用户时区算出来的「日历上那一格」
    logDate: date('log_date', { mode: 'string' }).notNull(),

    activityId: text('activity_id').notNull(),
    activityName: text('activity_name').notNull(),

    minutes: integer('minutes').notNull(),
    // 强度用三档而不是心率区：手环不是人人都有，而「还能说话 / 说不上话」
    // 是任何人都能当场判断的标准。
    intensity: text('intensity').notNull().default('moderate'),
    // 距离只有跑步 / 骑行 / 划船这类才有意义，所以可空。
    distanceKm: numeric('distance_km', { precision: 6, scale: 2 }),

    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('cardio_sessions_minutes_check', sql`${t.minutes} > 0 and ${t.minutes} <= 600`),
    check('cardio_sessions_intensity_check', sql`${t.intensity} in ('easy','moderate','hard')`),
    check(
      'cardio_sessions_distance_check',
      sql`${t.distanceKm} is null or (${t.distanceKm} >= 0 and ${t.distanceKm} <= 500)`,
    ),
    index('cardio_sessions_user_date_idx').on(t.userId, t.logDate.desc()),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  10. strength_entries —— 无氧记录
// ═══════════════════════════════════════════════════════════════

export const strengthEntries = pgTable(
  'strength_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),

    logDate: date('log_date', { mode: 'string' }).notNull(),

    exerciseId: text('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    // 部位一起存下来：按部位统计训练量时不用回表查目录文件。
    part: text('part').notNull(),

    sets: integer('sets').notNull(),
    reps: integer('reps').notNull(),
    // 自重动作没有重量。null 和 0 在语义上不一样（0 是「填错了」）。
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),

    note: text('note'),
    sessionId: uuid('session_id'), // 迁移 0012：指向那次训练会话，用于从历史跳回顾
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('strength_entries_part_check', sql`${t.part} in ('胸','肩','背','腿')`),
    check('strength_entries_sets_check', sql`${t.sets} > 0 and ${t.sets} <= 50`),
    check('strength_entries_reps_check', sql`${t.reps} > 0 and ${t.reps} <= 200`),
    check(
      'strength_entries_weight_check',
      sql`${t.weightKg} is null or (${t.weightKg} >= 0 and ${t.weightKg} <= 1000)`,
    ),
    index('strength_entries_user_date_idx').on(t.userId, t.logDate.desc()),
    index('strength_entries_session_idx').on(t.sessionId),
  ],
);

// ═══════════════════════════════════════════════════════════════
//  导出推断类型
// ═══════════════════════════════════════════════════════════════
//  Drizzle 的核心卖点之一：类型从 schema 自动推导，不需要手写
//  interface，也就不可能出现「数据库改了但 TS 类型没改」的漂移。
// ── 好友关系（迁移 0010）───────────────────────────────────────────────
// 双向申请-接受模型。A→B 和 B→A 不能同时存在，靠迁移里的
// least/greatest 唯一索引保证（应用层「先查有没有反向申请」是竞态）。
export const friendships = pgTable(
  'friendships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requesterId: uuid('requester_id').notNull(),
    addresseeId: uuid('addressee_id').notNull(),
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
  },
  (t) => [
    check('friendships_status_check', sql`${t.status} in ('pending', 'accepted', 'declined')`),
    check('friendships_not_self', sql`${t.requesterId} <> ${t.addresseeId}`),
  ],
);

//
//  $inferSelect = 查询出来的行的类型
//  $inferInsert = 插入时允许传入的类型（有 DEFAULT 的列可省略）

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Food = typeof foods.$inferSelect;
export type NewFood = typeof foods.$inferInsert;

export type FoodServing = typeof foodServings.$inferSelect;
export type NewFoodServing = typeof foodServings.$inferInsert;

export type MealItem = typeof mealItems.$inferSelect;
export type NewMealItem = typeof mealItems.$inferInsert;

export type Measurement = typeof measurements.$inferSelect;
export type NewMeasurement = typeof measurements.$inferInsert;

export type DailySummary = typeof dailySummary.$inferSelect;
export type NewDailySummary = typeof dailySummary.$inferInsert;

export type FoodFavorite = typeof foodFavorites.$inferSelect;
export type InviteCode = typeof inviteCodes.$inferSelect;

export type CardioSession = typeof cardioSessions.$inferSelect;
export type NewCardioSession = typeof cardioSessions.$inferInsert;

export type StrengthEntry = typeof strengthEntries.$inferSelect;
export type NewStrengthEntry = typeof strengthEntries.$inferInsert;

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════
//  11. 训练会话（进行中的一次训练）
//
//  与 strength_entries 的区别：那边是「练完之后的事后记录」，
//  这里是「正在练」的过程 —— 计划中的组数、每一组真实的起止时刻。
//  取消训练时整条删掉，不在历史里留痕。
// ═══════════════════════════════════════════════════════════════════════

export const workoutSessions = pgTable(
  'workout_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    logDate: date('log_date', { mode: 'string' }).notNull(),
    part: text('part').notNull(),
    title: text('title'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workout_sessions_user_date_idx').on(t.userId, t.logDate.desc())],
);

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').notNull(),
    exerciseId: text('exercise_id').notNull(),
    exerciseName: text('exercise_name').notNull(),
    position: integer('position').notNull(),
    targetSets: integer('target_sets').notNull().default(3),
    targetReps: integer('target_reps').notNull().default(10),
    restSeconds: integer('rest_seconds').notNull().default(120),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workout_exercises_session_position_uniq').on(t.sessionId, t.position)],
);

export const workoutSets = pgTable(
  'workout_sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionExerciseId: uuid('session_exercise_id').notNull(),
    setIndex: integer('set_index').notNull(),
    weightKg: numeric('weight_kg', { precision: 6, scale: 2 }),
    reps: integer('reps'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('workout_sets_exercise_index_uniq').on(t.sessionExerciseId, t.setIndex)],
);

export type WorkoutSession = typeof workoutSessions.$inferSelect;
export type NewWorkoutSession = typeof workoutSessions.$inferInsert;
export type WorkoutExercise = typeof workoutExercises.$inferSelect;
export type NewWorkoutExercise = typeof workoutExercises.$inferInsert;
export type WorkoutSet = typeof workoutSets.$inferSelect;
export type NewWorkoutSet = typeof workoutSets.$inferInsert;
