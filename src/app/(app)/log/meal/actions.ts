'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { withUser } from '@/db';
import type { PickerFood } from '@/db/queries';
import { foodServings, foods, mealItems } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { addDays, round1, scaleNutrition, toPer100g } from '@/lib/nutrition';

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

/* ═══════════════════════════════════════════════════════════════
 *  自建食物 —— 食物库里没有的东西也要能记
 * ═══════════════════════════════════════════════════════════════
 *
 * 为什么必须有这条路：内置食物库是「常见食物」，但食堂窗口和外卖的花样
 * 远不止于此。库里没有的食物如果记不了，用户当天就会断记录 —— 而
 * 「记录太麻烦导致坚持率下降」正是这个产品调研里最主要的失败原因。
 * 194 条永远不够，所以缺口要让用户自己补，而且要在记录现场补。
 *
 * 为什么按「这一份」而不是「每 100 克」让用户填 —— 这是这个 action 里
 * 唯一真正需要想清楚的地方：
 *   新手知道自己「吃了一整份」，不知道这份每 100 克多少大卡。要求填
 *   每 100 g 等于要求他先做一次除法，而现场每多一个空格，记录率就掉
 *   一点。所以入口收「这一份多重、多少大卡」，折算成每 100 g 是我们
 *   的事 —— 而且用的就是别处同一个 toPer100g()，不另起一套换算。
 *
 * 数据库那一侧：的 foods 表本就为这件事设计好了（owner_id 非空 = 只有
 * 本人可见，slug 留空），RLS 的 foods_insert_own 策略也早就写好了
 * WITH CHECK (owner_id = auth.uid())。缺的只是这个入口和这段代码。
 */

const customFoodInput = z.object({
  /* 名字是必填的 —— 一条没有名字的食物会变成搜索结果里的空白行，
   * 用户点下去才发现选了个不知道是什么的东西。数据库里也有同样的
   * CHECK（foods_name_not_blank），两层都挡一次。 */
  name: z.string().trim().min(1, '给这个食物起个名字').max(30, '名字太长了，30 字以内'),

  /* 一「份」的描述：多少克、叫什么。
   * 默认 100 g / 「1 份」—— 用户什么都不改也能直接记下来。 */
  servingGrams: z.number().positive('份量要大于 0').max(2000, '一份不会超过 2 公斤吧？').default(100),
  servingLabel: z.string().trim().min(1).max(8).default('1 份'),

  /* 这一份的热量。上限 3000 只是拦明显的手滑（比如把「克」填进了「大卡」）。 */
  servingKcal: z.number('热量要填数字').min(0, '热量不能是负数').max(3000, '这一份的热量看起来不太对'),

  /* 三大营养素是可选的，按「这一份」填。
   * 不填就记 0 —— 这会让当天的营养比例偏低，但总比逼着新手去查成分表、
   * 查不到就干脆不记要好。填了的用户会得到更准的图表。 */
  proteinG: z.number().min(0).max(500).optional(),
  fatG: z.number().min(0).max(500).optional(),
  carbG: z.number().min(0).max(500).optional(),
});

export type CreateCustomFoodResult = { ok: true; food: PickerFood } | { ok: false; error: string };

/** 用户自建食物的分类。故意用一个内置库里没有的名字：
 *  前端「按分类浏览」会把未知分类排在最后（见 meal-logger 的 categories），
 *  这样「我的」永远在末尾，不会打乱内置食物的浏览顺序。 */
const CUSTOM_CATEGORY = '我的';

