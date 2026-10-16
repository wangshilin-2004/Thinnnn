'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';

import { withUser } from '@/db';
import { measurements, profiles } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { buildPlan, todayInTimezone, type ActivityLevel, type GoalType, type Sex } from '@/lib/nutrition';

/* OnboardingState 与 ONBOARDING_INITIAL 都在 ./state.ts —— 'use server'
 * 文件只允许导出 async 函数，常量留在本文件会让提交表单时 500。 */
import type { OnboardingState } from './state';

/* 引导流程：把「算出你的目标」这件事做一次，然后存下来。
 *
 * 为什么不每次渲染现算：
 *  1. 用户可能想手动改目标（"系统说 1730，我偏要 1600"）
 *  2. 历史要用**当时**的目标来评判 —— 今天改了目标，
 *     不该让上个月每一天都突然变成"超标"
 *  3. 省掉每次渲染的重算
 * 详见 src/db/schema.ts 里 profiles 那段注释。
 */

const SEXES: readonly Sex[] = ['male', 'female'];
const LEVELS: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
const GOALS: readonly GoalType[] = ['lose', 'maintain', 'gain'];

/** 从 FormData 里取一个数字，顺带做范围校验。 */
function numField(fd: FormData, key: string, min: number, max: number, label: string): number | string {
  const raw = String(fd.get(key) ?? '').trim();
  if (!raw) return `${label}还没填`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${label}不是数字`;
  if (n < min || n > max) return `${label}看起来不合理（应该在 ${min}–${max} 之间）`;
  return n;
}

export async function savePlan(_prev: OnboardingState, formData: FormData): Promise<OnboardingState> {
  /* requireUser 而不是 getCurrentUser：走不到用户就不该继续。
   * 它会 redirect 到登录页（redirect 靠抛异常中断执行，
   * 所以下面任何代码都不会跑 —— 这正是我们要的）。 */
  const user = await requireUser();

  // ── 取值与校验 ────────────────────────────────────────
  const sex = String(formData.get('sex') ?? '');
  if (!SEXES.includes(sex as Sex)) return { status: 'error', message: '请选择生理性别 —— 基础代谢公式需要它' };

  const activityLevel = String(formData.get('activityLevel') ?? '');
  if (!LEVELS.includes(activityLevel as ActivityLevel))
    return { status: 'error', message: '请选择活动水平' };

  const goalType = String(formData.get('goalType') ?? '');
  if (!GOALS.includes(goalType as GoalType)) return { status: 'error', message: '请选择目标' };

  const birthDate = String(formData.get('birthDate') ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return { status: 'error', message: '出生日期还没填' };

  const heightCm = numField(formData, 'heightCm', 50, 260, '身高');
  if (typeof heightCm === 'string') return { status: 'error', message: heightCm };

  const weightKg = numField(formData, 'weightKg', 20, 400, '体重');
  if (typeof weightKg === 'string') return { status: 'error', message: weightKg };

  /* 用**用户自己时区**的今天，不是服务器今天。
   * Vercel 跑在 UTC，北京时间的晚上比 UTC 早 8 小时：
   * 不处理会让"今天"在某些时段整体错一天。 */
  const today = todayInTimezone(user.timezone);

  if (birthDate >= today) return { status: 'error', message: '出生日期不能是未来' };

  const ageMs = Date.parse(today) - Date.parse(birthDate);
  if (ageMs / (365.25 * 24 * 3600 * 1000) > 120) {
    return { status: 'error', message: '出生日期看起来填错了' };
  }

  // ── 算 ────────────────────────────────────────────────
  const plan = buildPlan({
    sex: sex as Sex,
    birthDate,
    heightCm,
    weightKg,
    activityLevel: activityLevel as ActivityLevel,
    goalType: goalType as GoalType,
    onDate: today,
  });

  // ── 存 ────────────────────────────────────────────────
  /* 全部走 withUser：它会在事务里 set local role authenticated，
   * 于是 RLS 真正生效。如果用默认的 postgres 角色（表属主），
   * RLS 会被绕过 —— 应用层哪天写错 where 就没有第二道防线了。 */
  await withUser(user.id, async (tx) => {
    await tx
      .update(profiles)
      .set({
        sex: sex as Sex,
        birthDate,
        // numeric 列在 postgres.js 里以 string 往返，传数字也能被接受，
        // 但统一显式转成字符串，避免依赖驱动的隐式转换。
        heightCm: String(heightCm),
        activityLevel: activityLevel as ActivityLevel,
        goalType: goalType as GoalType,
        startWeightKg: String(weightKg),
        bmrKcal: plan.bmrKcal,
        tdeeKcal: plan.tdeeKcal,
        targetKcal: plan.targetKcal,
        targetProteinG: String(plan.proteinG),
        targetCarbG: String(plan.carbG),
        targetFatG: String(plan.fatG),
        calcVersion: plan.calcVersion,
        onboardedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(profiles.id, user.id));

    /* 顺手把「当前体重」写成第一条体重点。
     *
     * 为什么重要：趋势页靠 measurements 出曲线，而 daily_summary
     * 只有"当天有饮食记录"才有行。如果引导时不写这一条，
     * 用户填完目标进去看到的是一张空图 —— 而空图是最劝退的东西。
     * 有了它，第 0 天就有一个点，第二天再来就成了一条线。
     *
     * ON CONFLICT DO UPDATE 对应 UNIQUE(user_id, metric, measured_on)：
     * 同一天重填引导（改身高体重）应该是覆盖，不是插入第二条。 */
    await tx
      .insert(measurements)
      .values({
        userId: user.id,
        metric: 'weight',
        measuredOn: today,
        value: String(weightKg),
        unit: 'kg',
        source: 'manual',
        note: '引导流程初始体重',
      })
      .onConflictDoUpdate({
        target: [measurements.userId, measurements.metric, measurements.measuredOn],
        /* 注意这里**没有** updatedAt：measurements 表只有 created_at，
         * 没有 updated_at（体重记录被视为事实，改了就改 created_at 不变）。
         * 我在种子脚本里已经在同一个地方错过一次 —— 症状是
         * `column "updated_at" of relation "measurements" does not exist` (42703)。
         * 判断一张表有没有 updated_at，看 schema，别靠"一般都有"。 */
        set: { value: String(weightKg) },
      });
  });

  /* revalidatePath 放在事务**提交之后** —— 放在里面的话，
   * 如果事务后来回滚了，缓存已经被清掉，页面会重新读到一个旧值，
   * 于是"刚存的东西不见了"这种最难查的 bug 就出现了。 */
  revalidatePath('/dashboard');
  revalidatePath('/trends');
  redirect('/dashboard?welcome=1');
}
