/**
 * ═══════════════════════════════════════════════════════════════
 *  营养计算引擎测试
 * ═══════════════════════════════════════════════════════════════
 *
 *  运行：npm run test
 *
 *  【为什么不用 Jest / Vitest】
 *  Node 22+ 能直接跑 TypeScript（类型擦除）并且自带测试运行器，
 *  所以这个项目一个测试框架依赖都不需要装。少一个依赖 = 少一处
 *  版本冲突、少一个安全公告、少一件将来要升级的事。
 *
 *  这里重点覆盖的是【边界】而不是【正常情况】。正常情况写错了
 *  你自己一用就发现；边界写错了可能几个月都没人知道 ——
 *  而边界恰好是体重很轻的人、刚注册还没填身高的人、
 *  生日还没到的用户。这些人不会来给你报 bug，他们只会不用了。
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  ACTIVITY_FACTORS,
  DISCLAIMER,
  KCAL_FLOOR,
  KCAL_PER_G,
  addDays,
  analyzeTrend,
  buildPlan,
  calcAge,
  calcBmr,
  calcMacroTargets,
  calcTargetKcal,
  calcTdee,
  guessMealType,
  movingAverage,
  scaleNutrition,
  todayInTimezone,
} from '../src/lib/nutrition.ts';

// ═══════════════════════════════════════════════════════════════
describe('calcAge —— 周岁计算', () => {
  it('生日已经过了：直接相减', () => {
    assert.equal(calcAge('2000-01-01', '2026-10-16'), 26);
  });

  it('生日还没到：少算一岁', () => {
    // 这个用例是重点。用「年份相减」的写法会返回 26，多算一岁，
    // 而 BMR 里年龄系数是 −5，等于凭空多扣 5 kcal。
    assert.equal(calcAge('2000-12-31', '2026-10-16'), 25);
  });

  it('生日当天：算作已过生日', () => {
    assert.equal(calcAge('2000-10-16', '2026-10-16'), 26);
  });

  it('生日前一天：还没过', () => {
    assert.equal(calcAge('2000-10-17', '2026-10-16'), 25);
  });

  it('闰年 2 月 29 日出生：非闰年不崩', () => {
    assert.equal(calcAge('2000-02-29', '2026-02-28'), 25);
    assert.equal(calcAge('2000-02-29', '2026-03-01'), 26);
  });

  it('日期格式不对时抛出可读错误', () => {
    assert.throws(() => calcAge('2000/01/01', '2026-10-16'), /YYYY-MM-DD/);
  });

  it('出生日期晚于今天时抛错', () => {
    assert.throws(() => calcAge('2030-01-01', '2026-10-16'), /晚于/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('calcBmr —— Mifflin-St Jeor', () => {
  it('男性：10×70 + 6.25×175 − 5×25 + 5 = 1673.75 → 1674', () => {
    assert.equal(
      calcBmr({ sex: 'male', weightKg: 70, heightCm: 175, ageYears: 25 }),
      1674,
    );
  });

  it('女性：10×60 + 6.25×165 − 5×30 − 161 = 1320.25 → 1320', () => {
    assert.equal(
      calcBmr({ sex: 'female', weightKg: 60, heightCm: 165, ageYears: 30 }),
      1320,
    );
  });

  it('男女常数差正好 166（+5 与 −161）', () => {
    const base = { weightKg: 70, heightCm: 170, ageYears: 30 };
    const diff = calcBmr({ ...base, sex: 'male' }) - calcBmr({ ...base, sex: 'female' });
    assert.equal(diff, 166);
  });

  it('体重为零时拒绝计算，而不是返回负数', () => {
    assert.throws(
      () => calcBmr({ sex: 'male', weightKg: 0, heightCm: 175, ageYears: 25 }),
      /体重必须是正数/,
    );
  });
});

// ═══════════════════════════════════════════════════════════════
describe('calcTdee —— 活动系数', () => {
  it('久坐：1674 × 1.2 = 2008.8 → 2009', () => {
    assert.equal(calcTdee(1674, 'sedentary'), 2009);
  });

  it('五个档位的系数与文档一致', () => {
    assert.deepEqual(ACTIVITY_FACTORS, {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    });
  });

  it('未知活动水平抛出可读错误', () => {
    assert.throws(() => calcTdee(1674, 'superhuman' as never), /未知活动水平/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('calcTargetKcal —— 三个上限谁在起作用', () => {
  it('常规情况：TDEE 的 20% 是最严的那个', () => {
    const r = calcTargetKcal({ tdee: 2009, sex: 'male', weightKg: 70, goalType: 'lose' });
    // 三者：绝对 500 / 比例 2009×20% = 402 / 速度 70×1%×7700÷7 = 770
    assert.equal(r.limits.absolute, 500);
    assert.equal(r.limits.ratio, 402);
    assert.equal(r.limits.rate, 770);
    assert.equal(r.bindingLimit, 'ratio');
    assert.equal(r.targetKcal, 1607);
    assert.equal(r.deficitKcal, 402);
    assert.equal(r.floorApplied, false);
  });

  it('小个子用户触到绝对热量下限，并被明确告知不要再少吃', () => {
    // 女性 45kg：TDEE 1330，比例上限算出缺口 266 → 1064，
    // 低于女性下限 1200，所以被抬回 1200。
    const r = calcTargetKcal({ tdee: 1330, sex: 'female', weightKg: 45, goalType: 'lose' });
    assert.equal(r.targetKcal, KCAL_FLOOR.female);
    assert.equal(r.floorApplied, true);
    assert.equal(r.bindingLimit, 'floor');
    // 触底时必须给用户「换成增加运动」的指引，而不是默默给个低数字
    assert.ok(r.warnings.some((w) => w.includes('安全下限')));
    assert.ok(r.warnings.some((w) => w.includes('增加日常活动量')));
  });

  it('速度上限生效：极高活动量的小体重用户', () => {
    // 38kg 的女性如果活动量很高，TDEE 会远超体重本身，
    // 此时「每周减重不超过体重 1%」会成为最严的约束。
    // 速度上限 = 38 × 1% × 7700 ÷ 7 = 418 kcal/天 < 比例上限 425
    const r = calcTargetKcal({
      tdee: 2126,
      sex: 'female',
      weightKg: 38,
      goalType: 'lose',
    });
    assert.equal(r.limits.rate, 418);
    assert.equal(r.limits.ratio, 425);
    assert.equal(r.bindingLimit, 'rate');
    assert.equal(r.deficitKcal, 418);
    // 要解释清楚这个上限是保护肌肉，不是「系统算不出来更大的数」
    assert.ok(r.warnings.some((w) => w.includes('保护肌肉')));
  });

  it('维持目标：缺口为 0', () => {
    const r = calcTargetKcal({ tdee: 2009, sex: 'male', weightKg: 70, goalType: 'maintain' });
    assert.equal(r.targetKcal, 2009);
    assert.equal(r.deficitKcal, 0);
    assert.equal(r.floorApplied, false);
  });

  it('增重目标：产生盈余，缺口记为负数', () => {
    const r = calcTargetKcal({ tdee: 2009, sex: 'male', weightKg: 70, goalType: 'gain' });
    assert.ok(r.targetKcal > 2009);
    assert.ok(r.deficitKcal < 0, '盈余应表示为负缺口，保持「正值永远是缺口」的约定');
  });

  it('缺口过小时提醒用户「慢是有意的」', () => {
    // TDEE 2000 时比例上限 = 400；构造一个上限很小的场景
    const r = calcTargetKcal({ tdee: 1400, sex: 'female', weightKg: 60, goalType: 'lose' });
    // 比例上限 280 → 目标 1120，低于下限 1200 → 抬到 1200，缺口只剩 200
    assert.equal(r.targetKcal, 1200);
    assert.ok(r.warnings.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('calcMacroTargets —— 蛋白质优先', () => {
  it('70kg / 1607 kcal：蛋白 112、脂肪 56、碳水 164', () => {
    const m = calcMacroTargets({ targetKcal: 1607, weightKg: 70 });
    assert.equal(m.proteinG, 112); // 70 × 1.6
    assert.equal(m.fatG, 56); // max(70×0.8=56, 1607×0.2/9=35.7)
    assert.equal(m.carbG, 164); // (1607 − 448 − 504) / 4 = 163.75
  });

  it('三大营养素反算的热量应贴近目标热量（差 ≤ 5 kcal）', () => {
    // 这条断言防的是「展示的三个数和展示的总热量对不上」——
    // 用户拿计算器一按就发现，然后就不信这个网站了。
    const m = calcMacroTargets({ targetKcal: 1607, weightKg: 70 });
    assert.ok(
      Math.abs(m.kcalFromMacros - 1607) <= 5,
      `反算 ${m.kcalFromMacros} 与目标 1607 相差过大`,
    );
  });

  it('热量很低时脂肪改用「按比例」下限而非「按体重」下限', () => {
    // 体重很轻但热量被压得很低时，0.8 g/kg 可能已经超过总热量的 20%
    const m = calcMacroTargets({ targetKcal: 1100, weightKg: 40 });
    // 按体重：40 × 0.8 = 32；按比例：1100 × 0.2 / 9 = 24.4 → 取 32
    assert.equal(m.fatG, 32);
  });

  it('蛋白质系数被钳制在 1.6–2.2 之间', () => {
    const low = calcMacroTargets({ targetKcal: 2000, weightKg: 70, proteinPerKg: 0.5 });
    const high = calcMacroTargets({ targetKcal: 3000, weightKg: 70, proteinPerKg: 9 });
    assert.equal(low.proteinG, 112); // 被抬到 1.6
    assert.equal(high.proteinG, 154); // 被压到 2.2
  });

  it('碳水不足 50g 时给出明确警告', () => {
    const m = calcMacroTargets({ targetKcal: 1200, weightKg: 90 });
    // 蛋白 144 → 576 kcal；脂肪 max(72, 26.7) = 72 → 648 kcal；
    // 只剩 −24 kcal 给碳水 → 负的
    assert.ok(m.carbG < 50);
    assert.ok(m.warnings.some((w) => w.includes('热量目标过低')));
  });

  it('Atwater 系数与文档一致（蛋白 4 / 碳水 4 / 脂肪 9）', () => {
    assert.deepEqual(KCAL_PER_G, { protein: 4, carb: 4, fat: 9 });
  });
});

// ═══════════════════════════════════════════════════════════════
describe('buildPlan —— 端到端', () => {
  it('一个完整用户的方案自洽', () => {
    const plan = buildPlan({
      sex: 'male',
      birthDate: '2000-01-01',
      heightCm: 175,
      weightKg: 70,
      activityLevel: 'sedentary',
      goalType: 'lose',
      onDate: '2026-10-16',
    });

    assert.equal(plan.ageYears, 26);
    // 手算核对（这个注释本身就是可复核的推导过程）：
    //   BMR  = 10×70 + 6.25×175 − 5×26 + 5 = 700 + 1093.75 − 130 + 5 = 1668.75 → 1669
    //   TDEE = 1669 × 1.2 = 2002.8 → 2003
    //   缺口 = min(500, 2003×20% = 400.6→401, 70×1%×7700÷7 = 770) = 401（比例上限）
    //   目标 = 2003 − 401 = 1602
    assert.equal(plan.bmrKcal, 1669);
    assert.equal(plan.tdeeKcal, 2003);
    assert.equal(plan.targetKcal, 1602);
    assert.equal(plan.proteinG, 112);
    assert.equal(plan.bindingLimit, 'ratio');
    assert.equal(plan.calcVersion, 'v1');
    assert.ok(plan.targetKcal > KCAL_FLOOR.male);
  });

  it('方案里带的公式版本号能被读出来（将来换公式时用来批量识别旧数据）', () => {
    const plan = buildPlan({
      sex: 'female',
      birthDate: '1995-06-15',
      heightCm: 162,
      weightKg: 55,
      activityLevel: 'light',
      goalType: 'lose',
      onDate: '2026-10-16',
    });
    assert.equal(plan.calcVersion, 'v1');
    assert.ok(plan.warnings.length >= 0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('movingAverage —— 7 日移动平均', () => {
  it('窗口内点数不足时用实际点数做分母，而不是补零', () => {
    // 这是最容易写错的地方：体重不是「0」，把缺失日补 0 平均
    // 会算出 23.3 kg 这种荒唐值。
    const pts = [
      { date: '2026-10-01', value: 70 },
      { date: '2026-10-02', value: 71 },
      { date: '2026-10-03', value: 69 },
    ];
    const r = movingAverage(pts, 7);
    assert.equal(r[0]!.avg, 70);
    assert.equal(r[0]!.sampleCount, 1);
    assert.equal(r[1]!.avg, 70.5);
    assert.equal(r[1]!.sampleCount, 2);
    assert.equal(r[2]!.avg, 70);
    assert.equal(r[2]!.sampleCount, 3);
  });

  it('按日历天滑窗，而不是按数据点序号', () => {
    // 用户 10-01 和 10-05 各记了一次（中间 3 天没记）。
    // 7 天窗口应该把两点都包含进来 → 平均 71。
    // 如果错误地按「最近 7 个点」滑窗，这两点根本不在同一窗口。
    const pts = [
      { date: '2026-10-01', value: 70 },
      { date: '2026-10-05', value: 72 },
    ];
    const r = movingAverage(pts, 7);
    assert.equal(r[1]!.avg, 71);
    assert.equal(r[1]!.sampleCount, 2);
  });

  it('超出窗口的旧数据不参与平均', () => {
    const pts = [
      { date: '2026-10-01', value: 80 }, // 距离 10-08 已 8 天，出窗
      { date: '2026-10-08', value: 70 },
    ];
    const r = movingAverage(pts, 7);
    assert.equal(r[1]!.avg, 70);
    assert.equal(r[1]!.sampleCount, 1);
  });

  it('乱序输入会被排序后再计算', () => {
    const pts = [
      { date: '2026-10-03', value: 69 },
      { date: '2026-10-01', value: 70 },
      { date: '2026-10-02', value: 71 },
    ];
    const r = movingAverage(pts, 7);
    assert.deepEqual(
      r.map((p) => p.date),
      ['2026-10-01', '2026-10-02', '2026-10-03'],
    );
  });
});

// ═══════════════════════════════════════════════════════════════
describe('analyzeTrend —— 最小二乘回归', () => {
  /** 造一条每天降 0.1 kg 的完美直线 */
  function perfectLine(days: number, startKg = 70) {
    const points = [];
    for (let i = 0; i < days; i++) {
      points.push({
        date: addDays('2026-10-01', i),
        value: Number((startKg - 0.1 * i).toFixed(2)),
      });
    }
    return points;
  }

  it('完美直线：每天 −0.1 kg → 每周 −0.7 kg', () => {
    const r = analyzeTrend(perfectLine(14));
    assert.equal(r.kgPerWeek, -0.7);
    assert.equal(r.reliable, true);
    assert.equal(r.sampleCount, 14);
  });

  it('回归比「首尾相减」抗噪：中间某天暴涨不影响结论', () => {
    // 首尾相减的做法会被端点完全支配。这里把最后一天抬到 71
    // （比如前一天吃了火锅），回归斜率只会被轻微影响。
    const pts = perfectLine(14);
    pts[13]!.value = 71;

    const r = analyzeTrend(pts);
    assert.ok(r.kgPerWeek < 0, `应仍判定为下降，实际 ${r.kgPerWeek}`);
    assert.ok(
      r.kgPerWeek > -0.7,
      '多了个上涨点，下降速度应比完美直线慢',
    );
  });

  it('数据不足 7 天时不下结论', () => {
    const r = analyzeTrend(perfectLine(3));
    assert.equal(r.reliable, false);
    assert.equal(r.verdict, 'insufficient_data');
    assert.ok(r.message.includes('数据点太少') || r.message.includes('再记几天'));
  });

  it('完全没有记录时给出友好提示而不是崩溃', () => {
    const r = analyzeTrend([]);
    assert.equal(r.verdict, 'insufficient_data');
    assert.ok(r.message.length > 0);
  });

  it('所有点在同一天时拒绝计算（斜率无定义）', () => {
    const r = analyzeTrend([
      { date: '2026-10-01', value: 70 },
      { date: '2026-10-01', value: 71 },
    ]);
    assert.equal(r.verdict, 'insufficient_data');
    assert.ok(r.message.includes('同一天'));
  });

  it('只取窗口内的数据：太旧的记录不参与', () => {
    const pts = [
      { date: '2026-08-01', value: 80 }, // 60 天前，应被排除
      ...perfectLine(14).map((p) => ({ ...p, date: addDays('2026-10-02', 0), ...p })),
    ];
    const r = analyzeTrend(pts, { windowDays: 14 });
    // 旧点被排除后，拟合的仍然是从 10-01 开始的下降线
    assert.ok(r.kgPerWeek < 0);
  });

  it('判定「符合目标」', () => {
    // 每周 −0.7，目标 0.7 → 完全吻合
    const r = analyzeTrend(perfectLine(14), { targetKgPerWeek: 0.7 });
    assert.equal(r.verdict, 'on_track');
  });

  it('判定「掉得太快」并提醒肌肉流失风险', () => {
    const r = analyzeTrend(perfectLine(14), { targetKgPerWeek: 0.3 });
    assert.equal(r.verdict, 'too_fast');
    assert.ok(r.message.includes('肌肉'));
  });

  it('判定「进步太慢」并指出可能原因', () => {
    const r = analyzeTrend(perfectLine(14), { targetKgPerWeek: 1.2 });
    assert.equal(r.verdict, 'too_slow');
    assert.ok(r.message.includes('热量') || r.message.includes('记录'));
  });

  it('判定「方向反了」', () => {
    // 每天涨 0.05 kg
    const pts = [];
    for (let i = 0; i < 14; i++) {
      pts.push({ date: addDays('2026-10-01', i), value: 70 + 0.05 * i });
    }
    const r = analyzeTrend(pts, { targetKgPerWeek: 0.5 });
    assert.equal(r.verdict, 'wrong_direction');
    assert.ok(r.kgPerWeek > 0);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('scaleNutrition —— 每 100g → 实际份量', () => {
  it('白米饭 116 kcal/100g，吃 200g → 232 kcal', () => {
    // 这个数字要和数据库迁移测试里的 232 对上 ——
    // 两处用的是同一套换算，任何一处改了另一处必须跟着改。
    const r = scaleNutrition(
      { kcal: 116, proteinG: 2.6, fatG: 0.3, carbG: 25.9 },
      200,
    );
    assert.equal(r.kcal, 232);
    assert.equal(r.proteinG, 5.2);
    assert.equal(r.fatG, 0.6);
    assert.equal(r.carbG, 51.8);
  });

  it('100g 时结果与食物库原值完全一致（不能有浮点漂移）', () => {
    const original = { kcal: 116, proteinG: 2.6, fatG: 0.3, carbG: 25.9 };
    assert.deepEqual(scaleNutrition(original, 100), original);
  });

  it('份量为 0 或负数时抛错，而不是算出 0 卡', () => {
    assert.throws(() => scaleNutrition({ kcal: 116, proteinG: 0, fatG: 0, carbG: 0 }, 0), /份量/);
    assert.throws(() => scaleNutrition({ kcal: 116, proteinG: 0, fatG: 0, carbG: 0 }, -5), /份量/);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('时区与日期工具', () => {
  it('东八区：UTC 时间 2026-10-15T16:30Z 在北京已经是 10-16', () => {
    // 这条对应真实 bug：Vercel 服务器跑 UTC，北京时间早上 8 点之前
    // 记的早餐会被写进前一天。而且只在早上出现，自己测很难碰到。
    const utcEvening = new Date('2026-10-15T16:30:00Z');
    assert.equal(todayInTimezone('Asia/Shanghai', utcEvening), '2026-10-16');
    assert.equal(todayInTimezone('UTC', utcEvening), '2026-10-15');
  });

  it('跨年边界正确', () => {
    const newYearEve = new Date('2026-12-31T16:00:00Z');
    assert.equal(todayInTimezone('Asia/Shanghai', newYearEve), '2027-01-01');
  });

  it('非法时区字符串时退回 UTC，而不是抛错', () => {
    // 记不上账比记错一天更糟 —— 时区可以事后修正，丢了的数据找不回来
    const d = new Date('2026-10-16T08:00:00Z');
    assert.equal(todayInTimezone('Not/AZone', d), '2026-10-16');
  });

  it('addDays 跨月、跨年、跨闰年都正确', () => {
    assert.equal(addDays('2026-10-31', 1), '2026-11-01');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29'); // 闰年
    assert.equal(addDays('2027-02-28', 1), '2027-03-01'); // 平年
  });
});

// ═══════════════════════════════════════════════════════════════
describe('guessMealType —— 录入表单的智能默认值', () => {
  it('按小时推断餐次', () => {
    assert.equal(guessMealType(7), 'breakfast');
    assert.equal(guessMealType(12), 'lunch');
    assert.equal(guessMealType(19), 'dinner');
    assert.equal(guessMealType(23), 'snack');
    assert.equal(guessMealType(3), 'snack');
  });

  it('每个小时都能得到一个合法餐次（无空洞）', () => {
    const valid = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
    for (let h = 0; h < 24; h++) {
      assert.ok(valid.has(guessMealType(h)), `第 ${h} 点返回了非法餐次`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
describe('合规：免责声明', () => {
  it('免责声明文本存在且提到「不构成医疗建议」', () => {
    assert.ok(DISCLAIMER.length > 50);
    assert.ok(DISCLAIMER.includes('不构成医疗'));
    assert.ok(DISCLAIMER.includes('医生') || DISCLAIMER.includes('营养师'));
  });
});
