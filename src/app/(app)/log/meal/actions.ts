'use server';

import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { withUser } from '@/db';
import { foodServings, foods, mealItems } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { scaleNutrition, toPer100g } from '@/lib/nutrition';

/* 记一餐的写入路径。
 *
 * 三条纪律，和读路径一致但更重要（写错了会污染数据）：
 *
 *   1. 每个 action 第一件事都是 requireUser()。不是「先查参数再查用户」——
 *      未登录时连参数都不该被解析，否则就成了一个免费的输入解析器。
 *
 *   2. 一律走 withUser()。注意这里**没有**任何 `where user_id = 我` 的
 *      防御性写法：新插入的行 userId 直接取登录用户，而 UPDATE/DELETE
 *      的 where 只有 id —— 越权会被 RLS 的 USING 子句拦成「影响 0 行」，
 *      而不是靠应用层记得加条件。这是数据库兜底的真正含义。
 *
 *   3. 营养换算只在 scaleNutrition() 一处发生（食物库统一按每 100 g 存，
 *      学自 wger）。这里绝不出现 `food.kcal * grams / 100` 这种算式。
 */

/* zod 的 UUID 校验。用正则而不是 z.uuid()：zod 3 和 4 的写法不同，
 * 正则不受版本影响，也不会在升级时静默失效。 */
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuid = z.string().regex(uuidRe, '不是合法的 id');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');
const mealType = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);

const addInput = z.object({
  foodId: uuid,
  mealType,
  logDate: dateStr,
  /* 三选一的份量来源，优先级 servingId > quantityG > 食物默认份量。
   * 都允许缺省，这样「点一下最近常吃」只需要传 foodId。 */
  servingId: uuid.optional(),
  quantityG: z.number().positive().max(5000).optional(),
});

/** 把一条 meal_items 行里的营养快照取成纯数字 —— numeric 列在驱动里回来是 string。 */
const snapshotOf = (row: {
  kcal: string;
  proteinG: string;
  fatG: string;
  carbG: string;
}): { kcal: number; proteinG: number; fatG: number; carbG: number } => ({
  kcal: Number(row.kcal),
  proteinG: Number(row.proteinG),
  fatG: Number(row.fatG),
  carbG: Number(row.carbG),
});

export type AddMealResult =
  | {
      ok: true;
      item: {
        id: string;
        mealType: string;
        foodName: string;
        quantityG: number;
        servingLabel: string | null;
        kcal: number;
        proteinG: number;
        fatG: number;
        carbG: number;
      };
    }
  | { ok: false; error: string };

export async function addMealItem(raw: unknown): Promise<AddMealResult> {
  const user = await requireUser();

  const parsed = addInput.safeParse(raw);
  if (!parsed.success) {
    /* 不把 zod 的完整报错回传给客户端：那是内部结构信息。
     * 但服务端日志里留全量，方便排查。 */
    console.error('[addMealItem] 参数校验失败', parsed.error.issues);
    return { ok: false, error: '参数不合法' };
  }
  const { foodId, mealType: mt, logDate, servingId, quantityG } = parsed.data;

  const result = await withUser(user.id, async (tx) => {
    /* 取食物。RLS 的 USING 已经保证「内置的 或 我自己的」，
     * 所以这里查不到就等于这个食物对我不可见 —— 不需要额外判断归属。 */
    const foodRows = await tx.select().from(foods).where(eq(foods.id, foodId)).limit(1);
    const food = foodRows[0];
    if (!food) return { ok: false as const, error: '找不到这个食物' };

    let grams = quantityG ?? null;
    let servingLabel: string | null = null;
    let finalServingId: string | null = null;

    if (servingId) {
      /* 同时限定 foodId，防止拿 A 食物的份量去记 B 食物 ——
       * 那会算出「一碗白米饭 = 200 g 鸡胸肉」这种荒谬结果。 */
      const s = (
        await tx
          .select()
          .from(foodServings)
          .where(and(eq(foodServings.id, servingId), eq(foodServings.foodId, foodId)))
          .limit(1)
      )[0];
      if (!s) return { ok: false as const, error: '这个份量不存在' };
      grams = Number(s.grams);
      servingLabel = s.label;
      finalServingId = s.id;
    }

    if (grams === null) {
      const s = (
        await tx
          .select()
          .from(foodServings)
          .where(and(eq(foodServings.foodId, foodId), eq(foodServings.isDefault, true)))
          .limit(1)
      )[0];
      if (!s) {
        return { ok: false as const, error: '这个食物还没有份量，请手动输入克数' };
      }
      grams = Number(s.grams);
      servingLabel = s.label;
      finalServingId = s.id;
    }

    const n = scaleNutrition(
      {
        kcal: Number(food.kcal),
        proteinG: Number(food.proteinG),
        fatG: Number(food.fatG),
        carbG: Number(food.carbG),
      },
      grams,
    );

    /* 原值（foodId + quantityG）和快照（kcal/蛋白/脂肪/碳水 + foodName）
     * 都写。理由见 docs/04 的「与 wger 的分歧」：食物日记在语义上是历史
     * 记录，用户第 30 天回看时看到的不应该被后来的食物库修正改变。
     * 原值留着是为了「常吃推荐」和「按当前食物库重算历史」这两个功能。 */
    const inserted = (
      await tx
        .insert(mealItems)
        .values({
          userId: user.id,
          logDate,
          mealType: mt,
          foodId: food.id,
          foodName: food.name,
          quantityG: String(grams),
          servingId: finalServingId,
          servingLabel,
          kcal: String(n.kcal),
          proteinG: String(n.proteinG),
          fatG: String(n.fatG),
          carbG: String(n.carbG),
        })
        .returning()
    )[0];

    if (!inserted) return { ok: false as const, error: '写入失败' };

    return {
      ok: true as const,
      item: {
        id: inserted.id,
        mealType: inserted.mealType,
        foodName: inserted.foodName,
        quantityG: grams,
        servingLabel: inserted.servingLabel,
        kcal: n.kcal,
        proteinG: n.proteinG,
        fatG: n.fatG,
        carbG: n.carbG,
      },
    };
  });

  /* revalidatePath 必须在事务提交之后调用。
   * 写在事务里的话，事务还没提交就可能触发一次重新渲染，
   * 那次渲染读不到刚写的行，页面会闪一下旧数据。 */
  if (result.ok) {
    revalidatePath('/dashboard');
    revalidatePath('/log/meal');
  }
  return result;
}

