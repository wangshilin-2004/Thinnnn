/* 份量文案。
 *
 * 为什么需要这个模块：`meal_items.serving_label` 存的是一份的名字，比如「1碗」。
 * 这个「1」是**份数**，不是当前这条记录的份数 —— 用户把 150 g 改成 300 g 之后，
 * 行里如果还照着标签显示，就会写着「1碗 / 348 kcal」，自相矛盾。
 *
 * 所以显示时现算：一份多少克（serving_grams，从 food_servings JOIN 出来）
 * 和当前克数相除得到真实份数，再把标签里的数字换掉。数据库里的标签保持
 * 「一份叫什么」这个语义不变 —— 改份量不需要顺手改标签，也就不会出现
 * 「标签改了但克数没改」这种一半新一半旧的状态。
 *
 * 这也是为什么 updateMealQuantity 故意不碰 serving_label。
 */

/** 一条记录里和份量显示有关的三个字段。 */
export type Portion = {
  /** 当前克数，数据库是 numeric，读出来已经转成 number。 */
  quantityG: number;
  /** 一份多少克。JOIN 不到（份量被删了、或本来就是手输克数）时为 null。 */
  servingGrams: number | null;
  /** 一份叫什么，比如「1碗」「5块」。手输克数时为 null。 */
  servingLabel: string | null;
};

/** 数字去掉多余的小数点：2 → "2"，1.5 → "1.5"，2.0 → "2"。 */
function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(1)));
}

/** 把「1碗」按倍数改写成「2碗」「0.5碗」。
 *
 *  标签几乎都是「数字 + 单位」拼的（1碗 / 1个 / 1片 / 5块 / 1小把 / 1盒），
 *  换掉数字就行。少数没有数字的（「适量」「一份」）没法改写，
 *  退回「2 × 适量」—— 丑，但不会说谎。
 */
export function scaleLabel(label: string, count: number): string {
  const m = /^(\d+(?:\.\d+)?)(.*)$/.exec(label.trim());
  if (!m) return `${trimNum(count)} × ${label.trim()}`;
  return `${trimNum(Number(m[1]) * count)}${m[2]}`;
}

/** 一行份量该显示什么。
 *
 *  能用份数表达就用份数（「2碗」比「300 g」好念），但只在份数是
 *  半个的整数倍时才用 —— 「0.33碗」没人这么说话，这种退回克数。
 */
export function portionText({ quantityG, servingGrams, servingLabel }: Portion): string {
  if (servingGrams && servingGrams > 0 && servingLabel) {
    const count = quantityG / servingGrams;
    /* 判定「是不是半个的整数倍」。用 2 倍再取整是为了把 0.5 当一格 ——
     * 直接看 count 是不是整数会把「半碗」判掉。1e-6 是浮点容差：
     * 300 / 150 正好 2，但 450 / 150 可能算出 2.9999999999999996。 */
    if (Math.abs(count * 2 - Math.round(count * 2)) < 1e-6) {
      return scaleLabel(servingLabel, count);
    }
  }
  return `${Math.round(quantityG)} g`;
}

/** 改份量时「加一下」「减一下」各走多少克。
 *
 *  有份量概念时走半份 —— 一顿饭的修正量级基本就是「多半碗」「少半碗」，
 *  按一整份会太粗（点两下就从一碗变三碗）。没有份量就按 50 g，
 *  这也是食物库「每 100 g」之外的常用粒度。
 */
export function portionStep(servingGrams: number | null): number {
  if (servingGrams && servingGrams > 0) return Math.max(1, Math.round(servingGrams / 2));
  return 50;
}
