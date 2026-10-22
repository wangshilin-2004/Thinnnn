'use client';

import { useState } from 'react';

import { addWater, deleteWater, setWaterGoal, undoLastWater } from '@/app/(app)/log/water/actions';
import { formatWater, QUICK_ADDS, waterPercent, waterRemainingMl } from '@/lib/water';

/* 喝水卡片。
 *
 * 交互取「一键为主、输入为辅」：日常动作是「喝了一杯 → 点一下」，
 * 精确到毫升是少数场景（比如按医生要求）。所以两个快捷按钮
 * （250 mL 一杯 / 500 mL 一瓶）比输入框更显眼。
 *
 * 为什么有「撤销最后一次」：点错按钮比「想改历史」常见得多。
 * 单独删除留给更早的错误。
 */

export type WaterCardProps = {
  totalMl: number;
  goalMl: number;
  entries: { id: string; amountMl: number; time: string }[];
};

const timeFormat = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Shanghai',
});

export function WaterCard({ totalMl, goalMl, entries }: WaterCardProps) {
  const [showDetail, setShowDetail] = useState(false);
  const percent = waterPercent(totalMl, goalMl);
  const remaining = waterRemainingMl(totalMl, goalMl);

  return (
    <section className="flex flex-col gap-space-3 rounded-xl border border-hairline bg-card p-space-5">
      <div className="flex items-baseline justify-between gap-space-3">
        <h2 className="text-headline font-semibold text-ink">喝水</h2>
        <span className="text-footnote text-ink-3">
          目标 {formatWater(goalMl)}
          {remaining > 0 ? ` · 还差 ${formatWater(remaining)}` : ' · 喝够了'}
        </span>
      </div>

      <div className="flex items-baseline gap-space-2">
        <span className="text-title-1 font-semibold tabular-nums text-ink">{formatWater(totalMl)}</span>
        <span className="text-footnote text-ink-4">{percent}%</span>
      </div>

      {/* 进度条：用 div 而不是 <progress>，为了和卡片其它元素共用圆角与配色 */}
      <div
        className="h-2 overflow-hidden rounded-full bg-sunken"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="喝水进度"
      >
        <div
          className="h-full rounded-full bg-accent-blue transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-space-2">
        {QUICK_ADDS.map((ml) => (
          <form key={ml} action={addWater}>
            <input type="hidden" name="amountMl" value={ml} />
            <button
              type="submit"
              className="touch-target rounded-md border border-separator bg-sunken px-space-4 py-space-2 text-footnote font-medium text-ink hover:bg-card"
            >
              + {formatWater(ml)}
            </button>
          </form>
        ))}

        <details className="text-footnote text-ink-3">
          <summary className="cursor-pointer select-none">其它量</summary>
          <form action={addWater} className="mt-space-2 flex items-center gap-space-2">
            <input
              name="amountMl"
              type="number"
              inputMode="numeric"
              min={1}
              max={3000}
              placeholder="mL"
              className="w-24 rounded-md border border-separator bg-sunken px-space-3 py-space-2 text-ink"
            />
            <button type="submit" className="touch-target rounded-md border border-separator px-space-3 py-space-2">
              记下
            </button>
          </form>
        </details>

        {entries.length > 0 && (
          <form action={undoLastWater} className="ml-auto">
            <button type="submit" className="text-footnote text-ink-3 hover:text-ink">
              撤销最后一次
            </button>
          </form>
        )}
      </div>

      {entries.length > 0 && (
        <div className="flex flex-col gap-space-1">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="self-start text-footnote text-ink-3 hover:text-ink"
          >
            今天 {entries.length} 次 {showDetail ? '▲' : '▼'}
          </button>
          {showDetail && (
            <ul className="flex flex-col gap-space-1">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between text-footnote text-ink-2">
                  <span className="tabular-nums">
                    {timeFormat.format(new Date(entry.time))} · {formatWater(entry.amountMl)}
                  </span>
                  <form action={deleteWater}>
                    <input type="hidden" name="id" value={entry.id} />
                    <button type="submit" className="text-ink-4 hover:text-ink" aria-label="删除这条记录">
                      删除
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="text-footnote text-ink-3">
        <summary className="cursor-pointer select-none">改目标</summary>
        <form action={setWaterGoal} className="mt-space-2 flex items-center gap-space-2">
          <input
            name="goalMl"
            type="number"
            inputMode="numeric"
            min={500}
            max={6000}
            step={100}
            defaultValue={goalMl}
            className="w-28 rounded-md border border-separator bg-sunken px-space-3 py-space-2 text-ink"
          />
          <span className="text-ink-3">mL / 天</span>
          <button type="submit" className="touch-target rounded-md border border-separator px-space-3 py-space-2">
            保存
          </button>
        </form>
      </details>
    </section>
  );
}
