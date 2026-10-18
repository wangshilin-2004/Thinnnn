import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { SiteHeader } from '@/components/site-header';
import {
  MEAL_LABELS,
  getFriendFitness,
  getFriendMeals,
  getMyLinks,
  type MealType,
} from '@/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { addDays, todayInTimezone } from '@/lib/nutrition';

/* 好友的当天记录。
 *
 * 只读页：没有任何表单，也没有「帮他记」的入口 ——
 * 那是别人的数据，能看已经是例外，不能顺手改。
 *
 * 有一件事必须在界面上说清楚：这里看到空，有两种完全不同的原因
 * （他没记 / 他关掉了共享）。页面分辨不出来，所以也不能假装知道。
 */

export const metadata = { title: '好友记录' };
export const dynamic = 'force-dynamic';

const CARD = 'rounded-2xl border border-separator bg-card p-space-5';
const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export default async function FriendDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const { id } = await params;

  const links = await getMyLinks(user.id);
  const link = links.find((l) => l.peerId === id && l.status === 'accepted');
  if (!link) notFound();

  const today = todayInTimezone(user.timezone);
  const weekAgo = addDays(today, -6);

  const [meals, fitness] = await Promise.all([
    getFriendMeals(user.id, id, today),
    getFriendFitness(user.id, id, weekAgo),
  ]);

  const totalKcal = meals.reduce((sum, m) => sum + m.kcal, 0);
  const totalProtein = meals.reduce((sum, m) => sum + m.proteinG, 0);
  const totalFat = meals.reduce((sum, m) => sum + m.fatG, 0);
  const totalCarb = meals.reduce((sum, m) => sum + m.carbG, 0);

  const round1 = (v: number) => Math.round(v * 10) / 10;

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-space-6 pb-24 pt-space-6">
        <div className="flex flex-col gap-space-2">
          <Link
            href="/friends"
            className="touch-target inline-flex h-11 items-center self-start text-subhead text-ink-3 transition-colors hover:text-ink"
          >
            ‹ 好友
          </Link>
          <p className="text-subhead text-ink-3">{today}</p>
          <h1 className="text-title-2 font-semibold text-ink">
            @{link.username ?? '（没设用户名）'}
          </h1>
        </div>

        {/* ── 今天吃了什么 ─────────────────────────────────────── */}
        <section className={CARD}>
          <div className="flex items-baseline justify-between gap-space-3">
            <h2 className="text-headline font-semibold text-ink">今天的饮食</h2>
            <span className="tabular text-subhead text-ink-3">{round1(totalKcal)} kcal</span>
          </div>

          {meals.length === 0 ? (
            <p className="mt-space-3 text-footnote text-ink-3">
              今天还没有记录 —— 也可能对方关掉了饮食共享，这两种情况这里分不出来。
            </p>
          ) : (
            <>
              <div className="mt-space-3 grid grid-cols-3 gap-space-3 text-center">
                {[
                  ['蛋白质', totalProtein],
                  ['脂肪', totalFat],
                  ['碳水', totalCarb],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-xl bg-sunken px-space-2 py-space-2">
                    <p className="text-caption-1 text-ink-4">{label}</p>
                    <p className="tabular text-subhead text-ink">{round1(Number(value))} g</p>
                  </div>
                ))}
              </div>
              <div className="mt-space-4 flex flex-col gap-space-4">
                {MEAL_ORDER.map((mealType) => {
                  const items = meals.filter((m) => m.mealType === mealType);
                  if (items.length === 0) return null;
                  const sum = items.reduce((acc, m) => acc + m.kcal, 0);
                  return (
                    <div key={mealType}>
                      <div className="flex items-baseline justify-between">
                        <h3 className="text-subhead font-medium text-ink-2">
                          {MEAL_LABELS[mealType]}
                        </h3>
                        <span className="tabular text-caption-1 text-ink-4">
                          {round1(sum)} kcal
                        </span>
                      </div>
                      <ul className="mt-space-2 flex flex-col gap-space-2">
                        {items.map((m) => (
                          <li
                            key={m.id}
                            className="flex items-baseline justify-between gap-space-3 rounded-xl bg-sunken px-space-3 py-space-2"
                          >
                            <span className="min-w-0 truncate text-footnote text-ink">
                              {m.foodName}
                              <span className="ml-space-2 text-caption-1 text-ink-4">
                                {m.servingLabel ?? `${round1(m.quantityG)} g`}
                              </span>
                            </span>
                            <span className="tabular shrink-0 text-footnote text-ink-3">
                              {round1(m.kcal)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ── 最近 7 天训练 ────────────────────────────────────── */}
        <section className={CARD}>
          <div className="flex items-baseline justify-between gap-space-3">
            <h2 className="text-headline font-semibold text-ink">最近 7 天训练</h2>
            <span className="tabular text-subhead text-ink-3">
              {fitness.cardio.reduce((s, c) => s + c.minutes, 0)} 分钟 ·{' '}
              {fitness.strength.reduce((s, c) => s + c.sets, 0)} 组
            </span>
          </div>

          {fitness.cardio.length === 0 && fitness.strength.length === 0 ? (
            <p className="mt-space-3 text-footnote text-ink-3">
              这几天没有训练记录 —— 同样，也可能对方关掉了训练共享。
            </p>
          ) : (
            <ul className="mt-space-3 flex flex-col divide-y divide-separator">
              {fitness.cardio.map((c, i) => (
                <li
                  key={`c-${c.date}-${i}`}
                  className="flex items-baseline justify-between gap-space-3 py-space-3"
                >
                  <span className="min-w-0 truncate text-footnote text-ink">
                    {c.activityName}
                    <span className="ml-space-2 text-caption-1 text-ink-4">{c.date}</span>
                  </span>
                  <span className="tabular shrink-0 text-footnote text-ink-3">
                    {c.minutes} 分钟
                  </span>
                </li>
              ))}
              {fitness.strength.map((s, i) => (
                <li
                  key={`s-${s.date}-${i}`}
                  className="flex items-baseline justify-between gap-space-3 py-space-3"
                >
                  <span className="min-w-0 truncate text-footnote text-ink">
                    {s.exerciseName}
                    <span className="ml-space-2 text-caption-1 text-ink-4">
                      {s.date} · {s.part}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-footnote text-ink-3">
                    {s.sets} × {s.reps}
                    {s.weightKg === null ? ' 自重' : ` · ${round1(s.weightKg)} kg`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="px-space-1 text-caption-1 text-ink-4">
          这里只看得到训练和饮食。对方的生日、身高、目标体重不会共享 —— 数据库层面就挡住了。
        </p>
      </main>
    </>
  );
}
