import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultWaterGoalMl, formatWater, MAX_SINGLE_ML, QUICK_ADDS, waterPercent, waterRemainingMl } from '../src/lib/water.ts';

/* 喝水的纯计算。重点不是「函数跑得通」，而是三条口径：
 *   1. 没设目标时按体重估，且不会算出离谱的数；
 *   2. 显示永远 ≤ 2 位小数个位数单位（1.8 L / 800 mL）；
 *   3. 百分比夹在 0–100，喝超了也不爆表。 */

test('defaultWaterGoalMl：按 33 mL/kg 估算并取整到 50', () => {
  assert.equal(defaultWaterGoalMl(60), 2000); // 1980 → 2000
  assert.equal(defaultWaterGoalMl(55), 1800); // 1815 → 1800
  assert.equal(defaultWaterGoalMl(80), 2650); // 2640 → 2650
});

test('defaultWaterGoalMl：体重缺失或异常时用 1800 mL 兜底', () => {
  assert.equal(defaultWaterGoalMl(null), 1800);
  assert.equal(defaultWaterGoalMl(undefined), 1800);
  assert.equal(defaultWaterGoalMl(0), 1800);
  assert.equal(defaultWaterGoalMl(Number.NaN), 1800);
});

test('defaultWaterGoalMl：夹在 1500–4000 之间', () => {
  assert.equal(defaultWaterGoalMl(20), 1500); // 660 → 下限
  assert.equal(defaultWaterGoalMl(200), 4000); // 6600 → 上限
});

test('formatWater：小于 1 L 用 mL，大于等于 1 L 用 L', () => {
  assert.equal(formatWater(0), '0 mL');
  assert.equal(formatWater(250), '250 mL');
  assert.equal(formatWater(999), '999 mL');
  assert.equal(formatWater(1000), '1 L');
  assert.equal(formatWater(1800), '1.8 L');
  assert.equal(formatWater(2250), '2.25 L');
  assert.equal(formatWater(2000), '2 L');
});

test('formatWater：负数当成 0（脏数据不该显示成 -100 mL）', () => {
  assert.equal(formatWater(-100), '0 mL');
});

test('waterPercent：夹在 0–100', () => {
  assert.equal(waterPercent(0, 2000), 0);
  assert.equal(waterPercent(1000, 2000), 50);
  assert.equal(waterPercent(2500, 2000), 100);
  assert.equal(waterPercent(500, 0), 0); // 目标为 0 不除零
});

test('waterRemainingMl：喝够返回 0，不返回负数', () => {
  assert.equal(waterRemainingMl(800, 2000), 1200);
  assert.equal(waterRemainingMl(2000, 2000), 0);
  assert.equal(waterRemainingMl(2500, 2000), 0);
});

test('快捷按钮与单次上限是常量，改它们要同时改数据库 CHECK', () => {
  assert.deepEqual([...QUICK_ADDS], [250, 500]);
  assert.equal(MAX_SINGLE_ML, 3000);
});
