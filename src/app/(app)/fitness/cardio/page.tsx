import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteHeader } from '@/components/site-header';
import { CARDIO_ACTIVITIES } from '@/content/exercises';
import { requireUser } from '@/lib/auth';
import { formatCnDate, isDateString } from '@/lib/calendar';
import { todayInTimezone } from '@/lib/nutrition';
import { logCardio } from '../actions';

export const metadata: Metadata = { title: '记有氧' };

export const dynamic = 'force-dynamic';

/* 强度三档的文案。
 *
 * 不用「低/中/高强度」：站在跑步机上的人心里想的是「我现在能不能说话」，
 * 不是「我的心率在哪个区间百分比」。用自感用力程度（RPE 的通俗版）
 * 反而是能当场判断的。 */
const INTENSITIES = [
  { value: 'easy', label: '轻松', hint: '能正常聊天' },
  { value: 'moderate', label: '适中', hint: '说话有点喘' },
  { value: 'hard', label: '吃力', hint: '说不出整句' },
] as const;

export default async function CardioPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; error?: string }>;
}) {
  const user = await requireUser();
  const today = todayInTimezone(user.timezone);
  const { date, error } = await searchParams;

  /* 和 /log/meal 一样：非法或未来的日期都回落到今天，不报错页。
   * 手改 URL 是极边缘的操作，为它弹一个 404 反而像站坏了。 */
  const logDate = date && isDateString(date) && date <= today ? date : today;

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
            <h1 className="text-title-1 font-semibold tracking-title text-ink">记有氧</h1>
          </div>
        </header>

        {error && (
          <p
            role="alert"
            className="rounded-xl border border-accent-red/40 bg-accent-red/10 px-space-4 py-space-3 text-subhead text-accent-red"
          >
            没记上 —— 检查一下时长和距离，时长要在 1 到 600 分钟之间。
          </p>
        )}

        <form action={logCardio} className="flex flex-col gap-space-6">
          <input type="hidden" name="logDate" value={logDate} />

          {/* 项目：两列网格。10 个项目用一列会拉出很长一屏，
              用三列在 320px 上每个只有 90px 宽，「爬楼机」三个字就换行了。 */}
          <fieldset className="flex flex-col gap-space-3">
            <legend className="mb-space-1 text-headline font-semibold text-ink">
              练了什么
            </legend>
            <div className="grid grid-cols-2 gap-space-2">
              {CARDIO_ACTIVITIES.map((activity, index) => (
                <label key={activity.id} className="relative block">
                  <input
                    type="radio"
                    name="activityId"
                    value={activity.id}
                    required
                    defaultChecked={index === 0}
                    className="peer sr-only"
                  />
                  <span className="flex touch-target flex-col gap-0.5 rounded-lg border border-hairline bg-card p-space-3 text-body text-ink transition-colors peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:text-brand-text peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas">
                    <span className="font-medium">{activity.name}</span>
                    <span className="text-caption-1 text-ink-3">{activity.level}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-space-3">
            <label htmlFor="minutes" className="text-headline font-semibold text-ink">
              练了多久
            </label>
            <div className="flex items-center gap-space-3">
              <input
                id="minutes"
                name="minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={600}
                step={1}
                required
                defaultValue={30}
                className="tabular w-24 rounded-lg border border-hairline bg-card px-space-4 py-space-3 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="text-subhead text-ink-3">分钟</span>
            </div>
          </div>

          <fieldset className="flex flex-col gap-space-3">
            <legend className="mb-space-1 text-headline font-semibold text-ink">强度</legend>
            <div className="grid grid-cols-3 gap-space-2">
              {INTENSITIES.map((item, index) => (
                <label key={item.value} className="relative block">
                  <input
                    type="radio"
                    name="intensity"
                    value={item.value}
                    required
                    defaultChecked={index === 1}
                    className="peer sr-only"
                  />
                  <span className="flex touch-target flex-col items-center gap-0.5 rounded-lg border border-hairline bg-card p-space-3 transition-colors peer-checked:border-brand peer-checked:bg-brand/10 peer-checked:text-brand-text peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-canvas">
                    {/* 颜色不写在这里：外层的 span 已经在选中时把颜色改成 brand 了，
                        内层再写死一个 text-ink 会把它盖掉（peer-checked 只对
                        兄弟节点生效，内层 span 不是 input 的兄弟节点）。 */}
                    <span className="text-body font-medium">{item.label}</span>
                    <span className="text-caption-1 text-ink-3">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-space-3">
            <label htmlFor="distanceKm" className="text-headline font-semibold text-ink">
              距离
              <span className="ml-space-2 text-caption-1 font-normal text-ink-3">
                不知道就留空
              </span>
            </label>
            <div className="flex items-center gap-space-3">
              <input
                id="distanceKm"
                name="distanceKm"
                type="number"
                inputMode="decimal"
                min={0}
                max={500}
                step={0.1}
                placeholder="不填也行"
                className="tabular w-32 rounded-lg border border-hairline bg-card px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              />
              <span className="text-subhead text-ink-3">公里</span>
            </div>
          </div>

          <button
            type="submit"
            className="touch-target inline-flex h-12 items-center justify-center rounded-lg bg-brand px-space-6 text-body font-semibold text-on-accent transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            记下这次有氧
          </button>
        </form>
      </main>
    </>
  );
}
