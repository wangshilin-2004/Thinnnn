'use client';

import { useRef, useState, useTransition } from 'react';

import { logWeight } from '@/app/(app)/log/weight/actions';

/* 记录今天体重的输入条。
 *
 * 为什么不做成独立页面：体重就是一个数，为它跳转一次页面是纯粹的摩擦。
 * 而「录入摩擦」是这个产品调研下来最主要的流失原因 —— 记一餐之所以是整屏，
 * 是因为要检索食物库、选份量；体重没有这些，所以它就该是一个内联输入框。
 *
 * 为什么是客户端组件：输入框要有本地状态（正在输入的值、展开/收起、错误提示），
 * 而且提交后要立刻切回「已记录」的形态，不能等整页重新渲染。
 */
export function WeightLogger({ todayKg }: { todayKg: number | null }) {
  const [isPending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* 默认收起：已经记过就只显示数字，没记过就直接展开输入框。
   * 前者是「今天的事已经做完了」，再摆一个输入框是噪音；
   * 后者是唯一的待办，应该一眼看见。 */
  const showInput = editing || todayKg === null;

  function submit() {
    setError(null);
    /* 空字符串会被 Number('') 变成 0，正好落进 action 的下限校验里报错，
     * 所以这里不用额外判空。 */
    const kg = Number(value);

    startTransition(async () => {
      const res = await logWeight({ kg });
      if (res.ok) {
        setEditing(false);
        setValue('');
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption-1 text-ink-3">今天的体重</span>

        {showInput ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              /* type="text" + inputMode="decimal" 而不是 type="number"：
               * number 类型在桌面端带上下箭头、在部分安卓输入法里允许输入 'e'，
               * 而且会按浏览器区域设置接受逗号小数点，校验反而更麻烦。
               * inputMode 只负责在手机上弹出数字键盘。 */
              type="text"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
              placeholder={todayKg === null ? '比如 68.5' : todayKg.toFixed(1)}
              aria-label="今天的体重，单位公斤"
              autoComplete="off"
              enterKeyHint="done"
              disabled={isPending}
              className="tabular w-24 rounded-md border border-hairline bg-card px-3 py-2 text-right text-body text-ink placeholder:text-ink-3 focus:border-separator-opaque focus:outline-none disabled:opacity-50"
            />
            <span className="text-footnote text-ink-3">kg</span>
            <button
              type="button"
              onClick={submit}
              disabled={isPending}
              className="inline-flex h-11 items-center rounded-full bg-brand px-4 text-subhead font-semibold text-on-accent disabled:opacity-50"
            >
              {isPending ? '记录中' : '记录'}
            </button>
            {/* 已经记过、用户主动点开修改时才给「取消」——没记过的时候
                没有「取消」的语义，收起输入框等于今天不记了，不该有这个按钮。 */}
            {todayKg !== null && (
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setValue('');
                  setError(null);
                }}
                className="touch-target text-footnote text-ink-3 hover:text-ink"
              >
                取消
              </button>
            )}
          </div>
        ) : (
          <div className="flex items-baseline gap-3">
            <span className="tabular text-title-3 font-semibold tracking-title text-ink">
              {todayKg.toFixed(1)}
              <span className="ml-0.5 text-footnote font-normal text-ink-3">kg</span>
            </span>
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                /* 预填当前值而不是留空：多数情况是「小数点记错了」这种微调，
                 * 让用户在此基础上改比重新输一遍快。 */
                setValue(todayKg.toFixed(1));
                /* 下一帧再聚焦：此刻输入框还没挂载，直接 focus 会拿到 null。
                 * 用 requestAnimationFrame 而不是 setTimeout，是为了跟渲染节奏对齐。 */
                requestAnimationFrame(() => inputRef.current?.select());
              }}
              className="touch-target text-footnote text-accent-blue hover:underline"
            >
              改
            </button>
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="text-right text-footnote text-accent-red">
          {error}
        </p>
      )}
    </div>
  );
}
