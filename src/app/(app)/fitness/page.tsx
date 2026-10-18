import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { getActiveSession, getCardioForDate, getFitnessSince, getStrengthForDate } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import { formatCnDate } from '@/lib/calendar';
import { addDays, todayInTimezone } from '@/lib/nutrition';
import { deleteCardio, deleteStrength, startSession } from './actions';

export const metadata: Metadata = { title: '训练' };

/* 内容取决于登录用户和「今天」，不能静态化 */
export const dynamic = 'force-dynamic';

const INTENSITY_LABEL = {
  easy: '轻松',
  moderate: '适中',
  hard: '吃力',
} as const;

/** 「最近 7 天」的窗口。一周是普通人判断「这周练够了没」的自然单位。 */
const RECENT_DAYS = 7;

export default async function FitnessPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);
  const active = await getActiveSession(user.id, today);
  const { saved } = await searchParams;

  const [cardio, strength, recent] = await Promise.all([
    getCardioForDate(user.id, today),
    getStrengthForDate(user.id, today),
    getFitnessSince(user.id, addDays(today, -(RECENT_DAYS - 1))),
  ]);

  const cardioMinutes = cardio.reduce((sum, r) => sum + r.minutes, 0);
  const strengthSets = strength.reduce((sum, r) => sum + r.sets, 0);

  /* 最近 7 天：只用来回答「这周练了几次」，所以只求和、不画图 ——
   * 画图是 /history 的事，这里再铺一张热力图会把「今天记了没」这件事淹掉。 */
  const weekCardio = recent.cardio.reduce((sum, r) => sum + r.minutes, 0);
  const weekSets = recent.strength.reduce((sum, r) => sum + r.sets, 0);
  const weekDays = new Set([
    ...recent.cardio.map((r) => r.date),
    ...recent.strength.map((r) => r.date),
  ]).size;

  const empty = cardio.length === 0 && strength.length === 0;

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
        <header className="flex flex-col gap-1">
          <p className="text-subhead text-ink-3">{formatCnDate(today)}</p>
          <h1 className="text-title-1 font-semibold tracking-title text-ink">训练</h1>
        </header>

        {/* 记完回来给一句确认。没有这行字，用户点完提交只会看到页面刷新了一下，
            分不清是成功了还是自己点漏了。 */}
        {saved && (
          <p
            role="status"
            className="rounded-xl border border-brand/30 bg-brand/10 px-space-4 py-space-3 text-subhead text-brand-text"
          >
            记下了。今天的训练在最下面。
          </p>
        )}

        {/* 今日概览。两个数字并排 —— 有氧看时长、无氧看组数，
            它们本来就是两种不同的计量单位，硬合成一个数字没有意义。 */}
        <section className="flex items-stretch gap-space-4 rounded-xl bg-card p-space-6">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-caption-1 text-ink-3">今天有氧</span>
            <span className="tabular text-title-2 font-semibold text-ink">
              {cardioMinutes}
              <span className="ml-1 text-subhead font-normal text-ink-3">分钟</span>
            </span>
          </div>
          <div className="w-px shrink-0 self-stretch bg-hairline" aria-hidden />
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-caption-1 text-ink-3">今天无氧</span>
            <span className="tabular text-title-2 font-semibold text-ink">
              {strengthSets}
              <span className="ml-1 text-subhead font-normal text-ink-3">组</span>
            </span>
          </div>
        </section>

        {/* 两个入口并排。有氧/无氧是用户在健身房里的第一层决策
            （「今天跑还是练」），所以放在第一层，不再套一个「新增记录」。 */}
        <section className="grid grid-cols-2 gap-space-4">
          <Link
            href={`/fitness/cardio?date=${today}`}
            className="touch-target flex min-h-28 flex-col justify-between gap-space-2 rounded-xl border border-hairline bg-card p-space-5 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="text-headline font-semibold text-ink">记有氧</span>
            <span className="text-footnote text-ink-3">跑步机、爬楼机、椭圆机…</span>
          </Link>
          <Link
            href={`/fitness/strength?part=胸&date=${today}`}
            className="touch-target flex min-h-28 flex-col justify-between gap-space-2 rounded-xl border border-hairline bg-card p-space-5 transition-colors hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <span className="text-headline font-semibold text-ink">记无氧</span>
            <span className="text-footnote text-ink-3">胸、肩、背、腿</span>
          </Link>
        </section>

        {/* 今日明细 */}
        <section className="flex flex-col gap-space-3">
          {active ? (
            <Link
              href={`/fitness/session/${active.id}`}
              className="glass flex items-center justify-between rounded-md p-space-4"
            >
              <span className="text-subhead font-semibold text-ink">有一场训练没结束 · 继续</span>
              <span className="text-brand-text">→</span>
            </Link>
          ) : (
            <form action={startSession} className="glass rounded-md p-space-4">
              <input type="hidden" name="logDate" value={today} />
              <p className="text-subhead font-semibold text-ink">开始一场训练</p>
              <p className="mt-space-1 text-footnote text-ink-3">
                选今天练哪儿 —— 进去之后排动作、按组计时，练完自动记进今天的训练记录。
              </p>
              <div className="mt-space-3 grid grid-cols-4 gap-space-2">
                {(['胸', '肩', '背', '腿'] as const).map((part) => (
                  <button
                    key={part}
                    type="submit"
                    name="part"
                    value={part}
                    className="touch-target rounded-md border border-separator bg-sunken py-space-3 text-subhead font-semibold text-ink"
                  >
                    {part}
                  </button>
                ))}
              </div>
            </form>
          )}

          <h2 className="text-headline font-semibold text-ink">今天的训练</h2>

          {empty ? (
            <p className="rounded-xl bg-card p-space-6 text-subhead text-ink-3">
              今天还没有记录。练完点上面那两张卡记一下 —— 记一次之后，这一周的节奏才看得出来。
            </p>
          ) : (
            <ul className="flex flex-col gap-space-2">
              {cardio.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-space-3 rounded-xl bg-card p-space-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{row.activityName}</span>
                    <span className="tabular mt-0.5 block text-footnote text-ink-3">
                      {row.minutes} 分钟 · {INTENSITY_LABEL[row.intensity]}
                      {row.distanceKm !== null && ` · ${row.distanceKm} 公里`}
                    </span>
                  </span>
                  <form action={deleteCardio}>
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      aria-label={`删除 ${row.activityName}`}
                      className="touch-target flex h-11 w-11 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                    >
                      ✕
                    </button>
                  </form>
                </li>
              ))}

              {strength.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center gap-space-3 rounded-xl bg-card p-space-4"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{row.exerciseName}</span>
                    <span className="tabular mt-0.5 block text-footnote text-ink-3">
                      {row.part} · {row.sets} 组 × {row.reps} 次
                      {row.weightKg !== null && ` · ${row.weightKg} kg`}
                    </span>
                  </span>
                  <form action={deleteStrength}>
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      aria-label={`删除 ${row.exerciseName}`}
                      className="touch-target flex h-11 w-11 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-sunken hover:text-ink"
                    >
                      ✕
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 最近 7 天 + 动作库入口 */}
        <section className="flex flex-col gap-space-3 rounded-xl bg-card p-space-5">
          <h2 className="text-headline font-semibold text-ink">最近 {RECENT_DAYS} 天</h2>
          <p className="tabular text-subhead text-ink-2">
            有氧 {weekCardio} 分钟 · 无氧 {weekSets} 组 · 练了 {weekDays} 天
          </p>
          <Link
            href="/fitness/exercises"
            className="touch-target mt-space-1 inline-flex items-center gap-1 self-start text-subhead font-medium text-brand-text hover:underline"
          >
            看看动作库 →
          </Link>
        </section>
      </main>
    </>
  );
}
