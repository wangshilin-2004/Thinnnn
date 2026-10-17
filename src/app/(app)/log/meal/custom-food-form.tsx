'use client';

import { useState, useTransition } from 'react';

import type { PickerFood } from '@/db/queries';

import { createCustomFood } from './actions';

/* 自建食物的表单。
 *
 * 这个组件最重要的设计decision不是样式，而是**问什么**：
 *
 *   问「这一份多重、多少大卡」，不问「每 100 克多少大卡」。
 *
 * 因为新手坐在食堂里，他知道的是「我吃了这么一份」，不知道这份每 100 克
 * 多少热量 —— 那是一次除法，而现场每多一个要动脑的格子，记录率就掉一点。
 * 折算成每 100 g 是服务端的事（createCustomFood 里调 toPer100g）。
 *
 * 三大营养素默认折叠。它们决定仪表盘上的营养比例图，但新手常常查不到；
 * 逼着填的结果是干脆不记。展开填了的人，图表会更准。
 *
 * 表单不做「只创建不记录」—— 用户点开它就是因为刚吃了东西，
 * 创建完直接记一份，少一次点击。
 */

/** 输入框统一外观。和搜索框保持一致，避免同一屏里出现两种输入风格。 */
const inputCls =
  'w-full rounded-md border border-hairline bg-card px-3 py-2.5 text-body text-ink ' +
  'placeholder:text-ink-3 focus:border-separator-opaque focus:outline-none';

export function CustomFoodForm({
  onCreated,
  onCancel,
  initialName = '',
}: {
  /** 创建成功后回调。父组件会把它塞进目录并立刻记一份。 */
  onCreated: (food: PickerFood) => void;
  onCancel: () => void;
  /* 从「搜了没搜到」那个按钮进来时，把搜索词直接填进名字栏 ——
   * 用户刚才已经把那几个字打了一遍，不该让他再打一遍。 */
  initialName?: string;
}) {
  const [name, setName] = useState(initialName);
  const [grams, setGrams] = useState('100');
  const [label, setLabel] = useState('1 份');
  const [kcal, setKcal] = useState('');
  const [showMacros, setShowMacros] = useState(false);
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carb, setCarb] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  /* 空字符串要当成「没填」，不能当成 0 —— Number('') === 0，
   * 直接用会让「没填蛋白质」变成「蛋白质 0 克」，看起来像是确定的信息。 */
  const numOrUndefined = (s: string): number | undefined => {
    const t = s.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
  };

  function submit() {
    setError(null);

    const kcalNum = numOrUndefined(kcal);
    if (kcalNum === undefined) {
      setError('「这一份多少大卡」得填一下 —— 大概值就行，不用精确。');
      return;
    }
    const gramsNum = numOrUndefined(grams) ?? 100;

    startTransition(async () => {
      const res = await createCustomFood({
        name: name.trim(),
        servingGrams: gramsNum,
        servingLabel: label.trim() || '1 份',
        servingKcal: kcalNum,
        proteinG: numOrUndefined(protein),
        fatG: numOrUndefined(fat),
        carbG: numOrUndefined(carb),
      });

      if (!res.ok) {
        setError(res.error);
        return;
      }
      onCreated(res.food);
    });
  }

  return (
    <section className="rounded-md border border-hairline bg-card p-space-4">
      <div className="mb-space-3 flex items-baseline justify-between">
        <h2 className="text-headline font-semibold text-ink">自己加一个</h2>
        <button
          type="button"
          onClick={onCancel}
          className="text-footnote text-ink-3 hover:text-ink"
        >
          取消
        </button>
      </div>

      <div className="space-y-space-3">
        <label className="block">
          <span className="mb-1 block text-footnote text-ink-3">叫什么</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="比如「一食堂红烧肉盖饭」"
            maxLength={30}
            autoFocus
            className={inputCls}
          />
        </label>

        {/* 份量和热量并排：这两个数字是一起想到的（「这一份四百克、六百大卡」），
            拆成上下两行反而要多扫一次眼。 */}
        <div className="grid grid-cols-2 gap-space-3">
          <label className="block">
            <span className="mb-1 block text-footnote text-ink-3">这一份多重</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={grams}
                onChange={(e) => setGrams(e.target.value)}
                className={`${inputCls} text-right`}
              />
              <span className="shrink-0 text-footnote text-ink-3">克</span>
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-footnote text-ink-3">多少大卡</span>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={kcal}
                onChange={(e) => setKcal(e.target.value)}
                placeholder="500"
                className={`${inputCls} text-right`}
              />
              <span className="shrink-0 text-footnote text-ink-3">kcal</span>
            </div>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-footnote text-ink-3">这一份叫</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="1 份"
            maxLength={8}
            className={inputCls}
          />
          <span className="mt-1 block text-caption-1 text-ink-3">
            以后记这个食物时，下拉框里显示的就是「{label.trim() || '1 份'}」。
          </span>
        </label>

        {/* 三大营养素：默认折叠。 */}
        <div>
          <button
            type="button"
            onClick={() => setShowMacros((v) => !v)}
            aria-expanded={showMacros}
            className="text-footnote text-ink-2 underline-offset-2 hover:text-ink hover:underline"
          >
            {showMacros ? '收起三大营养素' : '要更准的话，填一下三大营养素（可不填）'}
          </button>

          {showMacros && (
            <div className="mt-space-3 grid grid-cols-3 gap-space-2">
              {[
                { label: '蛋白质', value: protein, set: setProtein },
                { label: '脂肪', value: fat, set: setFat },
                { label: '碳水', value: carb, set: setCarb },
              ].map((f) => (
                <label key={f.label} className="block">
                  <span className="mb-1 block text-caption-1 text-ink-3">{f.label}（克）</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={f.value}
                    onChange={(e) => f.set(e.target.value)}
                    className={`${inputCls} text-right`}
                  />
                </label>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="rounded-md bg-sys-red/12 px-3 py-2 text-footnote text-accent-red">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={isPending || name.trim() === ''}
          className="touch-target w-full rounded-md bg-brand px-space-5 py-space-3 text-subhead font-semibold text-on-accent transition-opacity disabled:opacity-50"
        >
          {isPending ? '正在加…' : '加进食物库并记下'}
        </button>

        <p className="text-caption-1 text-ink-3">
          加进去之后只有你自己看得见，下次直接搜名字就能记。热量按你填的这一份折算成每 100
          克保存 —— 所以就算填的是一整份，记「1 份」得到的就是你填的那个数。
        </p>
      </div>
    </section>
  );
}
