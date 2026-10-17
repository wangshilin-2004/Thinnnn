'use client';

import { useMemo, useOptimistic, useRef, useState, useTransition } from 'react';
import Link from 'next/link';

import type { MealType, PickerFood } from '@/db/queries';
import { portionStep, portionText } from '@/lib/portion';

import { addMealItem, deleteMealItem, updateMealQuantity } from './actions';
import { CustomFoodForm } from './custom-food-form';

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
  /* 原始一份多少克，来自 food_servings（LEFT JOIN，可能为空）。
   * 界面上的份数 = quantityG / servingGrams，见 src/lib/portion.ts。 */
  servingGrams: number | null;
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
  | { kind: 'remove'; id: string }
  | { kind: 'resize'; id: string; quantityG: number };

const MEAL_ORDER: MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/* 分类的展示顺序。
 *
 * 原来这里没有顺序 —— 按 catalog 的到达次序分组，于是第一屏是
 * 「坚果 / 奶类 / 快餐外卖」，纯粹是数据库返回的偶然次序。没人会从
 * 坚果开始记一顿饭。
 *
 * 改成按「一顿饭里出现的概率」排：主食打头（中国饮食的底盘），
 * 然后是菜和外卖；再是蛋白质来源，减脂期最该盯的一组；接着是
 * 可以放心大口吃的蔬果；最后是「用量小但热量密度极高」的一类 ——
 * 一勺油 90 kcal、一勺芝麻酱 126 kcal，放前面会误导人以为可以随便点。
 */