export async function createCustomFood(raw: unknown): Promise<CreateCustomFoodResult> {
  const user = await requireUser();

  const parsed = customFoodInput.safeParse(raw);
  if (!parsed.success) {
    /* 和别的 action 不同，这里**把 zod 的第一条错误文案回传给用户**。
     * 原因：其他 action 的参数来自我们自己的客户端，校验失败说明是代码 bug，
     * 泄漏内部结构没有收益；而这里的参数是用户在表单里一个字一个字敲的，
     * 「名字太长了」这种信息必须回到他眼前，否则表单只会静默不提交。 */
    return { ok: false, error: parsed.error.issues[0]?.message ?? '参数不合法' };
  }
  const d = parsed.data;

  /* 折算成「每 100 克」—— 和 addMealItem / updateMealQuantity 用的是
   * 同一个函数，保证全站只有一处换算式。 */
  const per100 = toPer100g(
    {
      kcal: d.servingKcal,
      proteinG: d.proteinG ?? 0,
      fatG: d.fatG ?? 0,
      carbG: d.carbG ?? 0,
    },
    d.servingGrams,
  );
  const kcal100 = round1(per100.kcal);
  const protein100 = round1(per100.proteinG);
  const fat100 = round1(per100.fatG);
  const carb100 = round1(per100.carbG);

  /* 物理上限检查，必须在写库之前做。
   * 数据库里也有 CHECK（kcal ≤ 900、各营养素 ≤ 100），但触发 CHECK 只会
   * 抛一个 Postgres 错误，用户看到的是「写入失败」。逐条比对一下，
   * 就能把「你填的数字违反了物理定律」说清楚。 */
  if (kcal100 > 900) {
    return {
      ok: false,
      error:
        `折下来是每 100 克 ${kcal100} 大卡，超过了物理上限（纯油脂也才 900）。` +
        '多半是把「这一份的重量」填小了 —— 比如一份 500 大卡的盖饭，重量应该是 400 克左右，不是 40 克。',
    };
  }
  if (protein100 > 100 || fat100 > 100 || carb100 > 100) {
    return {
      ok: false,
      error: '折下来每 100 克里有超过 100 克的营养素 —— 检查一下份量（克）和营养素的单位是不是填反了。',
    };
  }

  const created = await withUser(user.id, async (tx) => {
    const food = (
      await tx
        .insert(foods)
        .values({
          /* ownerId = 自己。这一行就是「自建食物」的标记，
           * RLS 的 foods_select_visible 靠它决定谁能看见。 */
          ownerId: user.id,
          name: d.name,
          category: CUSTOM_CATEGORY,
          kcal: String(kcal100),
          proteinG: String(protein100),
          fatG: String(fat100),
          carbG: String(carb100),
          source: 'user',
          isVerified: false,
        })
        .returning()
    )[0];

    if (!food) return null;

    /* 同时建一个默认份量。没有份量的食物在选择器里仍然能出现
     * （查询用了 LEFT JOIN，见 getFoodsForPicker），但「点一下就记好」
     * 会退化成「请手动输入克数」—— 那就破坏了这一屏的立身之本。 */
    const serving = (
      await tx
        .insert(foodServings)
        .values({
          foodId: food.id,
          label: d.servingLabel,
          grams: String(d.servingGrams),
          isDefault: true,
          sortOrder: 0,
        })
        .returning()
    )[0];

    return { food, serving };
  });

  if (!created) return { ok: false, error: '没创建成功，再试一次' };

  revalidatePath('/dashboard');
  revalidatePath('/log/meal');

  /* 返回的形状和 getFoodsForPicker 完全一致（PickerFood），
   * 这样客户端可以直接把它塞进目录、直接记一条，不用为它写特例。 */
  return {
    ok: true,
    food: {
      id: created.food.id,
      name: created.food.name,
      aliases: created.food.aliases ?? [],
      category: created.food.category,
      kcalPer100: kcal100,
      proteinPer100: protein100,
      fatPer100: fat100,
      carbPer100: carb100,
      serving: created.serving
        ? {
            id: created.serving.id,
            label: created.serving.label,
            grams: Number(created.serving.grams),
          }
        : null,
    },
  };
}

/* 复制昨天同一餐。
 *
 * 只在那一餐还空着时出现 —— 有记录就不显示，避免手滑把昨天的午饭
 * 「追加」到今天的午饭上，变成双份热量。
 */
export async function copyPreviousMeal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
      logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({ mealType: formData.get('mealType'), logDate: formData.get('logDate') });
  if (!parsed.success) redirect('/log/meal');

  const { mealType, logDate } = parsed.data;
  const yesterday = addDays(logDate, -1);

  await withUser(user.id, async (tx) => {
    const rows = await tx
      .select()
      .from(mealItems)
      .where(
        and(
          eq(mealItems.userId, user.id),
          eq(mealItems.logDate, yesterday),
          eq(mealItems.mealType, mealType),
        ),
      );
    if (rows.length === 0) return;
    await tx.insert(mealItems).values(
      rows.map((row) => ({
        userId: user.id,
        logDate,
        mealType: row.mealType,
        foodId: row.foodId,
        foodName: row.foodName,
        quantityG: row.quantityG,
        servingId: row.servingId,
        servingLabel: row.servingLabel,
        kcal: row.kcal,
        proteinG: row.proteinG,
        fatG: row.fatG,
        carbG: row.carbG,
        note: row.note,
      })),
    );
  });

  revalidatePath('/log/meal');
  revalidatePath('/dashboard');
  redirect(`/log/meal?date=${logDate}`);
}
