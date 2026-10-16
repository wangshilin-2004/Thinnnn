'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { withUser } from '@/db';
import { measurements } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { todayInTimezone } from '@/lib/nutrition';

/* 记录体重。
 *
 * 为什么需要这个 action：在这之前，体重只在引导流程里被写入过一次
 * （见 onboarding/actions.ts 的那条 insert）。用户设完目标之后再也改不了体重，
 * 趋势图会永远停在第一天那一个点上 —— 而这是个「体重 + 饮食」的应用，
 * 只能看不能记等于废掉一半。
 *
 * 三条纪律与记一餐的 action 完全一致：
 *   1. 第一件事是 requireUser()，未登录时连参数都不解析
 *   2. 一律走 withUser()，越权交给 RLS 兜底而不是应用层记得加条件
 *   3. 「今天」由**服务端**按用户时区算，不接受客户端传来的日期
 */

const input = z.object({
  /* 上下限不是形式主义：20 kg 以下或 300 kg 以上几乎必然是打错字
   * （比如把 65.5 输成 655，或者单位填成了磅）。这类脏数据一旦进库，
   * 会把趋势图的纵轴整个拉平，看起来像「数据坏了」，而排查成本很高。
   * 宁可在这里拦住。 */
  kg: z
    .number({ message: '请输入数字' })
    .min(20, '体重看起来不对，请检查是不是打错了')
    .max(300, '体重看起来不对，请检查是不是打错了'),
});

export type LogWeightResult = { ok: true; kg: number } | { ok: false; error: string };

export async function logWeight(raw: unknown): Promise<LogWeightResult> {
  const user = await requireUser();

  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    /* 取第一条 zod 的报错文案。写这条是因为默认的英文报错会直接弹给用户看，
     * 而「Number must be greater than or equal to 20」对减脂新手毫无意义。 */
    return { ok: false, error: parsed.error.issues[0]?.message ?? '参数不合法' };
  }

  /* 保留一位小数。体重秤的分度值一般是 0.1 kg，多存的位数没有信息量，
   * 还会让「同一天重复记录」产生看起来不同、实际相同的数据。
   * 数值列是 numeric(7,3)，存得下，但没必要。 */
  const kg = Math.round(parsed.data.kg * 10) / 10;
  const today = todayInTimezone(user.timezone);

  await withUser(user.id, async (tx) =>
    tx
      .insert(measurements)
      .values({
        userId: user.id,
        metric: 'weight',
        measuredOn: today,
        /* numeric 列在 postgres.js 里要以字符串传入：直接给 number 会丢精度，
         * 驱动会把它转成 JS double 再转回去。这是这个栈里最容易静默出错的地方。 */
        value: String(kg),
        unit: 'kg',
        source: 'manual',
        /* measuredAt 记录精确时刻。同样 70 kg，早上空腹和晚上睡前能差 1 kg，
         * 所以「什么时候称的」本身就是数据的一部分。 */
        measuredAt: new Date(),
      })
      /* 对应 UNIQUE(user_id, metric, measured_on)：一天只留一条体重。
       * 用户称完发现记错了、或者晚上又称了一次，都应该是覆盖而不是新增 ——
       * 同一天两个点会让 7 日均线画出锯齿。 */
      .onConflictDoUpdate({
        target: [measurements.userId, measurements.metric, measurements.measuredOn],
        /* 注意这里没有 updatedAt：measurements 表只有 created_at。
         * 我在这张表上已经踩过一次 `column "updated_at" does not exist` (42703)，
         * 判断一张表有没有 updated_at 要看 schema，不能靠「一般都有」。 */
        set: { value: String(kg), measuredAt: new Date() },
      }),
  );

  /* daily_summary 的 weight_kg 由触发器 measurements_sync_weight 自动同步
   * （AFTER INSERT OR UPDATE OR DELETE），这里不需要手动写。
   *
   * revalidatePath 放在事务提交之后：放里面的话事务一旦回滚，
   * 缓存已经清了，页面会读到旧值 —— 那种「刚存的怎么不见了」最难查。 */
  revalidatePath('/dashboard');
  revalidatePath('/trends');

  return { ok: true, kg };
}
