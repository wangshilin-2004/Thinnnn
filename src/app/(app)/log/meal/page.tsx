import type { Metadata } from 'next';
import Link from 'next/link';

import { MEAL_LABELS, getFoodsForPicker, getMealsForDate, getProfile, getRecentFoods } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import {
  formatCnDate,
  formatCnMonthDay,
  isDateString,
} from '@/lib/calendar';
import { guessMealType, todayInTimezone } from '@/lib/nutrition';

import { MealLogger } from './meal-logger';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '记一餐',
};

/* 记一餐 —— 整个产品的「每日必经之路」。
 *
 * 这一页的设计目标只有一个：让它快到不需要下决心。
 * 调研过的东西方所有同类项目（wger / OpenNutriTracker / MyFitnessPal）
 * 都败在同一件事上 —— 记录本身太麻烦，于是第 30 天之后没人再记。
 * 所以这里刻意做了三个取舍：
 *
 *   1. **没有「确认」这一步。** 点食物 = 立即记下默认份量。
 *      想改份量是记完之后的事，不是记之前的前置条件。
 *      任何「必填的第二屏」都会让 10 秒目标作废。
 *
 *   2. **最近吃过的排在搜索之前。** 减脂期的饮食高度重复，
 *      多数记录的其实是同一批食物。让它们出现在第一屏，
 *      常见的一餐就是「点一下」。
 *
 *   3. **食物目录一次性发给客户端。** 194 条约 20 KB，
 *      换来打字时零延迟。见 queries.ts 里 getFoodsForPicker 的注释。
 *
 * 加 ?date= 之后多了一条约束：**用户必须一眼看出自己在记哪一天**。
 * 记错日期的记录比没记还糟 —— 它污染了趋势图，而且很难发现。
 * 所以只要不是今天，页面顶部一定有一条横幅 + 一个「回到今天」。
 */
export default async function LogMealPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);

  const { date: rawDate } = await searchParams;

  /* ?date= 只在「从回顾里补记某一天」时出现。三种异常输入都回落到今天：
   *   - 没传
   *   - 传了但不合法的字符串（用户手改 URL）
   *   - 传了未来的日期（未来的日子没有记录可补）
   * 这里不报错页：手改 URL 是极边缘的操作，给个 404 反而像站坏了。
   * 关键是**接下来所有写入都用 selected**，不会有半途又变回今天的可能。 */
  const selected =
    rawDate && isDateString(rawDate) && rawDate <= today ? rawDate : today;
  const isToday = selected === today;

  const [profile, catalog, recent, todaysMeals] = await Promise.all([
    getProfile(user.id),
    getFoodsForPicker(user.id),
    getRecentFoods(user.id, 12),
    getMealsForDate(user.id, selected),
  ]);

  /* 用用户所在时区的小时数猜「这一顿最可能是哪一餐」。
   * 猜错的成本是多点一下，猜对的收益是每天少点三次。 */
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: user.timezone,
      hour: '2-digit',
      hour12: false,
    }).format(new Date()),
  );
  const defaultMealType = guessMealType(Number.isFinite(hour) ? hour : 12);

  return (
    <div className="content-max p-space-4 pb-24 sm:p-space-6">
      <header className="mb-space-6 pt-space-4">
        <p className="text-footnote text-ink-3">{formatCnDate(selected)}</p>
        <h1 className="mt-1 text-title-1 font-semibold text-ink">记一餐</h1>
      </header>

      {!isToday && (
        <div className="mb-space-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl border border-brand/30 bg-brand/10 px-4 py-2.5">
          <p className="text-subhead text-ink-2">
            你在补记{' '}
            <span className="font-semibold text-ink">
              {formatCnMonthDay(selected)}
            </span>
          </p>
          <Link
            href="/log/meal"
            className="inline-flex h-11 items-center px-2 text-subhead font-semibold text-brand-text"
          >
            回到今天
          </Link>
        </div>
      )}

      <MealLogger
        catalog={catalog}
        recent={recent}
        todaysMeals={todaysMeals}
        logDate={selected}
        isToday={isToday}
        defaultMealType={defaultMealType}
        mealLabels={MEAL_LABELS}
        targetKcal={profile?.targetKcal ?? null}
      />

      <p className="prose-measure mt-space-8 text-caption-1 text-ink-3">
        热量与营养值由公开公式估算，不构成医疗建议。
      </p>
    </div>
  );
}
