import 'server-only';

import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

import { withUser } from '@/db';
import {
  cardioSessions,
  dailySummary,
  foodServings,
  foods,
  mealItems,
  measurements,
  profiles,
  strengthEntries,
  waterLogs,
  workoutExercises,
  workoutSessions,
  workoutSets,
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

/* ─────────────────────────────────────────────────────────────────────────
 *  训练记录（有氧 / 无氧）
 *
 *  有氧和无氧是两条独立的查询，不做 UNION —— 它们的列不一样，
 *  硬拼成一张表反而要靠 type 字段在应用层分叉，读起来更绕。
 * ───────────────────────────────────────────────────────────────────────── */

export type CardioRow = {
  id: string;
  activityName: string;
  minutes: number;
  intensity: 'easy' | 'moderate' | 'hard';
  distanceKm: number | null;
  note: string | null;
};

export type StrengthRow = {
  id: string;
  exerciseName: string;
  part: string;
  sets: number;
  reps: number;
  weightKg: number | null;
  note: string | null;
};

/** 某一天的有氧记录 */
export async function getCardioForDate(userId: string, date: string): Promise<CardioRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: cardioSessions.id,
        activityName: cardioSessions.activityName,
        minutes: cardioSessions.minutes,
        intensity: cardioSessions.intensity,
        distanceKm: cardioSessions.distanceKm,
        note: cardioSessions.note,
      })
      .from(cardioSessions)
      .where(and(eq(cardioSessions.userId, userId), eq(cardioSessions.logDate, date)))
      .orderBy(asc(cardioSessions.createdAt));

    return rows.map((r) => ({
      id: r.id,
      activityName: r.activityName,
      minutes: r.minutes,
      intensity: r.intensity as CardioRow['intensity'],
      distanceKm: numOrNull(r.distanceKm),
      note: r.note,
    }));
  });
}

/** 某一天的无氧记录 */
export async function getStrengthForDate(
  userId: string,
  date: string,
): Promise<StrengthRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        id: strengthEntries.id,
        exerciseName: strengthEntries.exerciseName,
        part: strengthEntries.part,
        sets: strengthEntries.sets,
        reps: strengthEntries.reps,
        weightKg: strengthEntries.weightKg,
        note: strengthEntries.note,
      })
      .from(strengthEntries)
      .where(and(eq(strengthEntries.userId, userId), eq(strengthEntries.logDate, date)))
      .orderBy(asc(strengthEntries.createdAt));

    return rows.map((r) => ({
      id: r.id,
      exerciseName: r.exerciseName,
      part: r.part,
      sets: r.sets,
      reps: r.reps,
      weightKg: numOrNull(r.weightKg),
      note: r.note,
    }));
  });
}

/** 最近 n 天的有氧与无氧记录（一次取回，在页面里聚合成「最近练了几天」）。 */
export async function getFitnessSince(
  userId: string,
  from: string,
): Promise<{ cardio: { date: string; minutes: number }[]; strength: { date: string; sets: number }[] }> {
  return withUser(userId, async (tx) => {
    const [cardio, strength] = await Promise.all([
      tx
        .select({ date: cardioSessions.logDate, minutes: cardioSessions.minutes })
        .from(cardioSessions)
        .where(and(eq(cardioSessions.userId, userId), gte(cardioSessions.logDate, from))),
      tx
        .select({ date: strengthEntries.logDate, sets: strengthEntries.sets })
        .from(strengthEntries)
        .where(and(eq(strengthEntries.userId, userId), gte(strengthEntries.logDate, from))),
    ]);
    return { cardio, strength };
  });
}

/* ── 好友（迁移 0010）────────────────────────────────────────────────
 *
 * 这一层有个容易写错的地方：所有访客视角的查询都要用【我】的身份去跑，
 * 只是把 where 换成对方 —— 不能拿对方的 id 去 withUser()。
 * 用对方的身份跑查询，等于把对方的权限借给自己用，RLS 就形同虚设了。
 * 正确姿势：withUser(me) + where user_id = peer，能不能看到由数据库决定。
 */

export type FriendLink = {
  /** friendships 那一行的 id —— 接受/删除/撤回都要用它 */
  linkId: string;
  peerId: string;
  username: string | null;
  displayName: string;
  status: 'pending' | 'accepted' | 'declined';
  since: string;
  direction: 'in' | 'out';
};

