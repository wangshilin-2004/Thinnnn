import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { getDailySummaries, type DayRow } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import {
  buildCalendarGrid,
  formatCnMonthDay,
  formatCnWeekday,
  monthLabels,
  relativeDayLabel,
  weekdayIndex,
} from '@/lib/calendar';
import { DISCLAIMER, addDays, todayInTimezone } from '@/lib/nutrition';

export const metadata: Metadata = { title: '回顾' };

/* 和仪表盘一样不能静态化：内容取决于登录用户和「今天」是哪天。
 * 构建时烤死的话，第二天打开热力图右端还停在昨天。 */
export const dynamic = 'force-dynamic';

/** 热力图铺 13 周。
 *
 * 为什么是 13 而不是 12：13 周正好一个季度，一屏能看完整季的节奏；
 * 少到 8 周就只剩两个月的记忆，多到 26 周每格只有 10px、颜色糊成一片。
 * 也是 320px 宽屏幕上不回溢出、也不缩小到看不清的上限。 */
const WEEKS = 13;

/** 「最近记录」列多长。再往下翻就得做分页，先到此为止。 */
const RECENT_LIMIT = 30;

/** 热力档位。0 = 那天没有任何记录，4 = 记了 6 项以上。 */
const HEAT_CLASS = [
  'bg-sunken',
  'bg-brand/15',
  'bg-brand/35',
  'bg-brand/60',
  'bg-brand',
] as const;

function heatLevel(day: DayRow | undefined): number {
  if (!day) return 0;
  /* 只称了体重也算「来过」，但压到最浅一档 ——
   * 那天的饮食仍然是空的，不该和记满一天一个颜色。 */
  if (day.itemCount === 0) return 1;
  if (day.itemCount <= 2) return 2;
  if (day.itemCount <= 5) return 3;
  return 4;
}

/** 从今天往回数连续记了几天。
 *
 * 「今天还没记」不算断 —— 早上刚打开 App 时今天必然是空的，
 * 那时候显示「连续 0 天」会让人误以为自己已经断了，然后干脆放弃。
 * 所以今天空着就跳过，从昨天开始算。
 *
 * 循环上限 400 天：纯防御，避免脏数据导致死循环。 */
function countStreak(byDate: Map<string, DayRow>, today: string): number {
  let streak = 0;
  let cursor = today;
  for (let i = 0; i < 400; i += 1) {
    const day = byDate.get(cursor);
    if (day && day.itemCount > 0) {
      streak += 1;
    } else if (i > 0) {
      break;
    }
    cursor = addDays(cursor, -1);
  }
  return streak;
}

