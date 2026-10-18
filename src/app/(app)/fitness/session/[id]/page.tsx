import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSessionDetail } from '@/db/queries';
import { requireUser } from '@/lib/auth';
import { EXERCISES, findExercise } from '@/content/exercises';
import { MuscleMap } from '@/components/muscle-map';
import { formatCnDate } from '@/lib/calendar';

import {
  addSessionExercise,
  cancelSession,
  finishSession,
  finishSet,
  removeSessionExercise,
} from '../../actions';
import { RestTimer } from './rest-timer';

// 静态标题：同一页既可能是「训练中」也可能是「练完了」，写死其中一个都会骗人
export const metadata = { title: '训练' };

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ rest?: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;
  const { rest } = await searchParams;

  const session = await getSessionDetail(user.id, id);
  if (!session) notFound();
  if (session.finishedAt) return <SessionSummary session={session} />;

  const doneSets = session.exercises.reduce(
    (n, ex) => n + ex.sets.filter((s) => s.finishedAt).length,
    0,
  );
  const doneExercises = session.exercises.filter((ex) =>
    ex.sets.some((s) => s.finishedAt),
  ).length;

  // 休息计时：刚提交完的那一组属于哪个动作，就用那个动作的组间时长
  const resting = rest ? session.exercises.find((ex) => ex.id === rest) : undefined;

  // 推荐顺序：本部位在前，其余在后 —— 练腿的人不该先去翻胸的动作
  const pickable = [
    ...EXERCISES.filter((e) => e.part === session.part),
    ...EXERCISES.filter((e) => e.part !== session.part),
  ];

  return (
    <div className="pb-safe-nav mx-auto w-full max-w-[980px] px-4 py-6">
      <Link href="/fitness" className="text-footnote text-ink-3">
        ‹ 训练
      </Link>

      <p className="mt-space-4 text-footnote text-ink-3">{formatCnDate(session.logDate)}</p>
      <h1 className="text-title-1 font-semibold text-ink">{session.part} · 训练中</h1>
      <p className="mt-space-2 text-subhead text-ink-3">
        已完成 {doneExercises}/{session.exercises.length} 个动作 · {doneSets} 组
      </p>
      <p className="mt-space-1 text-footnote text-ink-4">
        {/* 服务端组件，一次请求渲染一次；「已练多久」本来就取决于「现在」，
            所以这里用 Date.now() 是有意的，不是渲染不纯。 */}
        {/* eslint-disable-next-line react-hooks/purity */}
        已练 {Math.max(1, Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000))} 分钟
      </p>

      {resting && <RestTimer key={`${rest}-${doneSets}`} seconds={resting.restSeconds} />}

      <div className="mt-space-6 space-y-space-4">
        {session.exercises.map((ex) => {
          const meta = findExercise(ex.exerciseId);
          const done = ex.sets.filter((s) => s.finishedAt).length;
          const complete = done >= ex.targetSets;
          return (
            <section key={ex.id} className="glass rounded-md p-space-4">
              <div className="flex items-start justify-between gap-space-3">
                <div className="min-w-0">
                  <h2 className="text-headline font-semibold text-ink">{ex.exerciseName}</h2>
                  <p className="mt-space-1 text-footnote text-ink-3">
                    {ex.targetSets} 组 × {ex.targetReps} 次 · 组间 {ex.restSeconds} 秒
                    {done > 0 && ` · 已完成 ${done} 组`}
                  </p>
                </div>
                {meta && <MuscleMap muscles={meta.muscles} secondary={meta.secondary} width={30} />}
              </div>

              <ul className="mt-space-3 space-y-space-2">
                {Array.from({ length: ex.targetSets }, (_, i) => {
                  const setNo = i + 1;
                  const record = ex.sets.find((s) => s.setIndex === setNo && s.finishedAt);
                  return (
                    <li key={setNo}>
                      {record ? (
                        <div className="flex items-center justify-between rounded-md bg-sunken px-space-3 py-space-2">
                          <span className="text-subhead text-ink-2">第 {setNo} 组</span>
                          <span className="tabular text-subhead text-ink">
                            {record.weightKg ? `${record.weightKg} kg × ` : '自重 × '}
                            {record.reps ?? ex.targetReps} 次
                          </span>
                        </div>
                      ) : (
                        <form
                          action={finishSet}
                          className="flex items-center gap-space-2 rounded-md border border-separator px-space-3 py-space-2"
                        >
                          <input type="hidden" name="sessionId" value={session.id} />
                          <input type="hidden" name="exerciseRowId" value={ex.id} />
                          <input type="hidden" name="setIndex" value={setNo} />
                          <span className="text-subhead text-ink-2">第 {setNo} 组</span>
                          <input
                            name="weightKg"
                            inputMode="decimal"
                            placeholder="重量"
                            className="tabular ml-auto w-16 rounded-md bg-sunken px-2 py-1 text-right text-subhead text-ink outline-none"
                          />
                          <span className="text-footnote text-ink-4">kg ×</span>
                          <input
                            name="reps"
                            inputMode="numeric"
                            defaultValue={ex.targetReps}
                            className="tabular w-12 rounded-md bg-sunken px-2 py-1 text-right text-subhead text-ink outline-none"
                          />
                          <button
                            type="submit"
                            className="touch-target rounded-md bg-brand px-space-3 text-footnote font-semibold text-on-accent"
                          >
                            完成
                          </button>
                        </form>
                      )}
                    </li>
                  );
                })}
              </ul>

              {complete && <p className="mt-space-2 text-caption-1 text-brand-text">这个动作做完了 ✓</p>}

              <form action={removeSessionExercise} className="mt-space-2">
                <input type="hidden" name="sessionId" value={session.id} />
                <input type="hidden" name="exerciseRowId" value={ex.id} />
                <button type="submit" className="text-caption-1 text-ink-4">
                  移出这个动作
                </button>
              </form>
            </section>
          );
        })}
      </div>

      {session.exercises.length === 0 && (
        <p className="mt-space-6 rounded-md bg-sunken p-space-4 text-subhead text-ink-2">
          还没排动作。下面挑一个加进来，就可以开练了。
        </p>
      )}

      <form action={addSessionExercise} className="glass mt-space-6 rounded-md p-space-4">
        <h2 className="text-headline font-semibold text-ink">加一个动作</h2>
        <input type="hidden" name="sessionId" value={session.id} />
        <div className="mt-space-3 grid grid-cols-2 gap-space-2">
          <label className="col-span-2 text-footnote text-ink-3">
            动作
            <select
              name="exerciseId"
              className="mt-space-1 w-full rounded-md bg-sunken px-space-3 py-space-2 text-subhead text-ink"
            >
              {pickable.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}（{e.part}）
                </option>
              ))}
            </select>
          </label>
          <label className="text-footnote text-ink-3">
            组数
            <input
              name="targetSets"
              type="number"
              min={1}
              max={20}
              defaultValue={4}
              className="tabular mt-space-1 w-full rounded-md bg-sunken px-space-3 py-space-2 text-subhead text-ink"
            />
          </label>
          <label className="text-footnote text-ink-3">
            每组次数
            <input
              name="targetReps"
              type="number"
              min={1}
              max={100}
              defaultValue={8}
              className="tabular mt-space-1 w-full rounded-md bg-sunken px-space-3 py-space-2 text-subhead text-ink"
            />
          </label>
          <label className="col-span-2 text-footnote text-ink-3">
            组间休息（秒）
            <input
              name="restSeconds"
              type="number"
              min={15}
              max={900}
              defaultValue={120}
              className="tabular mt-space-1 w-full rounded-md bg-sunken px-space-3 py-space-2 text-subhead text-ink"
            />
          </label>
        </div>
        <button
          type="submit"
          className="touch-target mt-space-3 w-full rounded-md bg-raised py-space-3 text-subhead font-semibold text-ink"
        >
          加进今天的训练
        </button>
      </form>

      <div className="mt-space-6 flex gap-space-3">
        <form action={finishSession} className="flex-1">
          <input type="hidden" name="sessionId" value={session.id} />
          <button
            type="submit"
            className="touch-target w-full rounded-md bg-brand py-space-3 text-headline font-semibold text-on-accent"
          >
            练完了
          </button>
        </form>
        <form action={cancelSession}>
          <input type="hidden" name="sessionId" value={session.id} />
          <button
            type="submit"
            className="touch-target rounded-md border border-separator px-space-4 py-space-3 text-subhead text-ink-2"
          >
            放弃
          </button>
        </form>
      </div>
    </div>
  );
}