export async function getMyLinks(viewerId: string): Promise<FriendLink[]> {
  return withUser(viewerId, async (tx) => {
    const res = await tx.execute(sql`select * from public.list_my_links()`);
    return (Array.from(res) as unknown as Record<string, unknown>[]).map((r) => ({
      linkId: String(r.link_id),
      peerId: String(r.peer_id),
      username: (r.username as string | null) ?? null,
      displayName: (r.display_name as string | null) ?? '',
      status: r.status as FriendLink['status'],
      since: new Date(r.since as string).toISOString(),
      direction: r.direction as 'in' | 'out',
    }));
  });
}

export async function findUserByUsername(viewerId: string, username: string) {
  return withUser(viewerId, async (tx) => {
    const res = await tx.execute(
      sql`select * from public.find_user_by_username(${username})`,
    );
    const row = (Array.from(res) as unknown as Record<string, unknown>[])[0];
    if (!row) return null;
    return {
      peerId: String(row.peer_id),
      username: (row.username as string | null) ?? '',
      displayName: (row.display_name as string | null) ?? '',
    };
  });
}

/** 好友这一天吃了什么。能不能看到由 RLS 决定，看不到就是空数组。 */
export async function getFriendMeals(viewerId: string, peerId: string, date: string) {
  return withUser(viewerId, async (tx) => {
    const rows = await tx
      .select({
        id: mealItems.id,
        mealType: mealItems.mealType,
        foodName: mealItems.foodName,
        quantityG: mealItems.quantityG,
        servingLabel: mealItems.servingLabel,
        kcal: mealItems.kcal,
        proteinG: mealItems.proteinG,
        fatG: mealItems.fatG,
        carbG: mealItems.carbG,
      })
      .from(mealItems)
      .where(and(eq(mealItems.userId, peerId), eq(mealItems.logDate, date)))
      .orderBy(asc(mealItems.loggedAt));

    return rows.map((r) => ({
      id: r.id,
      mealType: r.mealType as MealType,
      foodName: r.foodName,
      quantityG: num(r.quantityG),
      servingLabel: r.servingLabel,
      kcal: num(r.kcal),
      proteinG: num(r.proteinG),
      fatG: num(r.fatG),
      carbG: num(r.carbG),
    }));
  });
}

/** 好友最近几天的训练。同样靠 RLS 兜底。 */
export async function getFriendFitness(viewerId: string, peerId: string, from: string) {
  return withUser(viewerId, async (tx) => {
    const [cardio, strength] = await Promise.all([
      tx
        .select({
          date: cardioSessions.logDate,
          activityName: cardioSessions.activityName,
          minutes: cardioSessions.minutes,
          intensity: cardioSessions.intensity,
        })
        .from(cardioSessions)
        .where(and(eq(cardioSessions.userId, peerId), gte(cardioSessions.logDate, from)))
        .orderBy(desc(cardioSessions.logDate)),
      tx
        .select({
          date: strengthEntries.logDate,
          exerciseName: strengthEntries.exerciseName,
          part: strengthEntries.part,
          sets: strengthEntries.sets,
          reps: strengthEntries.reps,
          weightKg: strengthEntries.weightKg,
        })
        .from(strengthEntries)
        .where(and(eq(strengthEntries.userId, peerId), gte(strengthEntries.logDate, from)))
        .orderBy(desc(strengthEntries.logDate)),
    ]);
    return {
      cardio: cardio.map((c) => ({ ...c, minutes: c.minutes })),
      strength: strength.map((s) => ({
        ...s,
        weightKg: s.weightKg === null ? null : num(s.weightKg),
      })),
    };
  });
}

/* ── 训练：单日明细 + 全量导出（回顾 / CSV / 好友共用）──────────────
 *
 * 之前训练只有「今天」这一种读法（fitness 页自己查的）。回顾页要按天
 * 铺开、导出要把历史全拿出来、好友页要看对方最近两周 —— 三种读法各写
 * 一版 SQL 是这一层最容易长歪的地方，所以这里统一成「按天」和「全量」
 * 两个口径，剩下的聚合放在页面里做。
 */

export type CardioEntry = {
  id: string;
  date: string;
  activityName: string;
  minutes: number;
  intensity: string;
  distanceKm: number | null;
  note: string | null;
};

export type StrengthEntryRow = {
  id: string;
  date: string;
  exerciseName: string;
  part: string;
  sets: number;
  reps: number;
  weightKg: number | null;
  note: string | null;
};

const cardioCols = {
  id: cardioSessions.id,
  date: cardioSessions.logDate,
  activityName: cardioSessions.activityName,
  minutes: cardioSessions.minutes,
  intensity: cardioSessions.intensity,
  distanceKm: cardioSessions.distanceKm,
  note: cardioSessions.note,
};