const CATEGORY_ORDER = [
  '谷薯',
  '菜肴',
  '快餐外卖',
  '畜肉',
  '禽肉',
  '水产',
  '蛋类',
  '豆类',
  '奶类',
  '蔬菜',
  '菌藻',
  '水果',
  '坚果',
  '油脂',
  '调味品',
  '糕点零食',
  '饮料',
] as const;

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
  /* null = 还没手动选过，用 CATEGORY_ORDER 里的第一个。
   * 不写成 useState(categories[0]) 是因为 categories 要等 catalog 分组完
   * 才知道 —— 用 useMemo 算完再兜底，省掉一个「挂载后 setState」的 effect。 */
  const [pickedCategory, setPickedCategory] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /* 正在改份量的那一条：存 id + 草稿克数。
   * 草稿放在这里而不是子组件里 —— 列表在乐观更新时整体重渲染，
   * 子组件自己的 state 会被丢掉，用户正在输入的内容会凭空消失。 */
  const [editing, setEditing] = useState<{ id: string; grams: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  /* 本次会话里新建的食物。服务端 revalidatePath 之后会重新下发 catalog，
   * 但那次往返有延迟 —— 用户刚建完就想去搜索框里搜到它。先在本地补上，
   * 服务端数据到了按 id 去重（见 allFoods）。 */
  const [addedFoods, setAddedFoods] = useState<PickerFood[]>([]);
  const [showCustom, setShowCustom] = useState(false);
  const [customInitialName, setCustomInitialName] = useState('');

  const [optimistic, applyPatch] = useOptimistic(
    todaysMeals,
    (state: MealItem[], patch: Patch) => {
      if (patch.kind === 'add') return [...state, patch.item];
      if (patch.kind === 'remove') return state.filter((m) => m.id !== patch.id);

      /* 改份量：按比例缩放这一条的全部营养值，让数字立刻跟上手指。
       * 服务端会用食物当前的「每 100 g 密度」重算，可能与此处差一点点 ——
       * 没关系：过渡结束后 useOptimistic 会被服务端的真实值覆盖。 */
      return state.map((m) => {
        if (m.id !== patch.id || m.quantityG <= 0) return m;
        const factor = patch.quantityG / m.quantityG;
        return {
          ...m,
          quantityG: patch.quantityG,
          kcal: m.kcal * factor,
          proteinG: m.proteinG * factor,
          fatG: m.fatG * factor,
          carbG: m.carbG * factor,
        };
      });
    },
  );

  const q = query.trim();

  /* 内置库 + 本次会话新建的。按 id 去重：revalidate 之后服务端会把新食物
   * 也放进 catalog，两处同时有它，不去重就会在搜索结果里出现两次。 */
  const allFoods = useMemo(() => {
    if (addedFoods.length === 0) return catalog;
    const known = new Set(catalog.map((f) => f.id));
    return [...catalog, ...addedFoods.filter((f) => !known.has(f.id))];
  }, [catalog, addedFoods]);

  const results = useMemo(() => {
    if (!q) return [];
    return allFoods
      .map((f) => ({ food: f, s: scoreFood(f, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.food.kcalPer100 - b.food.kcalPer100)
      .slice(0, 40)
      .map((x) => x.food);
  }, [allFoods, q]);

  /* 按分类分组，用于「没搜索时」的浏览视图。
   * 用 reduce 而不是 SQL 的 group by：数据已经在客户端了，
   * 一次遍历就够，没必要为它多查一次库。
   *
   * 分组完再按 CATEGORY_ORDER 重排。库里将来新增了没登记的分类时
   * 接在最后，而不是被 filter 悄悄吃掉 —— 吃掉的后果是那些食物
   * 只能靠搜索找到，用户根本不知道它们存在。 */
  const categories = useMemo(() => {
    const map = new Map<string, PickerFood[]>();
    for (const f of allFoods) {
      const list = map.get(f.category);
      if (list) list.push(f);
      else map.set(f.category, [f]);
    }
    const known = CATEGORY_ORDER.filter((c) => map.has(c));
    const rest = [...map.keys()].filter((c) => !(CATEGORY_ORDER as readonly string[]).includes(c));
    return [...known, ...rest].map((c) => [c, map.get(c)!] as const);
  }, [allFoods]);

  const shownCategory = pickedCategory ?? categories[0]?.[0] ?? null;
  const shownFoods = categories.find(([c]) => c === shownCategory)?.[1] ?? [];

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
          servingGrams: food.serving?.grams ?? null,
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

  /* 新建食物成功：塞进本地目录、收起表单、立刻记一份。
   * 「建完就记」是刻意的 —— 会打开这个表单的人都是刚吃完东西，
   * 让他再回搜索框把自己刚打的字打一遍，纯属浪费。 */
  function handleCreated(food: PickerFood) {
    setAddedFoods((prev) => [...prev, food]);
    setShowCustom(false);
    handleAdd(food);
  }

  function handleDelete(id: string) {
    setError(null);
    startTransition(async () => {
      applyPatch({ kind: 'remove', id });
      const res = await deleteMealItem({ id });
      if (!res.ok) setError(res.error ?? '删除失败');
    });
  }

  /* 改份量。不传任何算好的数字 —— 服务端按食物的「每 100 g 密度」重算
   * 克数、热量和三大营养素，客户端只负责把意图说清楚。 */
  function handleResize(id: string, quantityG: number) {
    setError(null);
    setEditing(null);
    startTransition(async () => {
      applyPatch({ kind: 'resize', id, quantityG });
      const res = await updateMealQuantity({ id, quantityG });
      if (!res.ok) setError(res.error ?? '改份量失败，再试一次。');
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

      {/* 自建食物的入口。就放在搜索框正下方，不放页面底部 ——
          它服务的是「搜了但没搜到」这个瞬间，而那个瞬间用户的眼睛
          还停在搜索框上。 */}
      {!showCustom && (
        <button
          type="button"
          onClick={() => {
            setCustomInitialName('');
            setShowCustom(true);
          }}
          className="touch-target text-footnote text-ink-2 underline-offset-2 hover:text-ink hover:underline"
        >
          + 食物库里没有？自己加一个
        </button>
      )}

      {showCustom && (
        <CustomFoodForm
          initialName={customInitialName}
          onCreated={handleCreated}
          onCancel={() => setShowCustom(false)}
        />
      )}

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
      {q && !showCustom ? (
        <section>
          <h2 className="mb-2 text-footnote text-ink-3">
            {results.length > 0 ? `找到 ${results.length} 项` : '没找到'}
          </h2>
          {results.length === 0 ? (
            <div className="space-y-space-3">
              <p className="prose-measure text-subhead text-ink-2">
                食物库里暂时没有「{q}」。换个叫法试试 —— 比如「米饭」而不是「大米」；
                或者自己加一个，只要知道这一份大概多少大卡。
              </p>
              {!showCustom && (
                <button
                  type="button"
                  onClick={() => {
                    setCustomInitialName(q);
                    setShowCustom(true);
                  }}
                  className="touch-target rounded-md bg-brand px-space-5 py-space-3 text-subhead font-semibold text-on-accent transition-opacity"
                >
                  加一个「{q}」
                </button>
              )}
            </div>
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
      ) : !showCustom ? (
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
                        const food = allFoods.find((f) => f.id === r.foodId);
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
          <section>
            <h2 className="mb-2 text-footnote text-ink-3">按分类找</h2>

            {/* 横向滚动的分类芯片。
             *
             * 为什么不是原来那样把所有分类依次堆在页面上：食物库有 212 行，
             * 在手机上量出来是 10 屏以上 —— 想记一碗米饭要翻半天，而
             * 「录入摩擦」正是这个产品调研里最主要的流失原因。
             * 现在页面高度只跟当前这一类有关（最多 28 行）。
             *
             * 芯片本身也是分类的全貌：一眼看得见库里有什么，不用滚到底。 */}
            <ul className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
              {categories.map(([category, list]) => {
                const active = category === shownCategory;
                return (
                  <li key={category} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setPickedCategory(category)}
                      aria-pressed={active}
                      className={`touch-target rounded-full border px-4 py-2 text-subhead transition-colors ${
                        active
                          ? 'border-brand bg-brand font-semibold text-on-accent'
                          : 'border-hairline bg-card text-ink-2 hover:border-separator-opaque hover:text-ink'
                      }`}
                    >
                      {category}
                      <span
                        className={`ml-1.5 text-caption-1 ${active ? 'text-on-accent' : 'text-ink-3'}`}
                      >
                        {list.length}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <ul className="divide-y divide-separator overflow-hidden rounded-md bg-card">
              {shownFoods.map((food) => (
                <FoodRow
                  key={food.id}
                  food={food}
                  disabled={isPending}
                  onAdd={() => handleAdd(food)}
                />
              ))}
            </ul>
          </section>
        </>
      ) : null}

      {/* ── 今天已记录 ───────────────────────────────────────── */}
      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-footnote text-ink-3">今天已记录</h2>
          {/* 触控区同样用伪元素扩到 44px：这是个 20px 高的文字链接，
              在手机上点起来很容易打偏。 */}
          <Link
            href="/dashboard"
            className="relative text-footnote text-accent-blue after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline"
          >
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
                  {items.map((m) => {
                    /* 加一下/减一下走半份（「多半碗」「少半碗」），没有份量
                     * 概念的手输条走 50 g。见 src/lib/portion.ts。 */
                    const step = portionStep(m.servingGrams);

                    if (editing?.id === m.id) {
                      return (
                        <li key={m.id} className="px-4 py-3">
                          <div className="space-y-2">
                            <div className="flex items-center gap-3">
                              <span className="min-w-0 flex-1 truncate text-subhead text-ink">
                                {m.foodName}
                              </span>
                              <span className="tabular shrink-0 text-subhead text-ink">
                                {m.quantityG > 0
                                  ? Math.round((m.kcal / m.quantityG) * editing.grams)
                                  : 0}{' '}
                                kcal
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                aria-label={`${m.foodName} 少一点`}
                                onClick={() =>
                                  setEditing({
                                    id: m.id,
                                    grams: Math.max(step, editing.grams - step),
                                  })
                                }
                                className="touch-target rounded-full bg-sunken px-4 text-subhead text-ink transition-colors hover:bg-raised"
                              >
                                −
                              </button>
                              <span className="tabular min-w-24 text-center text-subhead text-ink">
                                {portionText({
                                  quantityG: editing.grams,
                                  servingGrams: m.servingGrams,
                                  servingLabel: m.servingLabel,
                                })}
                              </span>
                              <button
                                type="button"
                                aria-label={`${m.foodName} 多一点`}
                                onClick={() =>
                                  setEditing({
                                    id: m.id,
                                    grams: Math.min(5000, editing.grams + step),
                                  })
                                }
                                className="touch-target rounded-full bg-sunken px-4 text-subhead text-ink transition-colors hover:bg-raised"
                              >
                                ＋
                              </button>
                              <span className="flex-1" />
                              <button
                                type="button"
                                onClick={() => setEditing(null)}
                                className="touch-target rounded-full px-3 text-subhead text-ink-2 transition-colors hover:text-ink"
                              >
                                取消
                              </button>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => handleResize(m.id, editing.grams)}
                                className="touch-target rounded-full bg-accent px-4 text-subhead font-medium text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    }

                    return (
                      <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-subhead text-ink">{m.foodName}</span>
                          <span className="block text-caption-1 text-ink-3">
                            {portionText(m)}
                            {/* 份量可改。做成文字按钮而不是图标：这里空间够，
                                而且「改」比一个铅笔图标更不容易被忽略。
                                触控区用 after 伪元素往外扩到 44px 高，而不是加
                                .touch-target —— 那会把只有 17px 高的这一行直接
                                撑成 44px，紧凑的列表就被拆散了。视觉不变，手指够得着。 */}
                            <button
                              type="button"
                              onClick={() => {
                                setError(null);
                                setEditing({ id: m.id, grams: m.quantityG });
                              }}
                              aria-label={`改 ${m.foodName} 的份量，当前 ${portionText(m)}`}
                              className="relative ml-2 text-caption-1 text-accent-blue transition-opacity after:absolute after:-inset-x-2 after:-inset-y-3.5 after:content-[''] hover:opacity-70"
                            >
                              改
                            </button>
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
                    );
                  })}
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
