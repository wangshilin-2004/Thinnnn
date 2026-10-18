import { exercisesOfPart, type BodyPart, type Exercise } from './exercises.ts';

/* 推荐方案。
 *
 * 为什么不手写一份「硬拉 + 划船 + 引体」的课程表：
 *   动作 id 是数据集里的字符串，手写极容易打错一个字 —— 打错的后果是
 *   点开训练发现某个动作是空的。这里改成「按动作库顺序取前 N 个」，
 *   动作库本身已经把复合动作排在前面（我写那个文件时就是按这个顺序挑的），
 *   所以取前 5 个天然就是「先大重量复合、再孤立」的合理顺序。
 *
 * 预计时长怎么算：每组按 35 秒实际做功 + 组间休息，最后加 5 分钟热身。
 * 这是估算，不是承诺 —— 卡片上写「约」。
 */
export type Plan = {
  id: string;
  part: BodyPart;
  name: string;
  subtitle: string;
  size: number;
  sets: number;
  reps: number;
  rest: number;
};

export const PLANS: Plan[] = [
  { id: 'chest-basic', part: '胸', name: '胸 · 基础', subtitle: '卧推打头，先推再夹', size: 5, sets: 4, reps: 8, rest: 120 },
  { id: 'shoulder-basic', part: '肩', name: '肩 · 基础', subtitle: '推举 + 侧平举', size: 5, sets: 3, reps: 12, rest: 90 },
  { id: 'back-basic', part: '背', name: '背 · 基础', subtitle: '硬拉打头，再做划船', size: 5, sets: 4, reps: 8, rest: 150 },
  { id: 'leg-basic', part: '腿', name: '腿 · 基础', subtitle: '深蹲打头，股四股二都练', size: 5, sets: 4, reps: 8, rest: 180 },
];

export function planExercises(plan: Plan): Exercise[] {
  return exercisesOfPart(plan.part).slice(0, plan.size);
}

export function estimateMinutes(plan: Plan): number {
  const perSet = Math.round((plan.rest + 35) / 60);
  return plan.size * plan.sets * perSet + 5;
}

export function findPlan(id: string): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}
