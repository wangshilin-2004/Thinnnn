'use client';

import { useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import Link from 'next/link';

import type { MealType, PickerFood } from '@/db/queries';

import { addMealItem, deleteMealItem } from './actions';

/* 记一餐的交互层。
 *
 * 为什么这一屏是客户端组件，而控制台是服务端组件：
 * 搜索必须**跟着每一次按键立刻响应**。做成服务端搜索的话，每个字都要
 * 一次往返，在手机上会有肉眼可见的迟滞 —— 而「录入有没有摩擦」正是
 * 这个产品调研下来最主要的失败原因（JMIR 2026：所有热量记录类 App
 * 的坚持率都随时间下降）。所以目录一次性下发，搜索在本地做。
 *
 * 乐观更新用 React 19 的 useOptimistic：点下去立刻出现在列表里，
 * 网络往返在后台完成。失败时 React 会自动回滚到服务端状态。
 */

type MealItem = {
  id: string;
  mealType: MealType;
  foodName: string;
  quantityG: number;
  servingLabel: string | null;
  kcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
};

type RecentFood = {
  foodId: string | null;
  foodName: string;
  quantityG: number;
  servingLabel: string | null;
  kcal: number;
};

type Patch =
  | { kind: 'add'; item: MealItem }
  | { kind: 'remove'; id: string };

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/* 搜索打分。
 *
 * 为什么不用简单的 includes：中文食物名大量共享后缀（「白米饭 / 糙米饭 /
 * 蛋炒饭」都含「饭」），单纯按包含匹配会让结果顺序很随机。这里让
 * 「完全相等 > 前缀匹配 > 包含」逐级降权，并给别名（「米饭」「白饭」）
 * 一个介于中间的权重 —— 用户输入的往往是口语叫法，而库里存的是规范名。
 */
function scoreFood(food: PickerFood, q: string): number {
  const name = food.name;
  if (name === q) return 100;
  if (name.startsWith(q)) return 85;
  if (name.includes(q)) return 65;

  for (const alias of food.aliases) {
    if (alias === q) return 75;
    if (alias.startsWith(q)) return 55;
    if (alias.includes(q)) return 45;
  }

  if (food.category === q) return 25;
  if (food.category.includes(q)) return 15;
  return 0;
}

export function MealLogger({
  catalog,
  recent,
  todaysMeals,
  today,
  defaultMealType,
  mealLabels,
  targetKcal,
}: {
  catalog: PickerFood[];
  recent: RecentFood[];
  todaysMeals: MealItem[];
  today: string;
  defaultMealType: MealType;
  mealLabels: Record<MealType, string>;
  targetKcal: number | null;
}) {
  const [mealType, setMealType] = useState<MealType>(defaultMealType);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const [optimistic, applyPatch] = useOptimistic(
    todaysMeals,
    (state: MealItem[], patch: Patch) =>
      patch.kind === 'add'
        ? [...state, patch.item]
        : state.filter((m) => m.id !== patch.id),
  );

  const q = query.trim();

  const results = useMemo(() => {
    if (!q) return [];
    return catalog
      .map((f) => ({ food: f, s: scoreFood(f, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.food.kcalPer100 - b.food.kcalPer100)
      .slice(0, 40)
      .map((x) => x.food);
  }, [catalog, q]);

  /* 按分类分组，用于「没搜索时」的浏览视图。
   * 用 reduce 而不是 SQL 的 group by：数据已经在客户端了，
   * 一次遍历就够，没必要为它多查一次库。 */
  const byCategory = useMemo(() => {
    const map = new Map<string, PickerFood[]>();
    for (const f of catalog) {
      const list = map.get(f.category);
      if (list) list.push(f);
      else map.set(f.category, [f]);
    }
    return [...map.entries()];
  }, [catalog]);

  const eatenToday = optimistic.reduce((sum, m) => sum + m.kcal, 0);
  const remaining = targetKcal === null ? null : targetKcal - eatenToday;

  function handleAdd(food: PickerFood) {
    setError(null);
    setQuery('');
    /* 记完之后把焦点还给输入框，让「连续记几样」不用重新点一下输入框。 */
    inputRef.current?.focus();

    startTransition(async () => {
      applyPatch({
        kind: 'add',
        item: {
          id: `optimistic-${food.id}-${Date.now()}`,
          mealType,
          foodName: food.name,
          quantityG: food.serving?.grams ?? 100,
          servingLabel: food.serving?.label ?? null,
          kcal: Math.round(((food.kcalPer100 * (food.serving?.grams ?? 100)) / 100) * 10) / 10,
          proteinG: 0,
          fatG: 0,
          carbG: 0,
        },
      });

      const res = await addMealItem({ foodId: food.id, mealType, logDate: today });
      if (res.ok) {
        setFlash(`${res.item.foodName} · ${res.item.kcal} kcal 已记录`);
        window.setTimeout(() => setFlash(null), 2400);
      } else {
        setError(res.error);
      }
    });
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      applyPatch({ kind: 'remove', id });
      const res = await deleteMealItem({ id });
      if (!res.ok) setError(res.error ?? '删除失败');
    });
  }

  return (
    <div className="space-y-space-5">
      {/* ── 餐次切换 ─────────────────────────────────────────── */}
      <div
        role="tablist"
        aria-label="哪一餐"
        className="flex gap-1 rounded-md bg-sunken p-1"
      >
        {MEAL_ORDER.map((mt) => {
          const active = mt === mealType;
          return (
            <button
              key={mt}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setMealType(mt)}
              className={`touch-target flex-1 rounded-sm px-3 py-2 text-subhead transition-colors ${
                active
                  ? 'bg-raised font-semibold text-ink shadow-sm'
                  : 'text-ink-2 hover:text-ink'
              }`}
            >
              {mealLabels[mt]}
            </button>
          );
        })}
      </div>

      {/* ── 今日进度 ─────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between">
        <span className="text-footnote text-ink-3">
          今天已记 {Math.round(eatenToday).toLocaleString('zh-CN')} kcal
        </span>
        {remaining !== null && (
          <span className="text-footnote text-ink-3">
            {remaining >= 0
              ? `还可吃 ${Math.round(remaining).toLocaleString('zh-CN')} kcal`
              : `超出 ${Math.round(-remaining).toLocaleString('zh-CN')} kcal`}
          </span>
        )}
      </div>

      {/* ── 搜索 ─────────────────────────────────────────────── */}
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索食物，比如「米饭」「鸡胸」"
          aria-label="搜索食物"
          autoComplete="off"
          /* iOS 上自动聚焦会弹出键盘、顶起整个页面，所以只在桌面端聚焦。 */
          autoFocus={false}
          className="w-full rounded-md border border-hairline bg-card px-4 py-3 text-body text-ink placeholder:text-ink-3 focus:border-separator-opaque focus:outline-none"
        />
      </div>

      {flash && (
        <p
          role="status"
          className="rounded-md bg-sys-green/12 px-3 py-2 text-footnote text-accent-green"
        >
          {flash}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-sys-red/12 px-3 py-2 text-footnote text-accent-red">
          {error}
        </p>
      )}

      {/* ── 搜索结果 ─────────────────────────────────────────── */}
      {q ? (
        <section>
          <h2 className="mb-2 text-footnote text-ink-3">
            {results.length > 0 ? `找到 ${results.length} 项` : '没找到'}
          </h2>
          {results.length === 0 ? (
            <p className="prose-measure text-subhead text-ink-2">
              食物库里暂时没有「{q}」。可以先到「我的食物」里自建一条，或者换个叫法试试
              —— 比如「米饭」而不是「大米」。
            </p>
          ) : (
            <ul className="divide-y divide-separator overflow-hidden rounded-md bg-card">
              {results.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  disabled={isPending}
                  onAdd={() => handleAdd(food)}
                />
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {/* ── 最近吃过 ───────────────────────────────────────── */}
          {recent.length > 0 && (
            <section>
              <h2 className="mb-2 text-footnote text-ink-3">最近吃过</h2>
              <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                {recent.map((r) => (
                  /* foodName 就是唯一的：getRecentFoods 已经按名字去重了。 */
                  <li key={r.foodName} className="shrink-0">
                    <button
                      type="button"
                      disabled={isPending || !r.foodId}
                      onClick={() => {
                        const food = catalog.find((f) => f.id === r.foodId);
                        if (food) handleAdd(food);
                      }}
                      className="touch-target rounded-full border border-hairline bg-card px-4 py-2 text-left transition-colors hover:border-separator-opaque disabled:opacity-40"
                    >
                      <span className="block text-subhead text-ink">{r.foodName}</span>
                      <span className="block text-caption-2 text-ink-3">
                        {Math.round(r.kcal)} kcal
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ── 按分类浏览 ─────────────────────────────────────── */}
          {byCategory.map(([category, list]) => (
            <section key={category}>
              <h2 className="mb-2 text-footnote text-ink-3">{category}</h2>
              <ul className="divide-y divide-separator overflow-hidden rounded-md bg-card">
                {list.map((food) => (
                  <FoodRow
                    key={food.id}
                    food={food}
                    disabled={isPending}
                    onAdd={() => handleAdd(food)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {/* ── 今天已记录 ───────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-footnote text-ink-3">今天已记录</h2>
          <Link href="/dashboard" className="text-footnote text-accent-blue hover:underline">
            看趋势 →
          </Link>
        </div>

        {optimistic.length === 0 ? (
          <p className="rounded-md bg-card px-4 py-6 text-center text-subhead text-ink-3">
            还没记任何东西。搜索上面的食物，点一下就算记好了。
          </p>
        ) : (
          MEAL_ORDER.filter((mt) => optimistic.some((m) => m.mealType === mt)).map((mt) => {
            const items = optimistic.filter((m) => m.mealType === mt);
            const subtotal = items.reduce((s, m) => s + m.kcal, 0);
            return (
              <div key={mt} className="mb-space-4">
                <div className="flex items-baseline justify-between px-1 pb-1">
                  <span className="text-subhead font-medium text-ink">{mealLabels[mt]}</span>
                  <span className="tabular text-caption-1 text-ink-3">
                    {Math.round(subtotal).toLocaleString('zh-CN')} kcal
                  </span>
                </div>
                <ul className="divide-y divide-separator overflow-hidden rounded-md bg-card">
                  {items.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-subhead text-ink">{m.foodName}</span>
                        <span className="block text-caption-1 text-ink-3">
                          {m.servingLabel ?? `${Math.round(m.quantityG)} g`}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-subhead text-ink-2">
                        {Math.round(m.kcal)} kcal
                      </span>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleDelete(m.id)}
                        aria-label={`删除 ${m.foodName}`}
                        className="touch-target shrink-0 rounded-full px-3 text-ink-3 transition-colors hover:text-accent-red disabled:opacity-40"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function FoodRow({
  food,
  disabled,
  onAdd,
}: {
  food: PickerFood;
  disabled: boolean;
  onAdd: () => void;
}) {
  const grams = food.serving?.grams ?? 100;
  const kcal = Math.round((food.kcalPer100 * grams) / 100);

  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onAdd}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised disabled:opacity-40"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-subhead text-ink">{food.name}</span>
          <span className="block truncate text-caption-1 text-ink-3">
            {food.serving ? food.serving.label : `${grams} g`}
            {' · '}
            {kcal} kcal
            {food.serving ? ` · 每 100 g ${Math.round(food.kcalPer100)} kcal` : ''}
          </span>
        </span>
        <span
          aria-hidden
          className="shrink-0 rounded-full bg-brand px-3 py-1 text-caption-1 font-medium text-on-accent"
        >
          记下
        </span>
      </button>
    </li>
  );
}
