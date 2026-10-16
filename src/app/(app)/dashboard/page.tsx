import type { Metadata } from 'next';
import Link from 'next/link';

import { CalorieRing, MacroBar } from '@/components/calorie-ring';
import { SiteHeader } from '@/components/site-header';
import { WeightTrend } from '@/components/weight-trend';
import { getDailySummaries, getMealsForDate, getProfile, getWeightSeries, MEAL_LABELS } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import { addDays, analyzeTrend, DISCLAIMER, movingAverage, todayInTimezone } from '@/lib/nutrition';

export const metadata: Metadata = { title: '今天' };

/* 每次请求都重新读库。
 * 这里不能静态化：页面内容依赖登录用户和「今天」是哪天，
 * 构建时烤死的话，第二天打开还显示昨天的数据。 */
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 21;

export default async function DashboardPage() {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);
  const from = addDays(today, -(WINDOW_DAYS - 1));
  const weightFrom = addDays(today, -59);

  const [profile, days, weights, meals] = await Promise.all([
    getProfile(user.id),
    getDailySummaries(user.id, from, today),
    getWeightSeries(user.id, weightFrom, today),
    getMealsForDate(user.id, today),
  ]);

  const weightPoints = weights.map((w) => ({ date: w.date, value: w.kg }));
  const avg = movingAverage(weightPoints, 7);
  const latestAvg = [...avg].reverse().find((p) => p.avg !== null)?.avg ?? null;
  const latestWeight = weightPoints[weightPoints.length - 1]?.value ?? null;

  const trend = analyzeTrend(weightPoints, {
    targetKgPerWeek: profile?.rateKgPerWeek ? Number(profile.rateKgPerWeek) : undefined,
  });

  // 今日汇总优先用 daily_summary（触发器维护），没有行时用当天明细现场算。
  // 为什么不总是现场算：图表要扫 21 天，每天去聚合一遍 meal_items 会随
  // 记录量线性变慢；汇总表把它变成一次索引扫描。但今天这一天的实时性
  // 更重要（刚记完必须立刻看到），所以这里以明细为准做兜底。
  const todayRow = days.find((d) => d.date === today);
  const todayTotals = meals.reduce(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      protein: acc.protein + m.proteinG,
      fat: acc.fat + m.fatG,
      carb: acc.carb + m.carbG,
    }),
    { kcal: 0, protein: 0, fat: 0, carb: 0 },
  );
  const intake = Math.max(todayTotals.kcal, todayRow?.intakeKcal ?? 0);
  const protein = Math.max(todayTotals.protein, todayRow?.proteinG ?? 0);
  const fat = Math.max(todayTotals.fat, todayRow?.fatG ?? 0);
  const carb = Math.max(todayTotals.carb, todayRow?.carbG ?? 0);

  const targetKcal = profile?.targetKcal ?? 0;
  const hasPlan = Boolean(profile?.targetKcal && profile?.targetProteinG);

  const byMeal = new Map<string, typeof meals>();
  for (const m of meals) {
    const list = byMeal.get(m.mealType) ?? [];
    list.push(m);
    byMeal.set(m.mealType, list);
  }
  const mealOrder = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
        <header className="flex flex-col gap-1">
          <p className="text-subhead text-ink-3">{formatCn(today)}</p>
          <h1 className="text-title-1 font-semibold tracking-title text-ink">今天</h1>
        </header>

        {!hasPlan && (
          <div className="glass flex flex-col items-start gap-3 rounded-xl p-5">
            <h2 className="text-headline font-semibold text-ink">先把目标算出来</h2>
            <p className="prose-measure text-subhead text-ink-2">
              还需要你的身高、体重、年龄和活动量，才能算出每天该吃多少。
              这个过程只有一次，大约一分钟。
            </p>
            <Link
              href="/onboarding"
              className="inline-flex h-11 items-center rounded-full bg-brand px-5 text-subhead font-semibold text-on-accent"
            >
              去设置
            </Link>
          </div>
        )}

        {/* 今日热量 */}
        <section className="glass flex flex-col items-center gap-6 rounded-xl p-6 sm:flex-row sm:items-center sm:gap-10">
          <CalorieRing intake={intake} target={targetKcal} />
          <div className="flex w-full flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline font-semibold text-ink">今日热量</h2>
              <p className="text-subhead text-ink-3">
                {meals.length > 0 ? `已记录 ${meals.length} 项` : '今天还没有记录'}
              </p>
            </div>
            {hasPlan ? (
              <div className="flex flex-col gap-4">
                <MacroBar
                  label="蛋白质"
                  value={protein}
                  target={Number(profile!.targetProteinG)}
                  colorVar="var(--color-data-protein)"
                />
                <MacroBar
                  label="碳水"
                  value={carb}
                  target={Number(profile!.targetCarbG)}
                  colorVar="var(--color-data-carb)"
                />
                <MacroBar
                  label="脂肪"
                  value={fat}
                  target={Number(profile!.targetFatG)}
                  colorVar="var(--color-data-fat)"
                />
              </div>
            ) : (
              <p className="text-subhead text-ink-3">设置目标后这里会显示三大营养素进度。</p>
            )}
          </div>
        </section>

        {/* 体重趋势 */}
        <section className="flex flex-col gap-5 rounded-xl bg-card p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 className="text-headline font-semibold text-ink">体重趋势</h2>
              <p className="text-caption-1 text-ink-3">粗线 = 7 日均值 · 细线 = 每日实测</p>
            </div>
            <div className="flex items-baseline gap-6">
              <Stat label="当前" value={latestWeight} unit="kg" />
              <Stat label="7 日均值" value={latestAvg} unit="kg" />
            </div>
          </div>

          <WeightTrend points={weightPoints} trend={trend} />

          <p
            className="text-subhead"
            style={{
              color:
                trend.verdict === 'on_track'
                  ? 'var(--color-trend-good)'
                  : trend.verdict === 'insufficient_data'
                    ? 'var(--color-ink-3)'
                    : 'var(--color-trend-bad)',
            }}
          >
            {trend.message}
          </p>
        </section>

        {/* 今日饮食 */}
        <section className="flex flex-col gap-4 rounded-xl bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-headline font-semibold text-ink">今日饮食</h2>
            <Link
              href="/log/meal"
              className="inline-flex h-11 items-center rounded-full bg-raised px-4 text-subhead font-medium text-ink"
            >
              记一餐
            </Link>
          </div>

          {meals.length === 0 ? (
            <p className="text-subhead text-ink-3">
              还没有记录。点「记一餐」开始 —— 常吃的食物点一下就能记上。
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              {mealOrder.map((type) => {
                const list = byMeal.get(type);
                if (!list || list.length === 0) return null;
                const sum = list.reduce((a, m) => a + m.kcal, 0);
                return (
                  <div key={type} className="flex flex-col gap-2">
                    <div className="flex items-baseline justify-between">
                      <h3 className="text-subhead font-medium text-ink-2">{MEAL_LABELS[type]}</h3>
                      <span className="tabular text-footnote text-ink-3">
                        {Math.round(sum)} kcal
                      </span>
                    </div>
                    <ul className="flex flex-col">
                      {list.map((m) => (
                        <li
                          key={m.id}
                          className="flex items-baseline justify-between border-b border-hairline py-2 last:border-0"
                        >
                          <span className="text-subhead text-ink">
                            {m.foodName}
                            <span className="text-ink-3">　{m.servingLabel ?? `${m.quantityG} g`}</span>
                          </span>
                          <span className="tabular text-footnote text-ink-2">
                            {Math.round(m.kcal)} kcal
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <p className="prose-measure text-caption-2 leading-relaxed text-ink-4">{DISCLAIMER}</p>
      </main>
    </>
  );
}

function Stat({ label, value, unit }: { label: string; value: number | null; unit: string }) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-caption-1 text-ink-3">{label}</span>
      <span className="tabular text-title-3 font-semibold tracking-title text-ink">
        {value === null ? '—' : value.toFixed(1)}
        <span className="ml-0.5 text-footnote font-normal text-ink-3">{unit}</span>
      </span>
    </div>
  );
}

function formatCn(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const week = ['日', '一', '二', '三', '四', '五', '六'][
    new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay()
  ];
  return `${y} 年 ${m} 月 ${d} 日 · 周${week}`;
}
