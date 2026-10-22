/**
 * 喝水的纯计算 —— 不碰数据库，所以既能在 server 组件里用，
 * 也能被单测直接调用。
 *
 * 【单位约定】
 *   存储、计算、传参，**一律是 mL 整数**。
 *   L 只在最后显示时出现一次（formatWater）。
 *   为什么不用 L：0.25 L / 1.8 L 这种小数在数据库里要 numeric，
 *   写进去再读出来会有 0.25000001 这类尾巴，加减也不精确；
 *   而 mL 是整数，整条链路都对得上。
 */

/** 快捷按钮：一杯水 / 一瓶水。 */
export const QUICK_ADDS = [250, 500] as const;

/** 单次记录上限，和数据库 CHECK 保持一致（防手滑，不是营养学标准）。 */
export const MAX_SINGLE_ML = 3000;

/**
 * 没设过目标时，按体重估算每日目标。
 *
 * 33 mL/kg 是常见的成人经验值（60 kg → 约 2000 mL）。
 * 结果按 50 mL 取整，并夹在 1500–4000 之间：
 *   · 下限：低于 1.5 L 对成年人普遍偏少，不该被建议出来；
 *   · 上限：4 L 以上对健康人没有必要，喝多了反而有低钠风险。
 *
 * 体重缺失（还没记过）时用 1800 mL —— 中国居民膳食指南的成人下限。
 */
export function defaultWaterGoalMl(weightKg: number | null | undefined): number {
  const base = weightKg && Number.isFinite(weightKg) && weightKg > 0 ? weightKg * 33 : 1800;
  const rounded = Math.round(base / 50) * 50;
  return Math.min(4000, Math.max(1500, rounded));
}

/**
 * 把毫升变成人看的字符串。
 *   formatWater(1800) → "1.8 L"
 *   formatWater(2000) → "2 L"
 *   formatWater(800)  → "800 mL"
 *   formatWater(0)    → "0 mL"
 */
export function formatWater(ml: number): string {
  const value = Math.max(0, Math.round(ml));
  if (value < 1000) return `${value} mL`;
  const liters = (value / 1000).toFixed(2).replace(/\.?0+$/, '');
  return `${liters} L`;
}

/** 进度百分比（0–100 的整数），用于进度条宽度。 */
export function waterPercent(totalMl: number, goalMl: number): number {
  if (!Number.isFinite(goalMl) || goalMl <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((totalMl / goalMl) * 100)));
}

/** 还差多少（mL），喝够了返回 0。 */
export function waterRemainingMl(totalMl: number, goalMl: number): number {
  return Math.max(0, Math.round(goalMl - totalMl));
}
