'use server';

import { revalidatePath } from 'next/cache';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';

import { withUser } from '@/db';
import { profiles, waterLogs } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { todayInTimezone } from '@/lib/nutrition';
import { MAX_SINGLE_ML } from '@/lib/water';

/* 喝水记录。
 *
 * 三条纪律和记一餐一样：
 *   1. 先 requireUser()，未登录连参数都不解析；
 *   2. 一律走 withUser()，越权交给 RLS；
 *   3. 「今天」由服务端按用户时区算，不信客户端传来的日期。
 */

const amountInput = z.object({
  /* 单位是 mL。上限和数据库 CHECK 对齐 —— 这里拦一次，
   * 数据库再拦一次，因为将来还有别的入口可能直接写库。 */
  amountMl: z
    .number({ message: '请输入数字' })
    .int('请输入整数毫升')
    .min(1, '至少 1 mL')
    .max(MAX_SINGLE_ML, '一次最多 3000 mL'),
});

/** 记一次喝水（点一下快捷按钮就走这里）。 */
export async function addWater(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = amountInput.safeParse({ amountMl: Number(formData.get('amountMl')) });
  if (!parsed.success) return;

  const today = todayInTimezone(user.timezone);
  await withUser(user.id, async (tx) => {
    await tx.insert(waterLogs).values({
      userId: user.id,
      logDate: today,
      amountMl: parsed.data.amountMl,
    });
  });

  revalidatePath('/dashboard');
  revalidatePath('/day/[date]', 'page');
}

/**
 * 撤销最近一次喝水。
 *
 * 「点错了」比「喝完了想改」常见得多，所以给的是「撤销最后一次」
 * 而不是让用户去列表里找 —— 列表也保留了单独删除，处理更早的错误。
 */
export async function undoLastWater(): Promise<void> {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);

  await withUser(user.id, async (tx) => {
    const [last] = await tx
      .select({ id: waterLogs.id })
      .from(waterLogs)
      .where(and(eq(waterLogs.userId, user.id), eq(waterLogs.logDate, today)))
      .orderBy(desc(waterLogs.loggedAt))
      .limit(1);
    if (last) await tx.delete(waterLogs).where(eq(waterLogs.id, last.id));
  });

  revalidatePath('/dashboard');
  revalidatePath('/day/[date]', 'page');
}

/** 删掉指定的一条（列表里的删除按钮）。 */
export async function deleteWater(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(formData.get('id'));
  if (!id.success) return;

  await withUser(user.id, async (tx) => {
    await tx.delete(waterLogs).where(and(eq(waterLogs.id, id.data), eq(waterLogs.userId, user.id)));
  });

  revalidatePath('/dashboard');
  revalidatePath('/day/[date]', 'page');
}

const goalInput = z.object({
  goalMl: z.number().int().min(500, '最少 500 mL').max(6000, '最多 6000 mL'),
});

/** 改每日目标。存进 profiles，之后就不再随体重波动跳。 */
export async function setWaterGoal(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = goalInput.safeParse({ goalMl: Number(formData.get('goalMl')) });
  if (!parsed.success) return;

  await withUser(user.id, async (tx) => {
    await tx.update(profiles).set({ waterGoalMl: parsed.data.goalMl }).where(eq(profiles.id, user.id));
  });

  revalidatePath('/dashboard');
}
