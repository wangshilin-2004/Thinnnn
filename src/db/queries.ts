import 'server-only';

import { and, asc, desc, eq, gte, lte } from 'drizzle-orm';

import { withUser } from '@/db';
import {
  dailySummary,
  foodServings,
  foods,
  mealItems,
  measurements,
  profiles,
} from '@/db/schema';

/* 业务查询层。
 *
 * 两条纪律：
 *   1. 全部走 withUser()，不直接用 db —— 让数据库的 RLS 兜底，
 *      应用层写错 where 也不会读到别人的数据。
 *   2. 不在这一层做数值计算。趋势、移动平均、达标判断都放在
 *      src/lib/nutrition.ts 的纯函数里 —— 纯函数能写单元测试，
 *      写进 SQL 就只能靠肉眼看图表。
 */

export type DayRow = {
  date: string; // YYYY-MM-DD
  intakeKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  itemCount: number;
  weightKg: number | null;
  targetKcal: number | null;
};

/* 注意 numeric 列在 pg 驱动里回来的是 string（见 tests/verify-migrations.mjs
 * 的【G】节实测）。这不是 bug：numeric 是任意精度十进制，JS 的 number 是
 * 双精度浮点，直接映射会丢精度。所以这里显式转一次，转换点只有一处。 */
const num = (v: string | null): number => (v === null ? 0 : Number(v));
const numOrNull = (v: string | null): number | null => (v === null ? null : Number(v));

export async function getProfile(userId: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx.select().from(profiles).where(eq(profiles.id, userId)).limit(1);
    return rows[0] ?? null;
  });
}

/** 取区间内的日汇总，升序（图表要时间从左到右）。 */
export async function getDailySummaries(
  userId: string,
  from: string,
  to: string,
): Promise<DayRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select()
      .from(dailySummary)
      .where(
        and(
          eq(dailySummary.userId, userId),
          gte(dailySummary.logDate, from),
          lte(dailySummary.logDate, to),
        ),
      )
      .orderBy(asc(dailySummary.logDate));

    return rows.map((r) => ({
      date: r.logDate,
      intakeKcal: num(r.intakeKcal),
      proteinG: num(r.proteinG),
      fatG: num(r.fatG),
      carbG: num(r.carbG),
      itemCount: r.itemCount,
      weightKg: numOrNull(r.weightKg),
      // 这一列【故意】不套 numOrNull：daily_summary.target_kcal 在 schema 里是
      // integer，不是 numeric。postgres.js 会把它解析成真正的 JS number，
      // 而 numeric 列才会以 string 返回（避免精度丢失）。
      // 我一度以为这里漏了转换、给它套上 numOrNull，结果 tsc 立刻报
      //   Argument of type 'number | null' is not assignable to 'string | null'
      // ——类型系统挡住了这个"自作聪明"的改动。
      // 判断某列要不要转换，看 schema 里是 integer 还是 numeric，不要看列名。
      targetKcal: r.targetKcal,
    }));
  });
}

/** 体重序列。走 measurements 而不是 daily_summary：
 *  daily_summary 只有「当天有饮食记录」的日子才会有行，
 *  而体重可能天天记、饮食偶尔记，用汇总表会漏掉一半体重点。 */
export async function getWeightSeries(
  userId: string,
  from: string,
  to: string,
): Promise<{ date: string; kg: number }[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ date: measurements.measuredOn, value: measurements.value })
      .from(measurements)
      .where(
        and(
          eq(measurements.userId, userId),
          eq(measurements.metric, 'weight'),
          gte(measurements.measuredOn, from),
          lte(measurements.measuredOn, to),
        ),
      )
      .orderBy(asc(measurements.measuredOn));

    return rows.map((r) => ({ date: r.date, kg: num(r.value) }));
  });
}

export const MEAL_LABELS = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
} as const;

export type MealType = keyof typeof MEAL_LABELS;

