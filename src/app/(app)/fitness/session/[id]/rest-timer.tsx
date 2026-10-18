'use client';

import { useEffect, useState } from 'react';

/* 组间计时。
 *
 * 为什么用 key 强制重挂载而不是「更新 seconds 并重置」：
 * 每完成一组，服务端会把新的 restSeconds 传下来，但我们希望计时器
 * 从满格重新开始 —— 组件内部状态和外部的「现在该歇多久」不是一回事，
 * 靠 key 变化重挂载比在 effect 里比对 prop 再 setState 干净得多，
 * 也避免「父组件每次渲染都重置计时」的经典 bug。 */
export function RestTimer({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    if (skipped) return;
    const t = setInterval(() => {
      setLeft((v) => (v <= 1 ? 0 : v - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [skipped]);

  const m = Math.floor(left / 60);
  const s = left % 60;
  const done = left === 0;

  return (
    <div
      role="timer"
      aria-live="off"
      className={`mt-space-3 flex items-center justify-between rounded-md border px-space-4 py-space-3 ${
        done ? 'border-brand/40 bg-brand/10' : 'border-separator bg-sunken'
      }`}
    >
      <div className="flex items-baseline gap-space-2">
        <span className="text-footnote text-ink-3">{done ? '歇好了，继续下一组' : '组间休息'}</span>
        <span className="tabular text-title-3 font-semibold text-ink">
          {m}:{String(s).padStart(2, '0')}
        </span>
      </div>
      <button
        type="button"
        onClick={() => setSkipped(true)}
        className="touch-target rounded-md border border-separator px-space-3 text-footnote text-ink-2"
      >
        {done || skipped ? '收起' : '不歇了'}
      </button>
    </div>
  );
}
