'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';

import { withUser } from '@/db';
import { cardioSessions, strengthEntries, workoutExercises, workoutSessions, workoutSets } from '@/db/schema';
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

/* ─────────────────────────────────────────────────────────────────────
 *  训练会话：开始 → 排动作 → 每组计时 → 结束
 *
 *  为什么结束时要写一份 strength_entries：
 *    「这周练了几次、多少组」这些统计、CSV 导出、好友页读的都是
 *    strength_entries。会话是过程，strength_entries 是结果 ——
 *    结束时把结果落一份，其它地方就不用知道「会话」这个概念。
 * ───────────────────────────────────────────────────────────────────── */

const PART_OPTION = z.enum(['胸', '肩', '背', '腿', '全身']);

export async function startSession(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = z
    .object({
      part: PART_OPTION,
      logDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse({ part: formData.get('part'), logDate: formData.get('logDate') });
  if (!parsed.success) redirect('/fitness?error=1');

  const id = await withUser(user.id, async (tx) => {
    const [row] = await tx
      .insert(workoutSessions)
      .values({ userId: user.id, logDate: parsed.data.logDate, part: parsed.data.part })
      .returning({ id: workoutSessions.id });
    return row.id;
  });
  revalidatePath('/fitness');
  redirect(`/fitness/session/${id}`);
}

const exerciseInput = z.object({
  sessionId: z.string().uuid(),
  exerciseId: z.string().trim().min(1).max(80),
  targetSets: z.coerce.number().int().min(1).max(20),
  targetReps: z.coerce.number().int().min(1).max(100),
  restSeconds: z.coerce.number().int().min(15).max(900),
});

export async function addSessionExercise(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = exerciseInput.safeParse({
    sessionId: formData.get('sessionId'),
    exerciseId: formData.get('exerciseId'),
    targetSets: formData.get('targetSets'),
    targetReps: formData.get('targetReps'),
    restSeconds: formData.get('restSeconds'),
  });
  if (!parsed.success) redirect('/fitness?error=1');

  const exercise = findExercise(parsed.data.exerciseId);
  if (!exercise) redirect('/fitness?error=1');

  await withUser(user.id, async (tx) => {
    const [head] = await tx
      .select({ id: workoutSessions.id })
      .from(workoutSessions)
      .where(eq(workoutSessions.id, parsed.data.sessionId));
    if (!head) return;

    const [{ next }] = await tx
      .select({ next: sql<number>`coalesce(max(${workoutExercises.position}) + 1, 0)` })
      .from(workoutExercises)
      .where(eq(workoutExercises.sessionId, parsed.data.sessionId));

    await tx.insert(workoutExercises).values({
      sessionId: parsed.data.sessionId,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      position: next,
      targetSets: parsed.data.targetSets,
      targetReps: parsed.data.targetReps,
      restSeconds: parsed.data.restSeconds,
    });
  });
  revalidatePath(`/fitness/session/${parsed.data.sessionId}`);
}

export async function removeSessionExercise(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId') ?? '');
  const exerciseRowId = String(formData.get('exerciseRowId') ?? '');
  if (!sessionId || !exerciseRowId) redirect('/fitness?error=1');

  await withUser(user.id, async (tx) => {
    await tx.delete(workoutExercises).where(eq(workoutExercises.id, exerciseRowId));
  });
  revalidatePath(`/fitness/session/${sessionId}`);
}

const setInput = z.object({
  sessionId: z.string().uuid(),
  exerciseRowId: z.string().uuid(),
  setIndex: z.coerce.number().int().min(1).max(20),
  weightKg: z
    .union([z.literal(''), z.coerce.number().min(0).max(500)])
    .transform((v) => (v === '' ? null : v)),
  reps: z.union([z.literal(''), z.coerce.number().int().min(1).max(200)]).transform((v) => (v === '' ? null : v)),
});

export async function finishSet(formData: FormData): Promise<void> {
  const user = await requireUser();
  const parsed = setInput.safeParse({
    sessionId: formData.get('sessionId'),
    exerciseRowId: formData.get('exerciseRowId'),
    setIndex: formData.get('setIndex'),
    weightKg: formData.get('weightKg'),
    reps: formData.get('reps'),
  });
  if (!parsed.success) redirect('/fitness?error=1');

  await withUser(user.id, async (tx) => {
    const now = new Date();
    const [existing] = await tx
      .select({ id: workoutSets.id })
      .from(workoutSets)
      .where(
        and(
          eq(workoutSets.sessionExerciseId, parsed.data.exerciseRowId),
          eq(workoutSets.setIndex, parsed.data.setIndex),
        ),
      );
    if (existing) {
      await tx
        .update(workoutSets)
        .set({ weightKg: parsed.data.weightKg?.toString() ?? null, reps: parsed.data.reps, finishedAt: now })
        .where(eq(workoutSets.id, existing.id));
    } else {
      await tx.insert(workoutSets).values({
        sessionExerciseId: parsed.data.exerciseRowId,
        setIndex: parsed.data.setIndex,
        weightKg: parsed.data.weightKg?.toString() ?? null,
        reps: parsed.data.reps,
        startedAt: now,
        finishedAt: now,
      });
    }
  });
  revalidatePath(`/fitness/session/${parsed.data.sessionId}`);
  // 带上 rest=<动作行 id> 回同页：页面据此挂上组间计时器。
  // 组间时长存在动作行上（每个人每个动作可以不一样），所以要把行 id 带回来。
  redirect(`/fitness/session/${parsed.data.sessionId}?rest=${parsed.data.exerciseRowId}`);
}

export async function finishSession(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) redirect('/fitness?error=1');

  await withUser(user.id, async (tx) => {
    const [head] = await tx
      .select()
      .from(workoutSessions)
      .where(and(eq(workoutSessions.id, sessionId), eq(workoutSessions.userId, user.id)));
    if (!head || head.finishedAt) return;

    const exRows = await tx.select().from(workoutExercises).where(eq(workoutExercises.sessionId, sessionId));
    const setRows = exRows.length
      ? await tx
          .select()
          .from(workoutSets)
          .where(inArray(workoutSets.sessionExerciseId, exRows.map((e) => e.id)))
      : [];

    // 只把「真的做了的组」写成结果；排了计划但没做的动作不留痕
    for (const ex of exRows) {
      const done = setRows.filter((s) => s.sessionExerciseId === ex.id && s.finishedAt);
      if (!done.length) continue;
      const heaviest = done.reduce<number | null>((max, s) => {
        const w = Number(s.weightKg ?? 0);
        return w > 0 && (max === null || w > max) ? w : max;
      }, null);
      const repSum = done.reduce((sum, s) => sum + (s.reps ?? ex.targetReps), 0);
      await tx.insert(strengthEntries).values({
        userId: user.id,
        logDate: head.logDate,
        exerciseId: ex.exerciseId,
        exerciseName: ex.exerciseName,
        part: head.part === '全身' ? '腿' : head.part,
        sets: done.length,
        reps: Math.max(1, Math.round(repSum / done.length)),
        weightKg: heaviest === null ? null : heaviest.toString(),
        sessionId,
      });
    }

    await tx.update(workoutSessions).set({ finishedAt: new Date() }).where(eq(workoutSessions.id, sessionId));
  });
  revalidatePath('/fitness');
  redirect('/fitness?saved=1');
}

export async function cancelSession(formData: FormData): Promise<void> {
  const user = await requireUser();
  const sessionId = String(formData.get('sessionId') ?? '');
  if (!sessionId) redirect('/fitness?error=1');
  await withUser(user.id, async (tx) => {
    await tx.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));
  });
  revalidatePath('/fitness');
  redirect('/fitness');
}
