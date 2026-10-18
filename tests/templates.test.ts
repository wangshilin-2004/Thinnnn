import test from 'node:test';
import assert from 'node:assert/strict';
import { PLANS, estimateMinutes, planExercises } from '../src/content/templates.ts';

test('推荐方案的 id 不重复', () => {
  const ids = PLANS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('每个方案都能从动作库里取到足够的动作', () => {
  for (const plan of PLANS) {
    assert.equal(planExercises(plan).length, plan.size, `${plan.name} 动作不够`);
  }
});

test('预计时长是正数，且在合理区间', () => {
  for (const plan of PLANS) {
    const m = estimateMinutes(plan);
    assert.ok(m > 10 && m < 180, `${plan.name} 预计 ${m} 分钟不合理`);
  }
});

test('四个部位都有方案', () => {
  for (const part of ['胸', '肩', '背', '腿'] as const) {
    assert.ok(PLANS.some((p) => p.part === part), `${part} 没有方案`);
  }
});