const deleteInput = z.object({ id: uuid });

export async function deleteMealItem(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const parsed = deleteInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: '参数不合法' };

  const deleted = await withUser(user.id, async (tx) =>
    tx.delete(mealItems).where(eq(mealItems.id, parsed.data.id)).returning({ id: mealItems.id }),
  );

  /* deleted.length === 0 有两种可能：这条不存在，或者它属于别人。
   * 我们**故意不区分** —— 区分开就等于提供了一个「探测别人数据是否存在」
   * 的接口。对外统一是「没删到」。 */
  if (deleted.length === 0) return { ok: false, error: '没找到这条记录' };

  revalidatePath('/dashboard');
  revalidatePath('/log/meal');
  return { ok: true };
}

const updateInput = z.object({ id: uuid, quantityG: z.number().positive().max(5000) });

/** 改份量。改完要**重算快照**，否则「记了 150 g 改成 300 g」热量却不变。 */
export async function updateMealQuantity(raw: unknown): Promise<{ ok: boolean; error?: string }> {
  const user = await requireUser();
  const parsed = updateInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: '参数不合法' };
  const { id, quantityG } = parsed.data;

  const done = await withUser(user.id, async (tx) => {
    const row = (
      await tx.select().from(mealItems).where(eq(mealItems.id, id)).limit(1)
    )[0];
    if (!row) return false;

    /* 重算必须回到「每 100 g 密度」，不能拿快照直接乘新份量 ——
     * 快照是某一份量下的结果，不是密度，直接乘等于缩放两次，
     * 每改一次就偏一点。 */
    let per100: { kcal: number; proteinG: number; fatG: number; carbG: number };
    if (row.foodId) {
      const f = (await tx.select().from(foods).where(eq(foods.id, row.foodId)).limit(1))[0];
      if (f) {
        per100 = {
          kcal: Number(f.kcal),
          proteinG: Number(f.proteinG),
          fatG: Number(f.fatG),
          carbG: Number(f.carbG),
        };
      } else {
        /* 食物已被删除（food_id 是 ON DELETE SET NULL）。退回用快照反推密度。 */
        per100 = toPer100g(snapshotOf(row), Number(row.quantityG));
      }
    } else {
      per100 = toPer100g(snapshotOf(row), Number(row.quantityG));
    }

    const n = scaleNutrition(per100, quantityG);
    await tx
      .update(mealItems)
      .set({
        quantityG: String(quantityG),
        kcal: String(n.kcal),
        proteinG: String(n.proteinG),
        fatG: String(n.fatG),
        carbG: String(n.carbG),
        updatedAt: new Date(),
      })
      .where(eq(mealItems.id, id));
    return true;
  });

  if (!done) return { ok: false, error: '没找到这条记录' };
  revalidatePath('/dashboard');
  revalidatePath('/log/meal');
  return { ok: true };
}