export default async function HistoryPage() {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);

  /* 网格右端是今天，左端往回数 13 周再**对齐到那一周的周日**。
   *
   * 为什么要对齐：不对齐的话，今天若在周三，第一列就只有周三到周六
   * 四格，之后每一列也不再是同一个星期几 —— 热力图就读不出
   * 「每周固定那几天」的节奏，而那正是它唯一的价值。
   * 代价是实际会画 13 或 14 列（取决于今天是周几），这没关系。 */
  const rawStart = addDays(today, -(WEEKS * 7 - 1));
  const gridStart = addDays(rawStart, -weekdayIndex(rawStart));

  const days = await getDailySummaries(user.id, gridStart, today);

  const byDate = new Map(days.map((d) => [d.date, d]));
  const weeks = buildCalendarGrid(gridStart, today);
  const monthRow = monthLabels(weeks);

  const last30Start = addDays(today, -29);
  const recent30 = days.filter(
    (d) => d.date >= last30Start && d.itemCount > 0,
  );

  const streak = countStreak(byDate, today);
  const avgKcal =
    recent30.length > 0
      ? Math.round(
          recent30.reduce((sum, d) => sum + d.intakeKcal, 0) / recent30.length,
        )
      : null;

  /* 有内容可回顾的日子才进列表：既记了饭，或者称了体重。
   * 两者都没有的那天在列表里只会是一行 0 kcal，没有信息量。 */
  const recent = [...days]
    .filter((d) => d.itemCount > 0 || d.weightKg !== null)
    .reverse()
    .slice(0, RECENT_LIMIT);

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
        <header className="flex flex-col gap-1">
          <p className="text-subhead text-ink-3">把每一天连起来看</p>
          <h1 className="text-title-1 font-semibold tracking-title text-ink">
            回顾
          </h1>
        </header>

        {recent.length === 0 ? (
          <div className="glass flex flex-col items-start gap-3 rounded-xl p-5">
            <h2 className="text-headline font-semibold text-ink">
              还没有可回顾的记录
            </h2>
            <p className="prose-measure text-subhead text-ink-2">
              记满几天之后，这里会变成一张热力图 ——
              哪天记得多、哪天断了，一眼就能看出来。
            </p>
            <Link
              href="/log/meal"
              className="inline-flex h-11 items-center rounded-full bg-brand px-5 text-subhead font-semibold text-on-accent"
            >
              去记一餐
            </Link>
          </div>
        ) : (
          <>
            {/* 热力图 ────────────────────────────────────────────── */}
            <section className="glass flex flex-col gap-4 rounded-xl p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 className="text-headline font-semibold text-ink">
                  最近 {WEEKS} 周
                </h2>
                <p className="text-caption-1 text-ink-3">
                  颜色越深，那天记得越多
                </p>
              </div>

              {/* 月份标签用绝对定位，而不是放进每个格子的头部：
               * 每列只有 16px 宽，而「10 月」要 30px，塞进列里会把
               * 列撑宽、毁掉对齐。绝对定位让它向右溢出到相邻的空白列上，
               * 因为月份之间隔了 4~5 列，视觉上不会撞。 */}
              <div className="relative h-4" aria-hidden>
                {monthRow.map((month, index) =>
                  month === null ? null : (
                    <span
                      key={`${month}-${index}`}
                      className="absolute top-0 text-caption-2 text-ink-4"
                      style={{ left: `${(index / weeks.length) * 100}%` }}
                    >
                      {month} 月
                    </span>
                  ),
                )}
              </div>

              {/* 列 = 周，行 = 星期几。整块只是密度可视化：
               * 每格 16px，做不到 44px 的触控目标，所以不单独可点 ——
               * 要进某一天，走下面「最近记录」的列表。 */}
              <p className="text-caption-2 text-ink-4">想回看某一天？点下面的列表</p>

<div className="flex gap-[3px]" aria-hidden>
                {weeks.map((week, weekIndex) => (
                  <div
                    key={weekIndex}
                    className="flex flex-1 flex-col gap-[3px]"
                  >
                    {week.map((cell, dayIndex) =>
                      cell === null ? (
                        <div
                          key={`blank-${dayIndex}`}
                          className="aspect-square rounded-[3px]"
                        />
                      ) : (
                        <div
                          key={cell.date}
                          className={`aspect-square rounded-[3px] ${
                            HEAT_CLASS[heatLevel(byDate.get(cell.date))]
                          }`}
                        />
                      ),
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-1.5 text-caption-1 text-ink-4">
                <span>少</span>
                {HEAT_CLASS.map((className) => (
                  <span
                    key={className}
                    className={`size-2.5 rounded-[3px] ${className}`}
                  />
                ))}
                <span>多</span>
              </div>
            </section>

            {/* 三个数 ────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3 rounded-xl bg-card p-5">
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-subhead text-ink-2">连续记录</span>
                <span className="tabular text-headline font-semibold text-ink">
                  {streak} 天
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-subhead text-ink-2">最近 30 天记了</span>
                <span className="tabular text-headline font-semibold text-ink">
                  {recent30.length} 天
                </span>
              </div>
              <div className="flex items-baseline justify-between gap-4">
                <span className="text-subhead text-ink-2">
                  有记录那天的平均摄入
                </span>
                <span className="tabular text-headline font-semibold text-ink">
                  {avgKcal === null ? '—' : `${avgKcal} kcal`}
                </span>
              </div>
            </section>

            {/* 最近记录 ──────────────────────────────────────────── */}
            <section className="flex flex-col gap-1">
              <h2 className="mb-2 text-headline font-semibold text-ink">
                最近记录
              </h2>
              <ul className="flex flex-col">
                {recent.map((day) => (
                  <li key={day.date}>
                    <Link
                      href={`/day/${day.date}`}
                      className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      <span className="flex flex-col">
                        <span className="text-subhead text-ink">
                          {formatCnMonthDay(day.date)}
                        </span>
                        <span className="text-caption-1 text-ink-3">
                          {relativeDayLabel(day.date, today) ??
                            formatCnWeekday(day.date)}
                          {day.weightKg !== null
                            ? ` · ${day.weightKg.toFixed(1)} kg`
                            : ''}
                        </span>
                      </span>
                      <span className="flex items-baseline gap-1.5">
                        {/* 只称了体重、没记饭的那天，摄入不是 0 而是「没有」，
                         * 写成 0 kcal 会误导。 */}
                        <span className="tabular text-subhead font-medium text-ink">
                          {day.itemCount > 0 ? day.intakeKcal : '—'}
                        </span>
                        <span className="text-caption-1 text-ink-3">kcal</span>
                        <svg
                          viewBox="0 0 24 24"
                          className="h-4 w-4 text-ink-4"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                        >
                          <path d="m9 5 7 7-7 7" />
                        </svg>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <p className="prose-measure text-caption-1 text-ink-4">{DISCLAIMER}</p>
      </main>
    </>
  );
}
