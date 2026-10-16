'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { ACTIVITY_LABELS, type ActivityLevel } from '@/lib/nutrition';
import { savePlan } from './actions';
/* 初值从 ./state 拿 —— actions.ts 是 'use server' 文件，只能导出 async 函数。 */
import { ONBOARDING_INITIAL } from './state';

/* 引导表单。
 *
 * 设计上只有一条要求：**一屏填完**。
 * 分步骤的向导看起来更精致，但每多一屏就多一次放弃的机会 ——
 * 而这个表单总共只有 6 个字段，分成 3 屏纯属自我表演。
 */

const LEVEL_ORDER: readonly ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="touch-target w-full rounded-md bg-brand px-space-5 py-space-3 text-headline font-semibold text-on-accent transition-opacity disabled:opacity-50"
    >
      {pending ? '正在计算…' : '算出我的目标'}
    </button>
  );
}

/** 单选组。用 fieldset + legend 是为了屏幕阅读器 —— 一组单选框必须有组名，
 *  否则读出来是一串孤立的"男 / 女"，不知道在选什么。 */
function ChoiceGroup<T extends string>({
  name,
  legend,
  hint,
  options,
  defaultValue,
}: {
  name: string;
  legend: string;
  hint?: string;
  options: readonly { value: T; label: string; desc?: string }[];
  defaultValue?: T;
}) {
  return (
    <fieldset className="border-0 p-0">
      <legend className="text-subhead text-ink-2">{legend}</legend>
      {hint && <p className="mt-space-1 text-caption-1 text-ink-4">{hint}</p>}
      <div className="mt-space-2 flex flex-col gap-space-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-start gap-space-3 rounded-md border border-separator bg-card p-space-3 transition-colors has-checked:border-brand"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              defaultChecked={o.value === defaultValue}
              required
              className="mt-[3px] size-[18px] shrink-0 accent-[var(--color-brand)]"
            />
            <span className="flex flex-col">
              <span className="text-body text-ink">{o.label}</span>
              {o.desc && <span className="text-caption-1 text-ink-3">{o.desc}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NumberField({
  name,
  label,
  unit,
  placeholder,
  step,
  min,
  max,
  defaultValue,
}: {
  name: string;
  label: string;
  unit: string;
  placeholder: string;
  step?: string;
  min: number;
  max: number;
  defaultValue?: string;
}) {
  return (
    <div className="flex flex-col gap-space-2">
      <label htmlFor={name} className="text-subhead text-ink-2">
        {label}
      </label>
      <div className="flex items-baseline gap-space-2">
        <input
          id={name}
          name={name}
          type="number"
          inputMode="decimal"
          required
          step={step ?? '1'}
          min={min}
          max={max}
          placeholder={placeholder}
          defaultValue={defaultValue}
          /* 单位写在输入框外而不是 placeholder 里：
           * placeholder 一输入就消失，用户回头看不出这格是什么单位。 */
          className="w-[120px] rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink placeholder:text-ink-4"
        />
        <span className="text-body text-ink-3">{unit}</span>
      </div>
    </div>
  );
}

export function OnboardingForm({
  defaults,
}: {
  defaults: {
    sex?: string | null;
    birthDate?: string | null;
    heightCm?: string | null;
    weightKg?: string | null;
    activityLevel?: string | null;
    goalType?: string | null;
  };
}) {
  const [state, formAction] = useActionState(savePlan, ONBOARDING_INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-space-6">
      <ChoiceGroup
        name="sex"
        legend="生理性别"
        hint="基础代谢公式（Mifflin-St Jeor）男女不同，所以需要它。"
        defaultValue={(defaults.sex as 'male' | 'female') ?? 'male'}
        options={[
          { value: 'male', label: '男' },
          { value: 'female', label: '女' },
        ]}
      />

      <div className="flex flex-col gap-space-2">
        <label htmlFor="birthDate" className="text-subhead text-ink-2">
          出生日期
        </label>
        <input
          id="birthDate"
          name="birthDate"
          type="date"
          required
          defaultValue={defaults.birthDate ?? ''}
          className="w-[200px] rounded-md border border-separator bg-sunken px-space-4 py-space-3 text-body text-ink"
        />
        <p className="text-caption-1 text-ink-4">
          存日期不存年龄 —— 年龄每年会变，存年龄的话明年你的基础代谢就是错的。
        </p>
      </div>

      <NumberField
        name="heightCm"
        label="身高"
        unit="cm"
        placeholder="178"
        min={50}
        max={260}
        defaultValue={defaults.heightCm ?? undefined}
      />

      <NumberField
        name="weightKg"
        label="当前体重"
        unit="kg"
        placeholder="82"
        step="0.1"
        min={20}
        max={400}
        defaultValue={defaults.weightKg ?? undefined}
      />

      <ChoiceGroup<ActivityLevel>
        name="activityLevel"
        legend="日常活动水平"
        hint="不确定就选久坐 —— 这些系数普遍被认为会高估真实消耗，选高了目标会偏高。"
        defaultValue={(defaults.activityLevel as ActivityLevel) ?? 'sedentary'}
        options={LEVEL_ORDER.map((k) => ({
          value: k,
          label: ACTIVITY_LABELS[k].name,
          desc: ACTIVITY_LABELS[k].desc,
        }))}
      />

      <ChoiceGroup
        name="goalType"
        legend="目标"
        defaultValue={(defaults.goalType as 'lose' | 'maintain' | 'gain') ?? 'lose'}
        options={[
          { value: 'lose', label: '减脂', desc: '每天制造热量缺口，速度上限为每周体重的 1%' },
          { value: 'maintain', label: '保持', desc: '吃到日常消耗，不减也不增' },
          { value: 'gain', label: '增重', desc: '小幅热量盈余' },
        ]}
      />

      <SubmitButton />

      {state.status === 'error' && (
        <p role="alert" className="text-footnote text-accent-red">
          {state.message}
        </p>
      )}

      <p className="text-caption-1 text-ink-4">
        计算结果基于公开的通用公式，仅供参考，不构成医疗建议。
      </p>
    </form>
  );
}
