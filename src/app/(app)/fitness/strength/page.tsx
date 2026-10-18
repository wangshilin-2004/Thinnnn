import type { Metadata } from 'next';
import Link from 'next/link';

import { MuscleMap } from '@/components/muscle-map';
import { SiteHeader } from '@/components/site-header';
import { BODY_PARTS, exercisesOfPart, type BodyPart } from '@/content/exercises';
import { requireUser } from '@/lib/auth';
import { formatCnDate, isDateString } from '@/lib/calendar';
import { todayInTimezone } from '@/lib/nutrition';
import { logStrength } from '../actions';

export const metadata: Metadata = { title: '记无氧' };

export const dynamic = 'force-dynamic';

/* 四个部位的选择做成 URL 参数而不是客户端状态。
 *
 * 理由：这是一个服务端组件页面，部位切换本质上是「看另一批动作」——
 * 用 ?part=背 让浏览器负责这件事，比引入一个 useState 再加一整套
 * 条件渲染简单，而且刷完新页面对应部位还在、能分享、能后退。
 * 代价是切部位会整页重新请求，但那一次请求是 ~100KB 的 RSC payload
 * 加一堆复用的图片缓存，比这更重要的事情多得是。 */
export default async function StrengthPage({
  searchParams,
}: {
  searchParams: Promise<{ part?: string; date?: string; error?: string }>;
}) {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);
  const { part: rawPart, date, error } = await searchParams;

  const part: BodyPart = BODY_PARTS.includes(rawPart as BodyPart)
    ? (rawPart as BodyPart)
    : '胸';
  const logDate = date && isDateString(date) && date <= today ? date : today;
  const exercises = exercisesOfPart(part);

  return (
    <>
      <SiteHeader />
      <main className="content-max flex flex-col gap-6 py-6 pb-safe-nav sm:gap-8 sm:py-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/fitness"
            className="touch-target -my-1 inline-flex items-center gap-1 self-start text-footnote text-ink-3 hover:text-ink"
          >
            <span aria-hidden>‹</span> 训练
          </Link>
          <div className="flex flex-col gap-1">
            <p className="text-subhead text-ink-3">{formatCnDate(logDate)}</p>
            <h1 className="text-title-1 font-semibold tracking-title text-ink">记无氧</h1>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-space-4 py-space-3 text-subhead text-accent-red"
          >
            没记上 —— 检查一下组数、次数和重量，重量留空表示自重。
          </p>
        )}

        {/* 部位切换。做成链接而不是 tab 组件：它改变的是「这一页取哪批数据」，
            这正是 URL 该负责的事。aria-current 让读屏用户知道当前在哪个部位。 */}
        <nav aria-label="选择部位" className="flex gap-space-2">
          {BODY_PARTS.map((item) => {
            const active = item === part;
            return (
              <Link
                key={item}
                href={`/fitness/strength?part=${encodeURIComponent(item)}&date=${logDate}`}
                aria-current={active ? 'page' : undefined}
                className={`touch-target flex-1 rounded-lg border px-space-3 py-space-3 text-center text-body font-medium transition-colors ${
                  active
                    ? 'border-brand bg-brand/10 text-brand-text'
                    : 'border-hairline bg-card text-ink-2 hover:bg-raised'
                }`}
              >
                {item}
              </Link>
            );
          })}
        </nav>

        <form action={logStrength} className="flex flex-col gap-space-6">
          <input type="hidden" name="logDate" value={logDate} />
          {/* part 一起提交：服务端删改完要能回到同一个部位，否则用户记完「背」
              的第三个动作就被弹回「胸」，还得再点一次。 */}
          <input type="hidden" name="part" value={part} />

          <fieldset className="flex flex-col gap-space-3">
            <legend className="mb-space-1 text-headline font-semibold text-ink">
              练了哪个动作
            </legend>
            <div className="flex flex-col gap-space-2">
              {exercises.map((exercise) => (
                <label key={exercise.id} className="relative block">
                  <input
                    type="radio"
                    name="exerciseId"
                    value={exercise.id}
                    required
                    className="peer sr-only"
                  />
                  <span className="flex touch-target items-center gap-space-3 rounded-lg border border-hairline bg-card px-space-3 py-space-2 transition-colors peer-checked:border-brand peer-checked:bg-brand/10 peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas">
                    {/* 人体图直接放进选择项里：选动作时最想知道的就是「这个练哪儿」，
                        让用户为了看一张图再跳去动作库，等于逼他多走一步。 */}
                    <MuscleMap
                      muscles={exercise.muscles}
                      secondary={exercise.secondary}
                      width={30}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      {/* 同上：颜色交给外层 span 的 peer-checked，内层不写死 */}
                      <span className="text-body font-medium">{exercise.name}</span>
                      <span className="truncate text-caption-1 text-ink-3">
                        {exercise.equipment} · {exercise.primary.join('、')}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-3 gap-space-3">
            <div className="flex flex-col gap-space-2">
              <label htmlFor="sets" className="text-footnote font-medium text-ink-2">
                组数
              </label>
              <input
                id="sets"
                name="sets"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                step={1}
                required
                defaultValue={4}
                className="tabular w-full rounded-lg border border-hairline bg-card px-space-3 py-space-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
            <div className="flex flex-col gap-space-2">
              <label htmlFor="reps" className="text-footnote font-medium text-ink-2">
                每组次数
              </label>
              <input
                id="reps"
                name="reps"
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                step={1}
                required
                defaultValue={8}
                className="tabular w-full rounded-lg border border-hairline bg-card px-space-3 py-space-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
            <div className="flex flex-col gap-space-2">
              <label htmlFor="weightKg" className="text-footnote font-medium text-ink-2">
                重量(kg)
              </label>
              <input
                id="weightKg"
                name="weightKg"
                type="number"
                inputMode="decimal"
                min={0}
                max={1000}
                step={0.5}
                placeholder="自重"
                className="tabular w-full rounded-lg border border-hairline bg-card px-space-3 py-space-3 text-body text-ink placeholder:text-ink-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
            </div>
          </div>
          <p className="-mt-space-3 text-caption-1 text-ink-3">
            重量留空 = 自重动作（俯卧撑、引体向上这类）。不确定就留空，别为了填满格子随便写个数。
          </p>

          <button
            type="submit"
            className="touch-target inline-flex h-12 items-center justify-center rounded-lg bg-brand px-space-6 text-body font-semibold text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            记下这个动作
          </button>
        </form>

        <Link
          href="/fitness/exercises"
          className="touch-target inline-flex items-center gap-1 self-start text-subhead font-medium text-brand-text hover:underline"
        >
          看动作要领和示意图 →
        </Link>
      </main>
    </>
  );
}