/* 练完之后的回顾。
 *
 * 和数据的关系：这次训练的「结果」在结束时已经折成 strength_entries 了，
 * 所以这一页纯粹是回看，不写任何东西 —— 也因此不需要表单和确认，
 * 打开就能关掉。 */
function SessionSummary({ session }: { session: NonNullable<Awaited<ReturnType<typeof getSessionDetail>>> }) {
  const started = new Date(session.startedAt).getTime();
  const ended = new Date(session.finishedAt as string).getTime();
  const minutes = Math.max(1, Math.round((ended - started) / 60000));

  const rows = session.exercises
    .map((ex) => {
      const done = ex.sets.filter((s) => s.finishedAt);
      const volume = done.reduce((sum, s) => sum + (s.weightKg ?? 0) * (s.reps ?? 0), 0);
      const best = done.reduce<null | { weight: number; reps: number }>((acc, s) => {
        const w = s.weightKg ?? 0;
        if (!acc || w > acc.weight) return { weight: w, reps: s.reps ?? ex.targetReps };
        return acc;
      }, null);
      return { ex, done: done.length, volume, best };
    })
    .filter((r) => r.done > 0);

  const totalSets = rows.reduce((n, r) => n + r.done, 0);
  const totalVolume = rows.reduce((n, r) => n + r.volume, 0);

  return (
    <div className="pb-safe-nav mx-auto w-full max-w-[980px] px-4 py-6">
      <Link href="/fitness" className="text-footnote text-ink-3">
        ‹ 训练
      </Link>

      <p className="mt-space-4 text-footnote text-ink-3">{formatCnDate(session.logDate)}</p>
      <h1 className="text-title-1 font-semibold text-ink">{session.part} · 练完了</h1>

      <div className="glass mt-space-5 grid grid-cols-3 gap-space-2 rounded-md p-space-4 text-center">
        {[
          { label: '时长', value: `${minutes} 分钟` },
          { label: '总组数', value: `${totalSets} 组` },
          // 自重组装时容量恒为 0，直接写 0 kg 看着像算错了
          { label: '总容量', value: totalVolume > 0 ? `${Math.round(totalVolume)} kg` : '自重' },
        ].map((item) => (
          <div key={item.label}>
            <p className="text-caption-1 text-ink-3">{item.label}</p>
            <p className="tabular mt-space-1 text-headline font-semibold text-ink">{item.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-space-5 space-y-space-3">
        {rows.map(({ ex, done, volume, best }) => (
          <section key={ex.id} className="glass rounded-md p-space-4">
            <div className="flex items-start justify-between gap-space-3">
              <div className="min-w-0">
                <h2 className="text-headline font-semibold text-ink">{ex.exerciseName}</h2>
                <p className="mt-space-1 text-footnote text-ink-3">
                  {done} 组
                  {best && best.weight > 0 && ` · 最好 ${best.weight} kg × ${best.reps} 次`}
                  {volume > 0 && ` · 容量 ${Math.round(volume)} kg`}
                </p>
              </div>
              {(() => {
                const meta = findExercise(ex.exerciseId);
                return meta ? (
                  <MuscleMap muscles={meta.muscles} secondary={meta.secondary} width={30} />
                ) : null;
              })()}
            </div>
            <ul className="mt-space-2 flex flex-wrap gap-space-2">
              {ex.sets
                .filter((s) => s.finishedAt)
                .map((s) => (
                  <li
                    key={s.id}
                    className="tabular rounded-md bg-sunken px-space-2 py-1 text-footnote text-ink-2"
                  >
                    {s.weightKg ? `${s.weightKg} kg` : '自重'} × {s.reps ?? ex.targetReps}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>

      {rows.length === 0 && (
        <p className="mt-space-5 rounded-md bg-sunken p-space-4 text-subhead text-ink-2">
          这次一组都没做完，所以没有写进训练记录。
        </p>
      )}

      <div className="mt-space-6 grid grid-cols-2 gap-space-3">
        <Link
          href="/fitness"
          className="touch-target flex items-center justify-center rounded-md bg-brand py-space-3 text-headline font-semibold text-on-accent"
        >
          回训练页
        </Link>
        <Link
          href="/history"
          className="touch-target flex items-center justify-center rounded-md border border-separator py-space-3 text-subhead text-ink-2"
        >
          看回顾
        </Link>
      </div>
    </div>
  );
}