export async function getMealsForDate(userId: string, date: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: mealItems.id,
        mealType: mealItems.mealType,
        foodName: mealItems.foodName,
        quantityG: mealItems.quantityG,
        servingLabel: mealItems.servingLabel,
        /* 这里是「原始一份」多少克，**不是**当前这条的份量。
         * 界面上的份数 = quantityG / servingGrams，见 src/lib/portion.ts。
         * 区分这两者很重要：servingLabel 里的数字是「一份叫什么」，
         * 用户改过克数之后它就不再等于当前份数了。 */
        servingGrams: foodServings.grams,
        kcal: mealItems.kcal,
        proteinG: mealItems.proteinG,
        fatG: mealItems.fatG,
        carbG: mealItems.carbG,
      })
      .from(mealItems)
      /* 必须 LEFT JOIN：serving_id 是 ON DELETE SET NULL，份量被删掉之后
       * 这一列变成 NULL，用 INNER JOIN 会把整条记录从饮食日志里抹掉 ——
       * 用户改一次食物库，历史就凭空少几行。 */
      .leftJoin(foodServings, eq(mealItems.servingId, foodServings.id))
      .where(and(eq(mealItems.userId, userId), eq(mealItems.logDate, date)))
      .orderBy(asc(mealItems.loggedAt));

    return rows.map((r) => ({
      id: r.id,
      mealType: r.mealType as MealType,
      foodName: r.foodName,
      quantityG: num(r.quantityG),
      servingLabel: r.servingLabel,
      servingGrams: r.servingGrams === null ? null : num(r.servingGrams),
      kcal: num(r.kcal),
      proteinG: num(r.proteinG),
      fatG: num(r.fatG),
      carbG: num(r.carbG),
    }));
  });
}

/** 最近吃过的食物，按「最近一次吃」倒序去重。
 *  这是把每餐录入压到 30 秒的关键：点一下就能再记一次。 */
export async function getRecentFoods(userId: string, limit = 10) {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        foodId: mealItems.foodId,
        foodName: mealItems.foodName,
        quantityG: mealItems.quantityG,
        servingLabel: mealItems.servingLabel,
        kcal: mealItems.kcal,
        loggedAt: mealItems.loggedAt,
      })
      .from(mealItems)
      .where(eq(mealItems.userId, userId))
      .orderBy(desc(mealItems.loggedAt))
      .limit(120);

    const seen = new Set<string>();
    const out: typeof rows = [];
    for (const r of rows) {
      const key = r.foodName;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out.map((r) => ({
      foodId: r.foodId,
      foodName: r.foodName,
      quantityG: num(r.quantityG),
      servingLabel: r.servingLabel,
      kcal: num(r.kcal),
    }));
  });
}

/* ── 食物选择器用的数据 ────────────────────────────────────────────
 *
 * 为什么一次性把 194 条全捞出来给客户端，而不是做一个搜索接口：
 *
 *   1. 数据量小。194 条 × 约 100 字节 ≈ 20 KB，gzip 后更小，
 *      比一次往返的延迟还便宜。手机上打字时每次按键都发请求，
 *      在 4G 弱网下会有明显卡顿感。
 *   2. RLS 已经在数据库层过滤过了（内置食物 owner_id is null，
 *      自建食物 owner_id = 我），所以捞出来的就是「我可见的全部」，
 *      没有越权风险。
 *   3. 服务端搜就是给每个用户开一个搜索接口，要防注入、要限流、
 *      要处理并发 —— 在 1-3 个用户的规模下这是纯粹的复杂度税。
 *
 * 什么时候该换掉：食物库超过 2000 条，或者开始有「全库搜索」需求。
 * 那时改成 database 全文检索 + 防抖请求即可，客户端组件的接口不用动。
 */
export type PickerFood = {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  kcalPer100: number;
  proteinPer100: number;
  fatPer100: number;
  carbPer100: number;
  /** 默认份量。理论上每个内置食物都有（种子数据保证），但自建食物可能没有。 */
  serving: { id: string; label: string; grams: number } | null;
};

