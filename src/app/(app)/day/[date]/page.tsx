import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { MEAL_LABELS } from '@/db/queries';
import type { MealType } from '@/db/queries';
import { getMealsForDate, getProfile, getWeightSeries } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import {
  formatCnDate,
  formatCnWeekday,
  isDateString,
  relativeDayLabel,
} from '@/lib/calendar';
import { DISCLAIMER, todayInTimezone } from '@/lib/nutrition';
import { portionText } from '@/lib/portion';

export const dynamic = 'force-dynamic';

/* 一天的完整记录。从「回顾」列表点进来。
 *
 * 为什么单独一页而不是把内容塞进 /history：
 * 回顾要的是「密度和节奏」，一天要的是「这天到底吃了什么」——
 * 两者信息密度差一个数量级，挤在一块会把回顾页也弄臃肿。
 *
 * 这一页**只读**。要改某天的记录，走底部的按钮回 /log/meal?date=…
 * 那边复用了完整的记一餐界面（含删除和改份量），不在这里重复实现一套。 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ date: string }>;
}): Promise<Metadata> {
  const { date } = await params;
  // 标题用日期而不是「这一天」：浏览器标签页和分享预览里都能一眼看出是哪天。
  return { title: isDateString(date) ? formatCnDate(date) : '这一天' };
}

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** 一行「标签 — 数值」。
 *  这一页上全是这种成对信息，抽出来避免八处重复的 flex 类名。 */
function Row({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-subhead text-ink-2">{label}</span>
      <span
        className={`tabular text-subhead font-medium ${
          muted ? 'text-ink-3' : 'text-ink'
        }`}
      >
        {value}
      </span>
    </div>
  );
}

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;

  /* 非法日期直接 404，不做「回退到今天」这种猜测 ——
   * 用户手改 URL 改错了，悄悄给他看今天的数据比报错更糟：
   * 他会以为那就是他改的那个日期。 */
  if (!isDateString(date)) notFound();

  const user = await requireUser();
  const today = todayInTimezone(user.timezone);

  // 未来的日子不可能有记录，看它没有意义。
  if (date > today) notFound();

  const [profile, meals, weights] = await Promise.all([
    getProfile(user.id),
    getMealsForDate(user.id, date),
    getWeightSeries(user.id, date, date),
  ]);

  const weightKg = weights[0]?.kg ?? null;

  const grouped = MEAL_ORDER.map((mealType) => ({
    mealType,
    items: meals.filter((m) => m.mealType === mealType),
  })).filter((group) => group.items.length > 0);

  const totalKcal = Math.round(
    meals.reduce((sum, m) => sum + m.kcal, 0),
  );
  const totalProtein = Math.round(
    meals.reduce((sum, m) => sum + m.proteinG, 0),
  );
  const totalFat = Math.round(meals.reduce((sum, m) => sum + m.fatG, 0));
  const totalCarb = Math.round(meals.reduce((sum, m) => sum + m.carbG, 0));

  const targetKcal = profile?.targetKcal ?? null;
  const diff = targetKcal === null ? null : totalKcal - targetKcal;

  const relative = relativeDayLabel(date, today);
  const hasAnything = meals.length > 0 || weightKg !== null;

  return (
    <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
      <div className="flex flex-col gap-3">
        <Link
          href="/history"
          className="-ml-2 inline-flex h-11 items-center gap-1 rounded-lg px-2 text-subhead text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="m15 5-7 7 7 7" />
          </svg>
          回顾
        </Link>
        <header className="flex flex-col gap-1">
          <p className="text-subhead text-ink-3">
            {relative ?? formatCnWeekday(date)}
          </p>
          <h1 className="text-title-2 font-semibold tracking-title text-ink">
            {formatCnDate(date).replace(' · ', ' ')}
          </h1>
        </header>
      </div>

      {!hasAnything ? (
        <div className="glass flex flex-col items-start gap-3 rounded-xl p-5">
          <h2 className="text-headline font-semibold text-ink">这天没有记录</h2>
          <p className="prose-measure text-subhead text-ink-2">
            漏记很常见，补上就好。反正周末翻回来一看，
            有记录的日子和空白的日子，差别一眼就能看出来。
          </p>
        </div>
      ) : (
        <>
          {/* 摄入总览 ──────────────────────────────────────────── */}
          {meals.length > 0 && (
            <section className="glass flex flex-col gap-4 rounded-xl p-5">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-headline font-semibold text-ink">
                  摄入 {totalKcal.toLocaleString('zh-CN')} kcal
                </h2>
                {targetKcal !== null && diff !== null && (
                  <span className="text-caption-1 text-ink-3">
                    {diff > 0 ? `超目标 ${diff}` : `比目标少 ${Math.abs(diff)}`}{' '}
                    kcal
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2 border-t border-hairline pt-4">
                <Row
                  label="蛋白质"
                  value={`${totalProtein} g`}
                  muted
                />
                <Row label="脂肪" value={`${totalFat} g`} muted />
                <Row label="碳水" value={`${totalCarb} g`} muted />
              </div>
            </section>
          )}

          {/* 体重 ──────────────────────────────────────────────── */}
          {weightKg !== null && (
            <section className="flex items-center justify-between gap-4 rounded-xl bg-card p-5">
              <h2 className="text-headline font-semibold text-ink">体重</h2>
              <span className="tabular text-title-3 font-semibold text-ink">
                {weightKg.toFixed(1)}
                <span className="ml-1 text-footnote font-normal text-ink-3">
                  kg
                </span>
              </span>
            </section>
          )}

          {/* 三餐明细 ──────────────────────────────────────────── */}
          {grouped.map((group) => {
            const groupKcal = Math.round(
              group.items.reduce((sum, m) => sum + m.kcal, 0),
            );
            return (
              <section key={group.mealType} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-headline font-semibold text-ink">
                    {MEAL_LABELS[group.mealType]}
                  </h2>
                  <span className="tabular text-footnote text-ink-3">
                    {groupKcal} kcal
                  </span>
                </div>
                <ul className="flex flex-col overflow-hidden rounded-xl bg-card">
                  {group.items.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-4 border-b border-separator px-5 py-3.5 last:border-b-0"
                    >
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="truncate text-subhead text-ink">
                          {item.foodName}
                        </span>
                        <span className="text-caption-1 text-ink-3">
                          {portionText({
                            quantityG: item.quantityG,
                            servingGrams: item.servingGrams,
                            servingLabel: item.servingLabel,
                          })}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-subhead text-ink-2">
                        {Math.round(item.kcal)} kcal
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </>
      )}

      {/* 编辑入口 ──────────────────────────────────────────────── */}
      <Link
        href={`/log/meal?date=${date}`}
        className="inline-flex h-11 items-center justify-center rounded-full bg-brand px-5 text-subhead font-semibold text-on-accent"
      >
        {hasAnything ? '改这一天的记录' : '补记这一天'}
      </Link>

      <p className="prose-measure text-caption-1 text-ink-4">{DISCLAIMER}</p>
    </main>
  );
}
