import type { Metadata } from 'next';

import { MEAL_LABELS, getFoodsForPicker, getMealsForDate, getProfile, getRecentFoods } from '@/db/queries';
import { requireUser } from '@/lib/auth';
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
 */
export default async function LogMealPage() {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);

  const [profile, catalog, recent, todaysMeals] = await Promise.all([
    getProfile(user.id),
    getFoodsForPicker(user.id),
    getRecentFoods(user.id, 12),
    getMealsForDate(user.id, today),
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
        <p className="text-footnote text-ink-3">
          {new Intl.DateTimeFormat('zh-CN', {
            timeZone: user.timezone,
            month: 'long',
            day: 'numeric',
            weekday: 'long',
          }).format(new Date())}
        </p>
        <h1 className="mt-1 text-title-1 font-semibold text-ink">记一餐</h1>
      </header>

      <MealLogger
        catalog={catalog}
        recent={recent}
        todaysMeals={todaysMeals}
        today={today}
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
