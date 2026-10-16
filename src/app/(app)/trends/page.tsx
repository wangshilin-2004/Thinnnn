import type { Metadata } from 'next';
import Link from 'next/link';

import { CombinedTrend, type TrendDay } from '@/components/combined-trend';
import { getDailySummaries, getProfile, getWeightSeries } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import {
  DISCLAIMER,
  analyzeTrend,
  addDays,
  movingAverage,
  todayInTimezone,
} from '@/lib/nutrition';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '趋势',
};

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

function parseRange(raw: string | undefined): Range {
  const n = Number(raw);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 30;
}

/** 把两个独立的数据源（日汇总 + 体重测量）对齐到同一根时间轴上。
 *
 * 这是整个页面最容易被写错的地方：daily_summary 只有「当天记了饮食」
 * 才有行，measurements 只有「当天称了体重」才有行，两者重叠度很低。
 * 如果直接按数组下标对齐，第 5 个饮食日会被错配到第 5 个体重日。
 * 所以先按日期生成**完整的连续日期序列**，再把两份数据贴上去。 */
function buildDays(
  from: string,
  to: string,
  summaries: Awaited<ReturnType<typeof getDailySummaries>>,
  weights: Awaited<ReturnType<typeof getWeightSeries>>,
): TrendDay[] {
  const byDate = new Map(summaries.map((s) => [s.date, s]));
  const weightByDate = new Map(weights.map((w) => [w.date, w.kg]));

  const out: TrendDay[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const s = byDate.get(d);
    out.push({
      date: d,
      weightKg: weightByDate.get(d) ?? null,
      intakeKcal: s?.intakeKcal ?? 0,
      itemCount: s?.itemCount ?? 0,
      targetKcal: s?.targetKcal ?? null,
    });
  }
  return out;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const sp = await searchParams;
  const range = parseRange(sp.range);

  const user = await requireUser();
  const today = todayInTimezone(user.timezone);
  const from = addDays(today, -(range - 1));

  /* 体重用更长的窗口：趋势判断要 14 天，而图上只显示 range 天时
   * 前几天的移动平均会因为「窗口内样本不足」而缺失，曲线会从中间
   * 才开始。多取 7 天喂给移动平均，图上就是一条完整的线。 */
  const weightFrom = addDays(from, -7);

  const [profile, summaries, weights] = await Promise.all([
    getProfile(user.id),
    getDailySummaries(user.id, weightFrom, today),
    getWeightSeries(user.id, weightFrom, today),
  ]);

  const days = buildDays(from, today, summaries, weights);

  const weightPoints = weights.map((w) => ({ date: w.date, value: w.kg }));
  const targetKgPerWeek =
    profile?.rateKgPerWeek != null ? Number(profile.rateKgPerWeek) : undefined;
  const trend = analyzeTrend(weightPoints, { targetKgPerWeek });

  const avg = movingAverage(weightPoints, 7);
  const latestAvg = avg.length > 0 ? avg[avg.length - 1]!.avg : null;
  const latestKg =
    weightPoints.length > 0 ? weightPoints[weightPoints.length - 1]!.value : null;

  /* ── 关联分析：把「吃了多少」和「体重怎么变」接起来 ──────────────
   *
   * 这是调研里发现的功能空白，也是这个产品存在的理由。做法很朴素：
   *   理论每周变化 = (TDEE − 平均摄入) × 7 ÷ 7700
   *   实际每周变化 = 体重序列的最小二乘斜率 × 7
   * 两个数放在一起，「我明明少吃了为什么没瘦」这个问题就有了可查的答案。
   *
   * 已知的偏差来源（不能装作没有，所以写在页面上）：
   *   · 7700 kcal/kg 是脂肪组织的近似值，早期减重包含水分和糖原
   *   · 食物热量是估算值，标签允许 ±20% 误差，外食偏差更大
   *   · TDEE 是用公式估的，个体差异可达 ±10%
   * 所以这里给的是「量级参考」，不是精确预测。 */
  const logged = days.filter((d) => d.itemCount > 0);
  const avgIntake =
    logged.length > 0 ? logged.reduce((s, d) => s + d.intakeKcal, 0) / logged.length : null;

  const tdee = profile?.tdeeKcal ?? null;
  const theoreticalKgPerWeek =
    avgIntake !== null && tdee !== null && logged.length >= 3
      ? ((tdee - avgIntake) * 7) / 7700
      : null;

  return (
    <div className="content-max p-space-4 pb-10 sm:p-space-6">
      <header className="mb-space-5 pt-space-4">
        <p className="text-footnote text-ink-3">体重和吃进去的东西</p>
        <h1 className="mt-1 text-title-1 font-semibold text-ink">趋势</h1>
      </header>

      {/* ── 时间范围 ─────────────────────────────────────────── */}
      <div className="mb-space-5 inline-flex gap-1 rounded-md bg-sunken p-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/trends?range=${r}`}
            scroll={false}
            aria-current={r === range ? 'true' : undefined}
            className={`touch-target rounded-sm px-4 py-2 text-subhead transition-colors ${
              r === range ? 'bg-raised font-semibold text-ink shadow-sm' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {r} 天
          </Link>
        ))}
      </div>

      <section className="mb-space-5 rounded-lg border border-hairline bg-card p-space-4">
        <CombinedTrend days={days} />
        <div className="mt-space-3 flex flex-wrap gap-x-space-4 gap-y-1 text-caption-1 text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 20 6" className="h-1.5 w-5" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke="var(--color-data-weight)"
                strokeWidth="2.6"
                strokeLinecap="round"
              />
            </svg>
            7 日均值
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 20 6" className="h-1.5 w-5" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke="var(--color-data-weight)"
                strokeWidth="1.4"
                strokeOpacity="0.35"
                strokeLinecap="round"
              />
            </svg>
            每日实测
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 20 6" className="h-1.5 w-5" aria-hidden>
              <line
                x1="0"
                y1="3"
                x2="20"
                y2="3"
                stroke="var(--color-ink-3)"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            </svg>
            目标热量
          </span>
        </div>
      </section>

      {/* ── 关键数字 ─────────────────────────────────────────── */}
      <section className="mb-space-5 grid grid-cols-2 gap-space-3 sm:grid-cols-4">
        <Stat label="最新体重" value={latestKg} unit="kg" digits={1} />
        <Stat label="7 日均值" value={latestAvg} unit="kg" digits={1} />
        <Stat
          label="趋势速度"
          value={trend.reliable ? trend.kgPerWeek : null}
          unit="kg/周"
          digits={2}
          signed
        />
        <Stat label="平均摄入" value={avgIntake} unit="kcal" digits={0} />
      </section>

      {/* ── 趋势解读 ─────────────────────────────────────────── */}
      {trend.reliable && (
        <section className="mb-space-5 rounded-lg border border-hairline bg-card p-space-4">
          <h2 className="text-subhead font-semibold text-ink">趋势解读</h2>
          <p className="prose-measure mt-2 text-subhead text-ink-2">{trend.message}</p>
        </section>
      )}

      {/* ── 关联分析（差异化功能） ───────────────────────────── */}
      {theoreticalKgPerWeek !== null && avgIntake !== null && tdee !== null && (
        <section className="mb-space-5 rounded-lg border border-hairline bg-card p-space-4">
          <h2 className="text-subhead font-semibold text-ink">吃得少，和瘦下来，对得上吗</h2>

          <dl className="mt-space-3 space-y-2">
            <Row
              term={`平均每天摄入（${logged.length} 天有记录）`}
              desc={`${Math.round(avgIntake).toLocaleString('zh-CN')} kcal`}
            />
            <Row
              term="估算的每日消耗"
              desc={`${tdee.toLocaleString('zh-CN')} kcal`}
              note="按公式估算"
            />
            <Row
              term="平均每天的热量缺口"
              desc={`${Math.round(tdee - avgIntake).toLocaleString('zh-CN')} kcal`}
            />
          </dl>

          <div className="mt-space-4 grid grid-cols-2 gap-space-3 border-t border-separator pt-space-4">
            <div>
              <p className="text-caption-1 text-ink-3">按热量缺口推算</p>
              <p className="tabular mt-1 text-title-3 font-semibold text-ink">
                {theoreticalKgPerWeek >= 0 ? '−' : '+'}
                {Math.abs(theoreticalKgPerWeek).toFixed(2)}
                <span className="ml-1 text-footnote font-normal text-ink-3">kg/周</span>
              </p>
            </div>
            <div>
              <p className="text-caption-1 text-ink-3">体重实际趋势</p>
              <p
                className={`tabular mt-1 text-title-3 font-semibold ${
                  !trend.reliable
                    ? 'text-ink-3'
                    : trend.kgPerWeek <= 0
                      ? 'text-accent-green'
                      : 'text-accent-orange'
                }`}
              >
                {trend.reliable ? (
                  <>
                    {trend.kgPerWeek <= 0 ? '−' : '+'}
                    {Math.abs(trend.kgPerWeek).toFixed(2)}
                    <span className="ml-1 text-footnote font-normal text-ink-3">kg/周</span>
                  </>
                ) : (
                  <span className="text-subhead font-normal">数据不足</span>
                )}
              </p>
            </div>
          </div>

          <p className="prose-measure mt-space-4 text-caption-1 text-ink-3">
            两个数对不上是正常的，差异通常来自三处：早期减重里有水分和糖原（不是脂肪）、
            食物热量本身是估算（标签允许 ±20% 误差，外食偏差更大）、以及用公式估的消耗量
            和你的真实代谢有差距。这个对比是用来判断量级的，不是精确预测。
          </p>
        </section>
      )}

      <p className="prose-measure text-caption-1 text-ink-3">{DISCLAIMER}</p>
    </div>
  );
}

function Stat({
  label,
  value,
  unit,
  digits,
  signed = false,
}: {
  label: string;
  value: number | null;
  unit: string;
  digits: number;
  signed?: boolean;
}) {
  const display =
    value === null || !Number.isFinite(value)
      ? '—'
      : `${signed && value > 0 ? '+' : ''}${value.toFixed(digits)}`;

  return (
    <div className="rounded-md border border-hairline bg-card p-space-3">
      <p className="text-caption-1 text-ink-3">{label}</p>
      <p className="tabular mt-1 text-title-4 font-semibold text-ink">
        {display}
        {display !== '—' && <span className="ml-0.5 text-caption-1 font-normal text-ink-3">{unit}</span>}
      </p>
    </div>
  );
}

function Row({ term, desc, note }: { term: string; desc: string; note?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-subhead text-ink-2">
        {term}
        {note && <span className="ml-1 text-caption-1 text-ink-3">（{note}）</span>}
      </dt>
      <dd className="tabular shrink-0 text-subhead font-medium text-ink">{desc}</dd>
    </div>
  );
}
