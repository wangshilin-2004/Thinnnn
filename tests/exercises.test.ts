import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  BODY_PARTS,
  CARDIO_ACTIVITIES,
  EXERCISES,
  exercisesOfPart,
  findCardio,
  findExercise,
} from '../src/content/exercises.ts';

/* 动作库是「内容 + 图片」两半，最容易出的错不是逻辑错，而是
 * 「加了动作但忘了放图」—— 线上表现是一张空白卡片，本地不报任何错。
 * 这个测试把这条不变式固定下来：目录里每一条都必须有两张图。
 *
 * 顺带守住几条更基本的东西：id 不能重复（重复会让 key 冲突、
 * 查找函数返回错的那个）、四个部位都要有动作、肌肉数组不能空
 *（空了人体图上什么都不亮，等于白搭）。
 */

const IMAGE_ROOT = join(process.cwd(), 'public', 'exercises');

test('无氧动作：id 不重复', () => {
  const ids = EXERCISES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, '有重复的 id');
});

test('有氧项目：id 不重复', () => {
  const ids = CARDIO_ACTIVITIES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length, '有重复的 id');
});

test('每个无氧动作都有两张演示图', () => {
  const missing: string[] = [];
  for (const exercise of EXERCISES) {
    for (const frame of ['0.webp', '1.webp']) {
      const path = join(IMAGE_ROOT, exercise.id, frame);
      if (!existsSync(path)) missing.push(`${exercise.id}/${frame}`);
    }
  }
  assert.deepEqual(missing, [], `缺少图片：${missing.join('、')}`);
});

test('每个有氧项目都有两张演示图', () => {
  const missing: string[] = [];
  for (const activity of CARDIO_ACTIVITIES) {
    for (const frame of ['0.webp', '1.webp']) {
      const path = join(IMAGE_ROOT, activity.id, frame);
      if (!existsSync(path)) missing.push(`${activity.id}/${frame}`);
    }
  }
  assert.deepEqual(missing, [], `缺少图片：${missing.join('、')}`);
});

test('四个部位都有动作，且每条都挂在合法的部位上', () => {
  for (const part of BODY_PARTS) {
    assert.ok(
      exercisesOfPart(part).length >= 6,
      `「${part}」只有 ${exercisesOfPart(part).length} 个动作，太少了`,
    );
  }
  for (const exercise of EXERCISES) {
    assert.ok(BODY_PARTS.includes(exercise.part), `${exercise.id} 的部位非法`);
  }
});

test('每条动作的肌肉、要领都是完整的', () => {
  for (const exercise of EXERCISES) {
    assert.ok(exercise.muscles.length > 0, `${exercise.id} 没有主要肌群`);
    /* 次要肌群**允许为空**：侧平举、腿屈伸、提踵这类孤立动作本来就只练一块，
     * 原始数据集里 secondaryMuscles 就是空数组。硬要填空只会逼出假数据。
     * 这里只要求它是个数组 —— undefined 会让人体图那段 .length 直接抛错。 */
    assert.ok(Array.isArray(exercise.secondary), `${exercise.id} 的次要肌群不是数组`);
    assert.ok(exercise.primary.length > 0, `${exercise.id} 没有中文肌群名`);
    assert.ok(exercise.name.length > 0, `${exercise.id} 没有中文名`);
    assert.ok(exercise.tips[0].length > 0, `${exercise.id} 缺少要领`);
    assert.ok(exercise.tips[1].length > 0, `${exercise.id} 缺少常见错误`);
  }
  for (const activity of CARDIO_ACTIVITIES) {
    assert.ok(activity.tips[0].length > 0, `${activity.id} 缺少要领`);
    assert.ok(activity.tips[1].length > 0, `${activity.id} 缺少常见错误`);
  }
});

test('按 id 能找到对应的动作 / 有氧，找不到时返回 undefined', () => {
  const first = EXERCISES[0];
  assert.equal(findExercise(first.id)?.name, first.name);
  assert.equal(findExercise('不存在的动作'), undefined);

  const cardio = CARDIO_ACTIVITIES[0];
  assert.equal(findCardio(cardio.id)?.name, cardio.name);
  assert.equal(findCardio('不存在的项目'), undefined);
});
