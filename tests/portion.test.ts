/**
 * ═══════════════════════════════════════════════════════════════
 *  份量文案测试
 * ═══════════════════════════════════════════════════════════════
 *
 *  运行：npm run test
 *
 *  这个模块的存在理由是「标签会撒谎」：`meal_items.serving_label`
 *  存的是「1碗」，而克数是可以改的。改完 300 g 还显示「1碗」，
 *  用户会以为自己记错了。
 *
 *  所以这里重点测三件事：
 *    1. 份数换算对不对（含半个、含浮点）
 *    2. 换算不出来的时候**退回克数**，而不是硬编一个假份数
 *    3. 除零、负数、空值不会崩，也不会输出 NaN
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { portionStep, portionText, scaleLabel } from '../src/lib/portion.ts';

// ═══════════════════════════════════════════════════════════════
describe('scaleLabel：把「1碗」按倍数改写', () => {
  it('整数倍', () => {
    assert.equal(scaleLabel('1碗', 2), '2碗');
    assert.equal(scaleLabel('5块', 2), '10块');
  });

  it('半个', () => {
    assert.equal(scaleLabel('1碗', 0.5), '0.5碗');
    assert.equal(scaleLabel('5块', 0.5), '2.5块');
  });

  it('小数倍不会输出一长串小数', () => {
    // 0.1 + 0.2 那类误差如果漏出去，界面会出现「1.5000000000000002小把」
    assert.equal(scaleLabel('1小把', 1.5), '1.5小把');
    assert.equal(scaleLabel('1碗', 3), '3碗');
    assert.equal(scaleLabel('1份', 2), '2份');
  });

  it('数字后缀不是「第几个」而是单位的一部分', () => {
    // 「1小盒」拆出来是 1 + "小盒"，不能把「小盒」当数字处理
    assert.equal(scaleLabel('1小盒', 2), '2小盒');
  });

  it('没有数字前缀的标签退回「N × 标签」而不是猜', () => {
    assert.equal(scaleLabel('适量', 2), '2 × 适量');
    assert.equal(scaleLabel('一份', 3), '3 × 一份');
  });

  it('标签前后有空格也能认出来', () => {
    assert.equal(scaleLabel(' 1碗 ', 2), '2碗');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('portionText：一行份量显示什么', () => {
  it('正好一份就显示标签本身', () => {
    assert.equal(portionText({ quantityG: 150, servingGrams: 150, servingLabel: '1碗' }), '1碗');
  });

  it('改了份量之后标签跟着变 —— 这是这个模块存在的唯一理由', () => {
    assert.equal(portionText({ quantityG: 300, servingGrams: 150, servingLabel: '1碗' }), '2碗');
    assert.equal(portionText({ quantityG: 75, servingGrams: 150, servingLabel: '1碗' }), '0.5碗');
  });

  it('浮点误差不会被放大成「2.9999999999999996碗」', () => {
    // 450 / 150 在某些实现下会算出 2.9999999999999996
    assert.equal(portionText({ quantityG: 450, servingGrams: 150, servingLabel: '1碗' }), '3碗');
    assert.equal(portionText({ quantityG: 450.0000001, servingGrams: 150, servingLabel: '1碗' }), '3碗');
  });

  it('份数不是半的整数倍时退回克数 —— 没人说「0.33碗」', () => {
    assert.equal(portionText({ quantityG: 50, servingGrams: 150, servingLabel: '1碗' }), '50 g');
    assert.equal(portionText({ quantityG: 100, servingGrams: 150, servingLabel: '1碗' }), '100 g');
  });

  it('没有份量信息就显示克数', () => {
    assert.equal(portionText({ quantityG: 150, servingGrams: null, servingLabel: '1碗' }), '150 g');
    assert.equal(portionText({ quantityG: 150, servingGrams: 150, servingLabel: null }), '150 g');
  });

  it('servingGrams 为 0 不除零', () => {
    // 数据库 numeric 能存 0，JOIN 出来就是 0，直接除会得到 Infinity
    const t = portionText({ quantityG: 150, servingGrams: 0, servingLabel: '1碗' });
    assert.equal(t, '150 g');
    assert.ok(!t.includes('Infinity') && !t.includes('NaN'));
  });

  it('克数取整到整数，但 0.5 级别的份量不受影响', () => {
    assert.equal(portionText({ quantityG: 149.7, servingGrams: null, servingLabel: null }), '150 g');
    assert.equal(portionText({ quantityG: 74.6, servingGrams: 150, servingLabel: '1碗' }), '75 g');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('portionStep：加减一下走多少克', () => {
  it('有份量时走半份', () => {
    assert.equal(portionStep(150), 75);
    assert.equal(portionStep(300), 150);
  });

  it('没有份量时走 50 g', () => {
    assert.equal(portionStep(null), 50);
    assert.equal(portionStep(0), 50);
  });

  it('步长至少 1 g —— 数据库里出现过 1 g 的份量（「1小勺盐」）', () => {
    assert.equal(portionStep(1), 1);
    assert.equal(portionStep(0.5), 1);
  });
});