const strengthCols = {
  id: strengthEntries.id,
  date: strengthEntries.logDate,
  exerciseName: strengthEntries.exerciseName,
  part: strengthEntries.part,
  sets: strengthEntries.sets,
  reps: strengthEntries.reps,
  weightKg: strengthEntries.weightKg,
  note: strengthEntries.note,
};

const toCardio = (r: { distanceKm: string | null } & Omit<CardioEntry, 'distanceKm'>): CardioEntry => ({
  ...r,
  distanceKm: numOrNull(r.distanceKm),
});

const toStrength = (r: { weightKg: string | null } & Omit<StrengthEntryRow, 'weightKg'>): StrengthEntryRow => ({
  ...r,
  weightKg: numOrNull(r.weightKg),
});

/** 某一天的有氧 + 力量明细（回顾页的日详情用）。 */
export async function getFitnessForDate(userId: string, date: string) {
  return withUser(userId, async (tx) => {
    const [cardio, strength] = await Promise.all([
      tx.select(cardioCols).from(cardioSessions)
        .where(and(eq(cardioSessions.userId, userId), eq(cardioSessions.logDate, date)))
        .orderBy(asc(cardioSessions.createdAt)),
      tx.select(strengthCols).from(strengthEntries)
        .where(and(eq(strengthEntries.userId, userId), eq(strengthEntries.logDate, date)))
        .orderBy(asc(strengthEntries.createdAt)),
    ]);
    return { cardio: cardio.map(toCardio), strength: strength.map(toStrength) };
  });
}

/* 全量导出：和 getAllMeals 一样不加 LIMIT —— 导出少一行都是数据丢失。 */
export async function getAllCardio(userId: string): Promise<CardioEntry[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx.select(cardioCols).from(cardioSessions)
      .where(eq(cardioSessions.userId, userId))
      .orderBy(asc(cardioSessions.logDate), asc(cardioSessions.createdAt));
    return rows.map(toCardio);
  });
}

export async function getAllStrength(userId: string): Promise<StrengthEntryRow[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx.select(strengthCols).from(strengthEntries)
      .where(eq(strengthEntries.userId, userId))
      .orderBy(asc(strengthEntries.logDate), asc(strengthEntries.createdAt));
    return rows.map(toStrength);
  });
}

/** 好友最近 N 天的每日摄入热量（好友页的趋势图用）。
 *
 *  为什么不在 SQL 里 group by：这里只需要「每天一个数」，而 group by 之后
 *  numeric 会变成字符串、还要在页面里再转一次。拿原始行在 JS 里累加更好读，
 *  而且量级很小（一天几十行）。 */
export async function getFriendIntakeByDay(viewerId: string, peerId: string, from: string) {
  return withUser(viewerId, async (tx) => {
    const rows = await tx
      .select({ date: mealItems.logDate, kcal: mealItems.kcal })
      .from(mealItems)
      .where(and(eq(mealItems.userId, peerId), gte(mealItems.logDate, from)));

    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.date, (byDay.get(r.date) ?? 0) + num(r.kcal));
    return byDay;
  });
}

// ═══════════════════════════════════════════════════════════════════════
//  训练会话（进行中的一次训练）
// ═══════════════════════════════════════════════════════════════════════

export type SessionSet = {
  id: string;
  setIndex: number;
  weightKg: number | null;
  reps: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type SessionExercise = {
  id: string;
  exerciseId: string;
  exerciseName: string;
  position: number;
  targetSets: number;
  targetReps: number;
  restSeconds: number;
  sets: SessionSet[];
};

export type SessionDetail = {
  id: string;
  logDate: string;
  part: string;
  title: string | null;
  startedAt: string;
  finishedAt: string | null;
  exercises: SessionExercise[];
};

export async function getActiveSession(
  userId: string,
  date: string,
): Promise<{ id: string; part: string; startedAt: Date } | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ id: workoutSessions.id, part: workoutSessions.part, startedAt: workoutSessions.startedAt })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.logDate, date),
          isNull(workoutSessions.finishedAt),
        ),
      )
      .orderBy(desc(workoutSessions.startedAt))
      .limit(1);
    return row ?? null;
  });
}

