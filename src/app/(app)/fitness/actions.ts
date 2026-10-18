'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

import { withUser } from '@/db';
import { cardioSessions, strengthEntries } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { findCardio, findExercise } from '@/content/exercises';

/* 训练记录的写入路径。
 *
 * 和记一餐（log/meal/actions.ts）同一套纪律：
 *   1. 第一件事 requireUser()；
 *   2. 一律 withUser()，越权由 RLS 的 USING 子句兜底；
 *   3. 校验只在这一层做一次，页面的 min/max 只是体验，不是防线。
 *
 * 【和记一餐不一样的一点】
 * 这几个 action 的输入全来自「服务端渲染好的固定选项」（项目 id、动作 id、
 * 强度三档），没有自由文本，所以校验失败几乎只可能是手改请求。既然没有
 * 值得回填给用户的状态，就不必像自建食物那样把错误文案逐条传回去 ——
 * 直接带着 ?error=1 回到表单页，比在 40 行表单上方塞一个红字更简单。
 *
 * 【为什么动作名从目录里查，而不是由表单传上来】
 * 表单传什么就存什么，等于让客户端决定历史记录的内容。名称的快照必须由
 * 服务端从自己的目录里取 —— 这样用户改不动，也不会因为换了目录版本
 * 把旧记录改成别的动作名。
 */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const cardioInput = z.object({
  activityId: z.string().min(1).max(80),
  logDate: dateStr,
  minutes: z.coerce.number().int().min(1).max(600),
  intensity: z.enum(['easy', 'moderate', 'hard']),
  /* 距离是可选的：留空时 FormData 里是空串，必须转成 null 而不是 0，
   * 否则「没填」和「骑了 0 公里」在库里长得一模一样。 */
  distanceKm: z
    .union([z.literal(''), z.coerce.number().min(0).max(500)])
    .transform((v) => (v === '' ? null : v)),
});

const strengthInput = z.object({
  exerciseId: z.string().min(1).max(80),
  logDate: dateStr,
  sets: z.coerce.number().int().min(1).max(50),
  reps: z.coerce.number().int().min(1).max(200),
  weightKg: z
    .union([z.literal(''), z.coerce.number().min(0).max(1000)])
    .transform((v) => (v === '' ? null : v)),
});

const idInput = z.string().regex(/^[0-9a-f-]{36}$/i, '不是合法的 id');

export async function logCardio(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = cardioInput.safeParse({
    activityId: formData.get('activityId'),
    logDate: formData.get('logDate'),
    minutes: formData.get('minutes'),
    intensity: formData.get('intensity'),
    distanceKm: formData.get('distanceKm') ?? '',
  });

  const activity = parsed.success ? findCardio(parsed.data.activityId) : undefined;
  const logDate = String(formData.get('logDate') ?? '');
  const back = `/fitness/cardio?date=${encodeURIComponent(logDate)}`;

  if (!parsed.success || !activity) {
    redirect(`${back}&error=1`);
  }

  await withUser(user.id, async (tx) => {
    await tx.insert(cardioSessions).values({
      userId: user.id,
      logDate: parsed.data.logDate,
      activityId: activity.id,
      // 名称快照由服务端从目录取，不信客户端
      activityName: activity.name,
      minutes: parsed.data.minutes,
      intensity: parsed.data.intensity,
      distanceKm:
        parsed.data.distanceKm === null ? null : parsed.data.distanceKm.toFixed(2),
    });
  });

  revalidatePath('/fitness');
  redirect('/fitness?saved=cardio');
}

export async function logStrength(formData: FormData): Promise<void> {
  const user = await requireUser();

  const parsed = strengthInput.safeParse({
    exerciseId: formData.get('exerciseId'),
    logDate: formData.get('logDate'),
    sets: formData.get('sets'),
    reps: formData.get('reps'),
    weightKg: formData.get('weightKg') ?? '',
  });

  const exercise = parsed.success ? findExercise(parsed.data.exerciseId) : undefined;
  const logDate = String(formData.get('logDate') ?? '');
  const part = String(formData.get('part') ?? '');
  const back = `/fitness/strength?part=${encodeURIComponent(part || '胸')}&date=${encodeURIComponent(logDate)}`;

  if (!parsed.success || !exercise) {
    redirect(`${back}&error=1`);
  }

  await withUser(user.id, async (tx) => {
    await tx.insert(strengthEntries).values({
      userId: user.id,
      logDate: parsed.data.logDate,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      part: exercise.part,
      sets: parsed.data.sets,
      reps: parsed.data.reps,
      weightKg:
        parsed.data.weightKg === null ? null : parsed.data.weightKg.toFixed(2),
    });
  });

  revalidatePath('/fitness');
  redirect('/fitness?saved=strength');
}

/** 删除一条有氧。越权时 RLS 会把影响行数压成 0，而不是报错。 */
export async function deleteCardio(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = idInput.safeParse(formData.get('id'));
  if (!id.success) redirect('/fitness');

  await withUser(user.id, async (tx) => {
    await tx
      .delete(cardioSessions)
      .where(and(eq(cardioSessions.id, id.data), eq(cardioSessions.userId, user.id)));
  });

  revalidatePath('/fitness');
  redirect('/fitness');
}

/** 删除一条无氧。 */
export async function deleteStrength(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = idInput.safeParse(formData.get('id'));
  if (!id.success) redirect('/fitness');

  await withUser(user.id, async (tx) => {
    await tx
      .delete(strengthEntries)
      .where(and(eq(strengthEntries.id, id.data), eq(strengthEntries.userId, user.id)));
  });

  revalidatePath('/fitness');
  redirect('/fitness');
}
