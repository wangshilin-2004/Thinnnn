import type { Metadata } from 'next';
import { desc, eq, and } from 'drizzle-orm';

import { db, withUser } from '@/db';
import { measurements, profiles } from '@/db/schema';
import { requireUser } from '@/lib/auth';
import { OnboardingForm } from './onboarding-form';

export const metadata: Metadata = { title: '设定目标' };

/* 每次都要读当前值，构建时烤死没意义。 */
export const dynamic = 'force-dynamic';

export default async function OnboardingPage() {
  const user = await requireUser();

  /* 这里读 profile 用的是 db（postgres 角色，绕过 RLS），不是 withUser。
   *
   * 为什么这次可以：查询条件就是 `id = 当前登录用户`，而且只读自己那一行，
   * 拿不到别人的数据。RLS 的价值在于「应用层写错条件时兜底」，
   * 而这里的条件是主键等值、由服务端从会话推导，不存在写错的余地。
   *
   * 但体重那条**不能**这么偷懒：measurements 里一个用户有多个 metric、
   * 多天数据，条件写松一点就会读到别人的。所以下面用 withUser。 */
  const [profile] = await db.select().from(profiles).where(eq(profiles.id, user.id)).limit(1);

  const latest = await withUserLatestWeight(user.id);

  /* 已有值就回填，让用户能改而不是从零重填。
   * 注意 height/weight 是 numeric 列，读出来是 string —— 直接塞进
   * <input defaultValue> 正合适，不用转。 */
  return (
    <main className="content-max p-space-4 pb-10 sm:p-space-6">
      <p className="text-subhead text-ink-3">先花一分钟</p>
      <h1 className="mt-space-1 text-title-1 font-semibold text-ink">算出你的每日目标</h1>
      <p className="prose-measure mt-space-3 text-body text-ink-2">
        有了目标，这个网站才转得起来：控制台要知道你今天还能吃多少，趋势页要拿它跟你实际吃进去的对比。
        <br />
        <span className="text-ink-3">不想细究就按默认值填，之后随时能改。</span>
      </p>

      <div className="prose-measure mt-space-8">
        <OnboardingForm
          defaults={{
            sex: profile?.sex ?? null,
            birthDate: profile?.birthDate ?? null,
            heightCm: profile?.heightCm ?? null,
            weightKg: latest ?? profile?.startWeightKg ?? null,
            activityLevel: profile?.activityLevel ?? null,
            goalType: profile?.goalType ?? null,
          }}
        />
      </div>
    </main>
  );
}

/** 取最近一次体重记录。独立成函数只是为了把 withUser 的用法收在一处。 */
async function withUserLatestWeight(userId: string): Promise<string | null> {
  return withUser(userId, async (tx) => {
    const [row] = await tx
      .select({ value: measurements.value })
      .from(measurements)
      .where(and(eq(measurements.userId, userId), eq(measurements.metric, 'weight')))
      /* 按测量日期倒序，不是 created_at —— 用户可能今天补录昨天的体重，
       * 那条的 created_at 更新但 measured_on 更早，"最近一次"应该按日期算。 */
      .orderBy(desc(measurements.measuredOn))
      .limit(1);
    return row?.value ?? null;
  });
}