export async function getSessionDetail(
  userId: string,
  sessionId: string,
): Promise<SessionDetail | null> {
  return withUser(userId, async (tx) => {
    const [head] = await tx
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, userId)));
    if (!head) return null;

    const exRows = await tx
      .select()
      .from(workoutExercises)
      .where(eq(workoutExercises.sessionId, sessionId))
      .orderBy(asc(workoutExercises.position));

    const setRows = exRows.length
      ? await tx
          .select()
          .from(workoutSets)
          .where(
            inArray(
              workoutSets.sessionExerciseId,
              exRows.map((e) => e.id),
            ),
          )
          .orderBy(asc(workoutSets.setIndex))
      : [];

    return {
      id: head.id,
      logDate: head.logDate,
      part: head.part,
      title: head.title,
      startedAt: head.startedAt.toISOString(),
      finishedAt: head.finishedAt ? head.finishedAt.toISOString() : null,
      exercises: exRows.map((e) => ({
        id: e.id,
        exerciseId: e.exerciseId,
        exerciseName: e.exerciseName,
        position: e.position,
        targetSets: e.targetSets,
        targetReps: e.targetReps,
        restSeconds: e.restSeconds,
        sets: setRows
          .filter((r) => r.sessionExerciseId === e.id)
          .map((r) => ({
            id: r.id,
            setIndex: r.setIndex,
            weightKg: numOrNull(r.weightKg),
            reps: r.reps,
            startedAt: r.startedAt ? r.startedAt.toISOString() : null,
            finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
          })),
      })),
    };
  });
}

/* 某一天有哪些训练会话（用于从「回顾 → 某天」跳进当时的训练回顾）。
 * 只取已结束的：进行中的会话属于「正在做」，不该出现在历史里。 */
export async function getSessionsForDate(
  userId: string,
  date: string,
): Promise<{ id: string; part: string }[]> {
  return withUser(userId, async (tx) =>
    tx
      .select({ id: workoutSessions.id, part: workoutSessions.part })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(workoutSessions.logDate, date),
          isNotNull(workoutSessions.finishedAt),
        ),
      )
      .orderBy(desc(workoutSessions.startedAt)),
  );
}

/* ── 喝水 ───────────────────────────────────────────────────────── */

export type WaterEntry = {
  id: string;
  amountMl: number;
  loggedAt: Date;
};

export type WaterDay = {
  /** 当天所有记录，新的在前（撤销/删除要按这个顺序找最后一条） */
  entries: WaterEntry[];
  /** 当天合计，mL */
  totalMl: number;
};

/**
 * 某一天喝了多少水。
 *
 * 合计在 JS 里加而不是 SQL SUM()：一天的记录最多十几条，
 * 连同明细一起取回来一次循环比多一次 round-trip 划算，
 * 而且「合计」和「明细」必须同源 —— 分开查会出现进度条和
 * 列表对不上的瞬间。
 */
export async function getWaterForDate(userId: string, date: string): Promise<WaterDay> {
  const entries = await withUser(userId, async (tx) =>
    tx
      .select({ id: waterLogs.id, amountMl: waterLogs.amountMl, loggedAt: waterLogs.loggedAt })
      .from(waterLogs)
      .where(and(eq(waterLogs.userId, userId), eq(waterLogs.logDate, date)))
      .orderBy(desc(waterLogs.loggedAt)),
  );
  return { entries, totalMl: entries.reduce((sum, e) => sum + e.amountMl, 0) };
}

/**
 * 最近 N 天的每日喝水合计。给趋势/回顾用。
 * 没有记录的日子不会出现在结果里（不是 0）—— 调用方自己补 0，
 * 因为「没记录」和「喝了 0 mL」在语义上不一样。
 */
export async function getWaterSeries(
  userId: string,
  from: string,
  to: string,
): Promise<{ date: string; totalMl: number }[]> {
  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ date: waterLogs.logDate, amountMl: waterLogs.amountMl })
      .from(waterLogs)
      .where(and(eq(waterLogs.userId, userId), gte(waterLogs.logDate, from), lte(waterLogs.logDate, to)));
    const byDate = new Map<string, number>();
    for (const row of rows) byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.amountMl);
    return [...byDate.entries()]
      .map(([date, totalMl]) => ({ date, totalMl }))
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** 导出用：全部喝水记录，按日期升序。 */
export async function getAllWater(
  userId: string,
): Promise<{ date: string; amountMl: number; loggedAt: Date }[]> {
  return withUser(userId, async (tx) =>
    tx
      .select({ date: waterLogs.logDate, amountMl: waterLogs.amountMl, loggedAt: waterLogs.loggedAt })
      .from(waterLogs)
      .where(eq(waterLogs.userId, userId))
      .orderBy(asc(waterLogs.logDate), asc(waterLogs.loggedAt)),
  );
}
