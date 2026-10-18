import type { Metadata } from 'next';
import Link from 'next/link';

import { ExerciseAnim } from '@/components/exercise-anim';
import { MuscleMap } from '@/components/muscle-map';
import { SiteHeader } from '@/components/site-header';
import {
  BODY_PARTS,
  CARDIO_ACTIVITIES,
  EXERCISES,
  demoSearchUrl,
  exercisesOfPart,
  type BodyPart,
} from '@/content/exercises';

export const metadata: Metadata = { title: '动作库' };

/* 本来想写 `force-static` 把这一页预渲染掉（内容是固定的，没有任何用户数据），
 * 但试过之后不行：这一页的类别切换靠 ?tab= 查询参数，而 force-static 下
 * searchParams 在构建时就被求值成空对象——上线后每个 tab 都会渲染成默认的「胸」。
 * 保留动态渲染。真要省这一次渲染，得把 tab 做成路径段（/fitness/exercises/胸）
 * 再配 generateStaticParams，那是另一个量级的改动，不值得。 */

/** 顶部切换：有氧排在最前，因为「今天跑还是练」比「练哪块」更早决定。 */
const TABS = [{ key: 'cardio', label: '有氧' } as const,
  ...BODY_PARTS.map((part) => ({ key: part, label: part }) as const),
];

export default async function ExercisesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.key === tab)?.key ?? '胸';
  const isCardio = active === 'cardio';

  const exercises = isCardio ? [] : exercisesOfPart(active as BodyPart);
  const count = isCardio ? CARDIO_ACTIVITIES.length : exercises.length;

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
            <p className="text-subhead text-ink-3">
              {count} 个动作 · 动画来自 exercises-gifs（MIT）
            </p>
            <h1 className="text-title-1 font-semibold tracking-title text-ink">动作库</h1>
          </div>
        </header>

        <nav aria-label="选择类别" className="flex gap-space-2 overflow-x-auto">
          {TABS.map((item) => {
            const isActive = item.key === active;
            return (
              <Link
                key={item.key}
                href={`/fitness/exercises?tab=${encodeURIComponent(item.key)}`}
                aria-current={isActive ? 'page' : undefined}
                className={`touch-target shrink-0 rounded-lg border px-space-4 py-space-2 text-center text-subhead font-medium transition-colors ${
                  isActive
                    ? 'border-brand bg-brand/10 text-brand-text'
                    : 'border-hairline bg-card text-ink-2 hover:bg-raised'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* 图例。没有它的话，图上亮起来的红色只是一个好看的色块 ——
            用户得自己猜到「亮红是主要、浅红是次要」。 */}
        <p className="flex items-center gap-2 text-caption-1 text-ink-3">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#ff453a]" aria-hidden />
          红色 = 这个动作练到的肌肉
        </p>

        <ul className="grid grid-cols-1 gap-space-4 sm:grid-cols-2">
          {isCardio
            ? CARDIO_ACTIVITIES.map((activity) => (
                <li key={activity.id}>
                  <article className="flex flex-col gap-space-3 rounded-xl bg-card p-space-4">
                    <ExerciseAnim id={activity.id} name={activity.name} hasLoop={activity.hasLoop !== false} />
                    <div className="flex flex-col gap-0.5">
                      <h2 className="text-headline font-semibold text-ink">
                        {activity.name}
                      </h2>
                      <p className="text-caption-1 text-ink-3">
                        {activity.en} · {activity.level}
                      </p>
                    </div>
                    <ul className="flex flex-col gap-1 text-footnote text-ink-2">
                      <li>做对：{activity.tips[0]}</li>
                      <li>别这样：{activity.tips[1]}</li>
                      <li>
                        <a
                          href={demoSearchUrl(activity.name)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-caption-1 font-semibold text-brand-text underline-offset-2 hover:underline"
                        >
                          看真人示范 ↗
                        </a>
                      </li>
                    </ul>
                  </article>
                </li>
              ))
            : exercises.map((exercise) => (
                <li key={exercise.id}>
                  <article className="flex flex-col gap-space-3 rounded-xl bg-card p-space-4">
                    <ExerciseAnim id={exercise.id} name={exercise.name} />
                    <div className="flex items-start justify-between gap-space-3">
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <h2 className="text-headline font-semibold text-ink">
                          {exercise.name}
                        </h2>
                        <p className="text-caption-1 text-ink-3">
                          {exercise.equipment} · {exercise.level}
                        </p>
                        <p className="text-caption-1 text-ink-2">
                          {exercise.primary.join('、')}
                        </p>
                      </div>
                      <MuscleMap
                        muscles={exercise.muscles}
                        secondary={exercise.secondary}
                        width={38}
                      />
                    </div>
                    <ul className="flex flex-col gap-1 text-footnote text-ink-2">
                      <li>做对：{exercise.tips[0]}</li>
                      <li>别这样：{exercise.tips[1]}</li>
                      <li>
                        <a
                          href={demoSearchUrl(exercise.name)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="inline-flex items-center gap-1 text-caption-1 font-semibold text-brand-text underline-offset-2 hover:underline"
                        >
                          看真人示范 ↗
                        </a>
                      </li>
                    </ul>
                  </article>
                </li>
              ))}
        </ul>

        <p className="text-caption-1 text-ink-4">
          共 {EXERCISES.length} 个无氧动作、{CARDIO_ACTIVITIES.length} 项有氧。
          上面是示意图（插画风格，标红的是这块肌肉在发力），不是真人视频。
          「看真人示范」跳到 B 站的搜索结果 —— 真人视频的质量和讲解因人而异，
          挑一个你看得懂的就行。
        </p>
      </main>
    </>
  );
}