export async function getFoodsForPicker(userId: string): Promise<PickerFood[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: foods.id,
        name: foods.name,
        aliases: foods.aliases,
        category: foods.category,
        kcal: foods.kcal,
        proteinG: foods.proteinG,
        fatG: foods.fatG,
        carbG: foods.carbG,
        servingId: foodServings.id,
        servingLabel: foodServings.label,
        servingGrams: foodServings.grams,
      })
      .from(foods)
      /* left join 而不是 inner join：自建食物可能还没配份量，
       * 用 inner join 会让它在选择器里直接消失 —— 那种「明明记过却搜不到」
       * 的 bug 很难排查，因为数据看起来是好的。 */
      .leftJoin(
        foodServings,
        and(eq(foodServings.foodId, foods.id), eq(foodServings.isDefault, true)),
      )
      .orderBy(asc(foods.category), asc(foods.name));

    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      aliases: r.aliases ?? [],
      category: r.category,
      kcalPer100: num(r.kcal),
      proteinPer100: num(r.proteinG),
      fatPer100: num(r.fatG),
      carbPer100: num(r.carbG),
      serving:
        r.servingId && r.servingLabel && r.servingGrams
          ? { id: r.servingId, label: r.servingLabel, grams: num(r.servingGrams) }
          : null,
    }));
  });
}

/** 今天各餐已经吃了多少 —— 用于录入页顶部的进度提示。 */
export async function getMealTotalsToday(userId: string, date: string) {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        mealType: mealItems.mealType,
        kcal: mealItems.kcal,
      })
      .from(mealItems)
      .where(and(eq(mealItems.userId, userId), eq(mealItems.logDate, date)));

    const totals: Record<string, number> = {};
    for (const r of rows) {
      totals[r.mealType] = (totals[r.mealType] ?? 0) + num(r.kcal);
    }
    return totals;
  });
}

/* ═══════════════════════════════════════════════════════════════
 *  导出专用查询
 * ═══════════════════════════════════════════════════════════════
 *
 *  与上面那些查询的区别：**不分页、不按日期切片，一次全取**。
 *  导出是「拿走全部」，少一行都是数据丢失，所以宁可在数据量大的时候
 *  慢一点，也不加 LIMIT。
 *
 *  为什么不在导出里现算份数：导出的是**当时写进库里的快照**
 *  （kcal / protein_g 这些列在 meal_items 上是冗余存储的），
 *  这样即使用户后来改了食物库，导出的文件仍然和他当时看到的一致。
 */

export type MealExportRow = {
  date: string; // YYYY-MM-DD
  mealType: MealType;
  loggedAt: string; // ISO 8601，带时区
  foodName: string;
  servingLabel: string | null;
  quantityG: number;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  note: string | null;
};

/** 全部饮食记录，按日期、记录时刻升序。 */
export async function getAllMeals(userId: string): Promise<MealExportRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        date: mealItems.logDate,
        mealType: mealItems.mealType,
        loggedAt: mealItems.loggedAt,
        foodName: mealItems.foodName,
        servingLabel: mealItems.servingLabel,
        quantityG: mealItems.quantityG,
        kcal: mealItems.kcal,
        proteinG: mealItems.proteinG,
        fatG: mealItems.fatG,
        carbG: mealItems.carbG,
        note: mealItems.note,
      })
      .from(mealItems)
      .where(eq(mealItems.userId, userId))
      .orderBy(asc(mealItems.logDate), asc(mealItems.loggedAt));

    return rows.map((r) => ({
      date: r.date,
      mealType: r.mealType as MealType,
      loggedAt: r.loggedAt.toISOString(),
      foodName: r.foodName,
      servingLabel: r.servingLabel,
      quantityG: num(r.quantityG),
      kcal: num(r.kcal),
      proteinG: num(r.proteinG),
      fatG: num(r.fatG),
      carbG: num(r.carbG),
      note: r.note,
    }));
  });
}

export type WeightExportRow = {
  date: string; // YYYY-MM-DD
  weightKg: number;
  measuredAt: string | null; // ISO 8601；早期记录可能没填具体时刻
  note: string | null;
};

/** 全部体重记录，按日期升序。只取 metric='weight'，不掺其它指标。 */
export async function getAllWeights(userId: string): Promise<WeightExportRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        date: measurements.measuredOn,
        value: measurements.value,
        measuredAt: measurements.measuredAt,
        note: measurements.note,
      })
      .from(measurements)
      .where(
        and(eq(measurements.userId, userId), eq(measurements.metric, 'weight')),
      )
      .orderBy(asc(measurements.measuredOn));

    return rows.map((r) => ({
      date: r.date,
      weightKg: num(r.value),
      measuredAt: r.measuredAt === null ? null : r.measuredAt.toISOString(),
      note: r.note,
    }));
  });
}
