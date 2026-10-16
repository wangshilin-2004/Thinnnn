/**
 * ═══════════════════════════════════════════════════════════════
 *  营养与热量计算引擎
 * ═══════════════════════════════════════════════════════════════
 *
 *  设计依据：research/04-营养计算依据.md（每个公式都有出处）
 *
 *  【为什么单独抽成一个模块】
 *  这里是整个产品唯一涉及「健康建议」的地方。把它写成一组纯函数
 *  （输入 → 输出，不碰数据库、不碰 React、不读环境变量）带来三个好处：
 *
 *    1. 可测试。健康相关的数字算错了是会真出事的，
 *       而纯函数可以用几百个用例把边界全部钉死。
 *    2. 可替换。公式会演进（Mifflin-St Jeor 未必永远是最好选择），
 *       换公式只改这一个文件，UI 和数据库都不用动。
 *       profiles.calc_version 列就是为这一天准备的。
 *    3. 可讲解。没有框架噪音，每行都是营养学而不是 React。
 *
 *  【一条纪律】
 *  这个文件里【不允许出现魔法数字】。每个常数都必须能追溯到
 *  research/04 里的某一节或某条引用。做不到的，就标注为 PRODUCT_DEFAULT
 *  并写清楚「这是产品拍的决定，不是科学结论」—— 两者绝不能混淆。
 */

// ═══════════════════════════════════════════════════════════════
//  类型
// ═══════════════════════════════════════════════════════════════

export type Sex = 'male' | 'female';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type GoalType = 'lose' | 'maintain' | 'gain';

/** 公式版本号。写进 profiles.calc_version，将来能批量找出旧公式算的目标。 */
export const CALC_VERSION = 'v1';

// ═══════════════════════════════════════════════════════════════
//  常数表
// ═══════════════════════════════════════════════════════════════

/**
 * 活动系数（research/04 §2）。
 *
 * 注意文档里那条产品提示：学术界普遍认为这些系数会【高估】真实 TDEE。
 * 所以默认值是 sedentary（1.2），而且 UI 上要说明
 * 「如果两周后体重没变化，说明 TDEE 估高了，系统会用你的实测数据修正」。
 */
export const ACTIVITY_FACTORS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export const ACTIVITY_LABELS: Record<ActivityLevel, { name: string; desc: string }> = {
  sedentary: { name: '久坐', desc: '几乎不运动，研究生日常' },
  light: { name: '轻度活动', desc: '每周 1-3 次轻运动' },
  moderate: { name: '中度活动', desc: '每周 3-5 次中等强度' },
  active: { name: '高度活动', desc: '每周 6-7 次' },
  very_active: { name: '极高活动', desc: '体力劳动 / 一天两练' },
};

/** Atwater 热量系数（kcal/g）—— research/04 §4 */
export const KCAL_PER_G = { protein: 4, carb: 4, fat: 9 } as const;

/**
 * 1 kg 脂肪组织约含 7700 kcal。
 *
 * 严格说脂肪组织不是纯脂肪（约 87% 脂质 + 水 + 结缔组织），
 * 所以「减 1 kg 体重 = 7700 kcal 缺口」是个被广泛使用的近似值。
 * 它足够用来做【速度上限】这种粗粒度判断，但不能用来做精确预测 ——
 * 真实减重前期掉的水分会让头两周显著快于这个模型。
 */
export const KCAL_PER_KG_FAT = 7700;

/**
 * 每周减重上限 = 体重的 1%（research/04 §3）。
 * 目的是保护去脂体重（肌肉），依据 Helms et al. 减脂期综述。
 */
export const MAX_WEEKLY_LOSS_RATIO = 0.01;

/** 每日热量缺口硬上限（kcal）—— research/04 §3，出自 Medscape / HHS 的 LCD 建议 */
export const MAX_DEFICIT_KCAL = 500;

/** 缺口占 TDEE 的比例上限 —— research/04 §3 */
export const MAX_DEFICIT_RATIO = 0.2;

/**
 * 绝对热量下限（kcal/天）—— research/04 §3。
 *
 * 低于这个值就不该由软件给出建议了。触底时的正确做法是提示
 * 「增加活动量」而不是「继续少吃」，见 buildPlan 返回的 warnings。
 */
export const KCAL_FLOOR: Record<Sex, number> = { male: 1500, female: 1200 };

/** 蛋白质系数（g/kg 体重）—— research/04 §4，默认 1.6，可调至 2.2 */
export const PROTEIN_PER_KG = { min: 1.6, max: 2.2, default: 1.6 } as const;

/** 脂肪下限系数（g/kg 体重）—— research/04 §4 */
export const FAT_PER_KG_MIN = 0.8;

/** 脂肪占热量下限比例 —— research/04 §4（激素健康） */
export const FAT_MIN_KCAL_RATIO = 0.2;

/** 碳水低于这个值就说明热量目标已经不合理了 —— research/04 §4 */
export const MIN_CARB_G = 50;

/**
 * ⚠️ PRODUCT_DEFAULT —— 以下不是科学结论，是产品拍的决定。
 *
 * research/04 只覆盖了减脂（lose）路径；维持和增重没有权威锚点。
 * 这里给的是保守实现，UI 上不能把它们包装成「科学建议」。
 */
export const PRODUCT_DEFAULT = {
  /** 增重时的热量盈余上限（kcal/天） */
  MAX_SURPLUS_KCAL: 300,
  /** 增重盈余占 TDEE 比例上限 */
  MAX_SURPLUS_RATIO: 0.1,
  /** 趋势判定用的回归窗口（天）—— research/04 §5 指定 14 天 */
  TREND_WINDOW_DAYS: 14,
  /** 移动平均窗口（天）—— research/04 §5 指定 7 天 */
  MOVING_AVERAGE_DAYS: 7,
  /** 少于这么多天的数据就不下趋势结论 —— research/04 §5 */
  MIN_DAYS_FOR_TREND: 7,
} as const;

/** 页面必须展示的免责声明 —— research/04 §6 */
export const DISCLAIMER =
  '本工具的计算结果基于通用公式（Mifflin-St Jeor）与公开的公共卫生建议，' +
  '仅供个人参考，不构成医疗或营养学建议。如有基础疾病、正在服药、孕期或' +
  '有进食障碍史，请咨询医生或注册营养师。';

// ═══════════════════════════════════════════════════════════════
//  工具
// ═══════════════════════════════════════════════════════════════

/** 四舍五入到指定小数位，避免浮点尾巴（0.1+0.2 那类问题） */
function round(n: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(Math.max(n, lo), hi);
}

/**
 * 把 'YYYY-MM-DD' 解析成年月日三个数字。
 * 不用 `new Date(str)` —— 那个会按 UTC 解析，在东八区会得到前一天。
 */
function parseDate(s: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error(`日期格式必须是 YYYY-MM-DD，收到：${s}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// ═══════════════════════════════════════════════════════════════
//  1. 年龄
// ═══════════════════════════════════════════════════════════════

/**
 * 按「生日过了没有」算周岁，而不是简单相减。
 *
 * 为什么值得单独写一个函数：这不是学究式精确，而是因为
 * BMR 里年龄带系数 −5，差一岁差 5 kcal —— 听着无所谓，
 * 但「今年生日还没到」的用户如果被多算一岁，这个错误会一直存在
 * 到下一个生日，而且没人会去查。
 */
export function calcAge(birthDate: string, onDate: string): number {
  const [by, bm, bd] = parseDate(birthDate);
  const [oy, om, od] = parseDate(onDate);

  let age = oy - by;
  // 今年的生日还没到 → 减一岁
  if (om < bm || (om === bm && od < bd)) age -= 1;

  if (age < 0) throw new Error('出生日期晚于计算日期');
  if (age > 120) throw new Error('年龄超出合理范围（>120），请检查出生日期');
  return age;
}

// ═══════════════════════════════════════════════════════════════
//  2. BMR —— Mifflin-St Jeor（research/04 §1）
// ═══════════════════════════════════════════════════════════════
//
//   男性：BMR = 10×体重 + 6.25×身高 − 5×年龄 + 5
//   女性：BMR = 10×体重 + 6.25×身高 − 5×年龄 − 161
//
//  这里不做性别以外的分支：sex 是联合类型，只有两个值，
//  TypeScript 能保证穷尽。如果将来要加 'other'，编译器会直接报错
//  提醒你「这个公式对第三个性别没有定义」—— 这正是我们想要的。

export function calcBmr(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const { sex, weightKg, heightCm, ageYears } = input;
  assertPositive(weightKg, '体重');
  assertPositive(heightCm, '身高');
  assertPositive(ageYears, '年龄');

  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears;
  const bmr = sex === 'male' ? base + 5 : base - 161;

  if (bmr <= 0) throw new Error(`BMR 算出来是 ${bmr}，输入数据不合理`);
  return round(bmr);
}

// ═══════════════════════════════════════════════════════════════
//  3. TDEE
// ═══════════════════════════════════════════════════════════════

export function calcTdee(bmr: number, activityLevel: ActivityLevel): number {
  const factor = ACTIVITY_FACTORS[activityLevel];
  if (factor === undefined) throw new Error(`未知活动水平：${activityLevel}`);
  return round(bmr * factor);
}

// ═══════════════════════════════════════════════════════════════
//  4. 热量缺口与目标热量（research/04 §3）
// ═══════════════════════════════════════════════════════════════
//
//  这里同时受【三个】上限约束，取最严的那个：
//
//    ① 500 kcal        —— 绝对上限，出自 LCD 的公共健康建议
//    ② TDEE × 20%      —— 相对上限，防止大体重用户一上来就砍太狠
//    ③ 体重 × 1% / 周  —— 速度上限，换算成每日缺口
//
//  ③ 什么时候会生效？体重 45 kg 的人：45 × 1% = 0.45 kg/周
//  = 3465 kcal/周 ≈ 495 kcal/天 —— 刚好开始低于 500。
//  体重更轻（或目标更保守）时，它会成为真正起作用的那个约束。
//  三个人一起管着，才不会出现「小个子用户被建议砍 500 kcal」这种事故。

export interface TargetKcalResult {
  /** 目标热量（kcal/天） */
  targetKcal: number;
  /** 实际采用的热量缺口（kcal/天） */
  deficitKcal: number;
  /** 三个上限各自算出来的缺口，留作调试与讲解 */
  limits: { absolute: number; ratio: number; rate: number };
  /** 哪一个上限起了作用 */
  bindingLimit: 'absolute' | 'ratio' | 'rate' | 'floor' | 'none';
  /** 是否触到了绝对热量下限 —— 触到时 UI 必须改变话术 */
  floorApplied: boolean;
  warnings: string[];
}

export function calcTargetKcal(input: {
  tdee: number;
  sex: Sex;
  weightKg: number;
  goalType: GoalType;
}): TargetKcalResult {
  const { tdee, sex, weightKg, goalType } = input;
  const warnings: string[] = [];

  // ── 维持：缺口为 0，没有上限需要比较 ──────────────────────
  if (goalType === 'maintain') {
    return {
      targetKcal: round(tdee),
      deficitKcal: 0,
      limits: { absolute: MAX_DEFICIT_KCAL, ratio: round(tdee * MAX_DEFICIT_RATIO), rate: 0 },
      bindingLimit: 'none',
      floorApplied: false,
      warnings,
    };
  }

  // ── 增重：反方向，用盈余而不是缺口（PRODUCT_DEFAULT，非科学结论）──
  if (goalType === 'gain') {
    const surplus = round(
      Math.min(PRODUCT_DEFAULT.MAX_SURPLUS_KCAL, tdee * PRODUCT_DEFAULT.MAX_SURPLUS_RATIO),
    );
    return {
      targetKcal: round(tdee + surplus),
      deficitKcal: -surplus, // 负数 = 盈余，保持「正值永远是缺口」的约定
      limits: { absolute: MAX_DEFICIT_KCAL, ratio: round(tdee * MAX_DEFICIT_RATIO), rate: 0 },
      bindingLimit: 'none',
      floorApplied: false,
      warnings,
    };
  }

  // ── 减脂 ────────────────────────────────────────────────
  const limits = {
    absolute: MAX_DEFICIT_KCAL,
    ratio: round(tdee * MAX_DEFICIT_RATIO),
    // 每周可减的最大公斤数 → 每日 kcal
    rate: round(((weightKg * MAX_WEEKLY_LOSS_RATIO) * KCAL_PER_KG_FAT) / 7),
  };

  // 取三者的最小值，并记住是谁在起约束作用（用于讲解和 UI 文案）
  let bindingLimit: TargetKcalResult['bindingLimit'] = 'absolute';
  let deficitKcal = limits.absolute;
  if (limits.ratio < deficitKcal) {
    deficitKcal = limits.ratio;
    bindingLimit = 'ratio';
  }
  if (limits.rate < deficitKcal) {
    deficitKcal = limits.rate;
    bindingLimit = 'rate';
  }

  const floor = KCAL_FLOOR[sex];
  let targetKcal = tdee - deficitKcal;
  let floorApplied = false;

  if (targetKcal < floor) {
    targetKcal = floor;
    floorApplied = true;
    bindingLimit = 'floor';

    // 这是产品里最重要的一条提示文案。
    // 触底时【不能】让用户觉得「系统建议我吃这么少」——
    // 正确信息是「软件已经不建议你继续降了，请从运动那边想办法」。
    warnings.push(
      `你的目标热量已经是安全下限（${floor} kcal）。不建议再降低摄入，` +
        '建议通过增加日常活动量来扩大缺口。',
    );
  }

  // 缺口太小时提醒「为什么没效果」
  if (targetKcal - tdee > -100) {
    warnings.push(
      '当前算出的热量缺口较小（不足 100 kcal/天），减重速度会很慢。' +
        '这是有意为之：更安全的做法是先把活动量提上去。',
    );
  }

  if (bindingLimit === 'rate') {
    warnings.push(
      '缺口受「每周减重不超过体重 1%」限制。这个上限是为了保护肌肉，' +
        '不是系统算不出来更大的数字。',
    );
  }

  return {
    targetKcal: round(targetKcal),
    deficitKcal: round(tdee - targetKcal),
    limits,
    bindingLimit,
    floorApplied,
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
//  5. 三大营养素（research/04 §4）
// ═══════════════════════════════════════════════════════════════

export interface MacroTargets {
  proteinG: number;
  fatG: number;
  carbG: number;
  /** 三者反算出的热量，用来核对是否与 targetKcal 自洽 */
  kcalFromMacros: number;
  warnings: string[];
}

export function calcMacroTargets(input: {
  targetKcal: number;
  weightKg: number;
  /** 蛋白质系数（g/kg），默认 1.6，允许 1.6–2.2 */
  proteinPerKg?: number;
}): MacroTargets {
  const { targetKcal, weightKg } = input;
  const warnings: string[] = [];

  const proteinPerKg = clamp(
    input.proteinPerKg ?? PROTEIN_PER_KG.default,
    PROTEIN_PER_KG.min,
    PROTEIN_PER_KG.max,
  );

  // 蛋白：先定，因为减脂期它最重要，不该被别的营养素挤掉
  const proteinG = round(weightKg * proteinPerKg);

  // 脂肪：两个下限取大的那个 ——
  //   · 按体重算（0.8 g/kg）保证激素合成有原料
  //   · 按热量比例算（20%）防止极低热量时脂肪被压到 0
  const fatByWeight = weightKg * FAT_PER_KG_MIN;
  const fatByRatio = (targetKcal * FAT_MIN_KCAL_RATIO) / KCAL_PER_G.fat;
  const fatG = round(Math.max(fatByWeight, fatByRatio));

  // 碳水：填满剩下的热量。
  // 注意这里用【已取整的】蛋白和脂肪反算，而不是用原始浮点值 ——
  // 否则展示的 112 g 蛋白和实际计算用的 112.0001 g 会对不上，
  // 用户拿计算器一按会发现三个数加起来不等于目标热量。
  const remainingKcal =
    targetKcal - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  const carbG = round(remainingKcal / KCAL_PER_G.carb);

  if (carbG < MIN_CARB_G) {
    warnings.push(
      `热量目标过低：扣除蛋白质和脂肪后只剩 ${carbG} g 碳水，` +
        '无法同时满足两者的最低需求。请上调热量目标，或降低蛋白质系数。',
    );
  }

  return {
    proteinG,
    fatG,
    carbG,
    kcalFromMacros: round(
      proteinG * KCAL_PER_G.protein + fatG * KCAL_PER_G.fat + carbG * KCAL_PER_G.carb,
    ),
    warnings,
  };
}

// ═══════════════════════════════════════════════════════════════
//  6. 组合：一次算出完整方案
// ═══════════════════════════════════════════════════════════════

export interface NutritionPlan {
  calcVersion: string;
  ageYears: number;
  bmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  deficitKcal: number;
  proteinG: number;
  fatG: number;
  carbG: number;
  bindingLimit: TargetKcalResult['bindingLimit'];
  floorApplied: boolean;
  warnings: string[];
}

export function buildPlan(input: {
  sex: Sex;
  birthDate: string;
  heightCm: number;
  weightKg: number;
  activityLevel: ActivityLevel;
  goalType: GoalType;
  onDate: string;
  proteinPerKg?: number;
}): NutritionPlan {
  const ageYears = calcAge(input.birthDate, input.onDate);
  const bmrKcal = calcBmr({
    sex: input.sex,
    weightKg: input.weightKg,
    heightCm: input.heightCm,
    ageYears,
  });
  const tdeeKcal = calcTdee(bmrKcal, input.activityLevel);

  const target = calcTargetKcal({
    tdee: tdeeKcal,
    sex: input.sex,
    weightKg: input.weightKg,
    goalType: input.goalType,
  });

  const macros = calcMacroTargets({
    targetKcal: target.targetKcal,
    weightKg: input.weightKg,
    proteinPerKg: input.proteinPerKg,
  });

  return {
    calcVersion: CALC_VERSION,
    ageYears,
    bmrKcal,
    tdeeKcal,
    targetKcal: target.targetKcal,
    deficitKcal: target.deficitKcal,
    proteinG: macros.proteinG,
    fatG: macros.fatG,
    carbG: macros.carbG,
    bindingLimit: target.bindingLimit,
    floorApplied: target.floorApplied,
    warnings: [...target.warnings, ...macros.warnings],
  };
}

// ═══════════════════════════════════════════════════════════════
//  7. 体重趋势分析（research/04 §5）
// ═══════════════════════════════════════════════════════════════
//
//  核心认知：单日体重波动可达 ±1 kg，而真实的脂肪变化每天只有约 0.1 kg。
//  也就是说【信噪比是 1:10】—— 直接看「今天比昨天重了」得到的
//  几乎全是噪声。这正是需求 P3 的根源：新手被日波动打击信心然后放弃。
//
//  所以这里做两件事：
//    · 7 日移动平均 —— 把噪声压下去，这是主展示线
//    · 14 天线性回归斜率 —— 用最小二乘拟合出真实速度，而不是首尾相减
//
//  为什么用回归而不是「最后一天 − 第一天」？因为后者的方差极大：
//  首尾两天的水分波动会直接决定你看到的「趋势」。回归用上了中间
//  每一个点，对异常值不敏感得多 —— 这正是统计工具存在的意义。

export interface WeightPoint {
  /** 'YYYY-MM-DD' */
  date: string;
  value: number;
}

export interface MovingAveragePoint extends WeightPoint {
  /** 该点的移动平均值；窗口内有效点不足时为 null */
  avg: number | null;
  /** 实际参与平均的点数（不是窗口大小 —— 用户会漏记） */
  sampleCount: number;
}

/** 'YYYY-MM-DD' → 从 1970-01-01 起的天数（UTC 语义，纯整数运算，不受时区影响） */
function toDayNumber(date: string): number {
  const [y, m, d] = parseDate(date);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromDayNumber(n: number): string {
  const dt = new Date(n * 86_400_000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * 按【日历天】做移动平均，而不是按「第几个数据点」。
 *
 * 这个区别很关键：用户不会天天记。如果按数据点滑窗，一个「7 点窗口」
 * 可能横跨 20 天，平均出来的东西既不是周平均也没有物理意义。
 * 按日历天滑窗则始终回答「最近 7 天平均多重」—— 哪怕中间漏了 4 天。
 *
 * 窗口内的缺失日期不补零、不插值，直接不计入分母（sampleCount 会告诉你
 * 实际用了几个点）。体重不是「0」——把它当 0 平均会把结果拉到荒谬的低值。
 */
export function movingAverage(
  points: WeightPoint[],
  windowDays: number = PRODUCT_DEFAULT.MOVING_AVERAGE_DAYS,
): MovingAveragePoint[] {
  if (windowDays < 1) throw new Error('窗口天数必须 ≥ 1');

  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return sorted.map((p) => {
    const end = toDayNumber(p.date);
    const start = end - windowDays + 1;

    const inWindow = sorted.filter((q) => {
      const n = toDayNumber(q.date);
      return n >= start && n <= end;
    });

    if (inWindow.length === 0) return { ...p, avg: null, sampleCount: 0 };

    const sum = inWindow.reduce((acc, q) => acc + q.value, 0);
    return { ...p, avg: round(sum / inWindow.length, 2), sampleCount: inWindow.length };
  });
}

export interface TrendResult {
  /** 每周变化（kg/周）。负值 = 下降 */
  kgPerWeek: number;
  /** 拟合用的数据点数量 */
  sampleCount: number;
  /** 拟合窗口的实际跨度（天） */
  spanDays: number;
  /** 数据是否足够下结论 */
  reliable: boolean;
  /** 相对目标速度的评价 */
  verdict: 'on_track' | 'too_slow' | 'too_fast' | 'wrong_direction' | 'insufficient_data';
  /** 给人看的一句话解读 */
  message: string;
}

/**
 * 最小二乘线性回归，输出「每周变化多少 kg」。
 *
 * 回归的自变量是【真实天数】，不是数据点序号 —— 否则用户今天记一次、
 * 隔三天再记一次，这两个点在拟合里权重相同，斜率就被扭曲了。
 * 用真实天数才能真正反映「时间流逝了多少」。
 *
 * 只取最近 windowDays 个日历天内的点：更早的数据反映的是过去的
 * 生理状态（甚至不同的饮食策略），混进来会稀释当前趋势。
 */
export function analyzeTrend(
  points: WeightPoint[],
  options: {
    windowDays?: number;
    /** 目标速度（kg/周，正值表示希望减重的速度） */
    targetKgPerWeek?: number;
    /** 判定「符合目标」的容差比例，默认 ±35% */
    tolerance?: number;
  } = {},
): TrendResult {
  const windowDays = options.windowDays ?? PRODUCT_DEFAULT.TREND_WINDOW_DAYS;
  const tolerance = options.tolerance ?? 0.35;

  if (points.length === 0) return insufficient('还没有体重记录，先记几天吧。');

  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latestDay = toDayNumber(sorted[sorted.length - 1]!.date);

  const windowed = sorted.filter((p) => toDayNumber(p.date) > latestDay - windowDays);

  if (windowed.length < 2) return insufficient('数据点太少，至少要两天的记录才能算趋势。');

  const origin = toDayNumber(windowed[0]!.date);
  const xs = windowed.map((p) => toDayNumber(p.date) - origin);
  const ys = windowed.map((p) => p.value);
  const n = xs.length;

  const spanDays = xs[n - 1]!;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - meanX) * (ys[i]! - meanY);
    den += (xs[i]! - meanX) ** 2;
  }

  // den === 0 意味着所有点在同一天（重复记录）—— 斜率的定义不存在
  if (den === 0) return insufficient('所有记录都在同一天，无法计算趋势。');

  const kgPerDay = num / den;
  const kgPerWeek = round(kgPerDay * 7, 2);

  // 数据够不够下结论：既要够多天，也要够多点。
  // 只跨 7 天但只有 2 个点，拟合出来的线是巧合，不是趋势。
  const reliable =
    spanDays >= PRODUCT_DEFAULT.MIN_DAYS_FOR_TREND && n >= Math.ceil(windowDays / 3);

  const base = { kgPerWeek, sampleCount: n, spanDays, reliable };

  if (!reliable) {
    return {
      ...base,
      verdict: 'insufficient_data',
      message: `目前只有 ${n} 个数据点、跨 ${spanDays} 天。再记几天，趋势才看得准 —— 短期波动说明不了问题。`,
    };
  }

  const target = options.targetKgPerWeek;

  if (target === undefined) {
    return {
      ...base,
      verdict: kgPerWeek < -0.05 ? 'on_track' : kgPerWeek > 0.05 ? 'wrong_direction' : 'on_track',
      message:
        kgPerWeek < -0.05
          ? `最近 ${spanDays} 天平均每周下降 ${Math.abs(kgPerWeek)} kg。`
          : kgPerWeek > 0.05
            ? `最近 ${spanDays} 天平均每周上升 ${kgPerWeek} kg。`
            : `最近 ${spanDays} 天体重基本持平。`,
    };
  }

  // 目标速度是「希望减少多少」的正数；实际斜率是负数表示下降。
  // 统一到「下降速度」这个轴上比较，避免符号混乱。
  const actualLoss = -kgPerWeek; // 正 = 在下降
  const diff = actualLoss - target;

  if (actualLoss < -0.05) {
    return {
      ...base,
      verdict: 'wrong_direction',
      message: `最近 ${spanDays} 天体重在上升（每周约 ${Math.abs(kgPerWeek)} kg）。如果刚调整过饮食，先看两周再判断。`,
    };
  }

  if (Math.abs(diff) <= target * tolerance) {
    return {
      ...base,
      verdict: 'on_track',
      message: `最近 ${spanDays} 天平均每周下降 ${round(actualLoss, 2)} kg，和目标速度基本一致。保持住就行。`,
    };
  }

  if (diff < 0) {
    return {
      ...base,
      verdict: 'too_slow',
      message: `最近 ${spanDays} 天平均每周下降 ${round(actualLoss, 2)} kg，低于目标速度（${target} kg/周）。可能是热量估高了，或者记录有遗漏。`,
    };
  }

  return {
    ...base,
    verdict: 'too_fast',
    message: `最近 ${spanDays} 天平均每周下降 ${round(actualLoss, 2)} kg，快于目标速度（${target} kg/周）。掉太快容易流失肌肉，建议适当提高热量摄入。`,
  };
}

function insufficient(message: string): TrendResult {
  return {
    kgPerWeek: 0,
    sampleCount: 0,
    spanDays: 0,
    reliable: false,
    verdict: 'insufficient_data',
    message,
  };
}

// ═══════════════════════════════════════════════════════════════
//  8. 食物营养换算
// ═══════════════════════════════════════════════════════════════

/**
 * 把「吃了多少克」换算成实际摄入的营养。
 *
 * 因为食物库统一按每 100 g 存（学自 wger 的 Ingredient 设计），
 * 这个换算只在一处发生。将来要支持「按份」「按毫升」，
 * 也是先在调用方换算成克，再进这个函数 —— 保持它只有一个入口。
 */
export function scaleNutrition(
  per100g: { kcal: number; proteinG: number; fatG: number; carbG: number },
  quantityG: number,
): { kcal: number; proteinG: number; fatG: number; carbG: number } {
  assertPositive(quantityG, '份量');
  const k = quantityG / 100;
  return {
    kcal: round(per100g.kcal * k, 1),
    proteinG: round(per100g.proteinG * k, 1),
    fatG: round(per100g.fatG * k, 1),
    carbG: round(per100g.carbG * k, 1),
  };
}

/**
 * scaleNutrition 的逆运算：已知「吃了 quantityG 克、总共摄入 T」，反推每 100 g 的值。
 *
 * 什么时候需要它：用户改了某条记录的份量，而那条记录对应的食物**已经从
 * 食物库删掉了**（meal_items.food_id 是 ON DELETE SET NULL，所以这是会发生的）。
 * 此时唯一能依据的就是那条记录里的营养快照 —— 用快照算出它的「每 100 g 密度」，
 * 再按新份量重新缩放。
 *
 * ⚠️ 不能拿快照直接乘新份量：快照是某一份量下的**结果**，不是密度。
 *    直接乘等于把一个已经缩放过的数又缩放了一次。
 */
export function toPer100g(
  total: { kcal: number; proteinG: number; fatG: number; carbG: number },
  quantityG: number,
): { kcal: number; proteinG: number; fatG: number; carbG: number } {
  assertPositive(quantityG, '份量');
  const k = 100 / quantityG;
  return {
    kcal: total.kcal * k,
    proteinG: total.proteinG * k,
    fatG: total.fatG * k,
    carbG: total.carbG * k,
  };
}

// ═══════════════════════════════════════════════════════════════
//  9. 进食时间的建议（产品体验，非科学结论）
// ═══════════════════════════════════════════════════════════════

/**
 * 根据当前时刻推断「这一顿最可能是什么」，作为录入表单的默认值。
 *
 * 这是个纯体验优化：让用户少点一次。判断错了也没有任何后果，
 * 因为下拉框就在旁边。但如果默认值经常猜对，「10 秒记一顿饭」
 * 的目标就真的能达成 —— 减少一次点击，在每天三次、连续 90 天的
 * 场景下就是 270 次点击的差别。
 */
export function guessMealType(hour: number): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  if (hour >= 5 && hour < 10) return 'breakfast';
  if (hour >= 10 && hour < 15) return 'lunch';
  if (hour >= 16 && hour < 21) return 'dinner';
  return 'snack';
}

// ═══════════════════════════════════════════════════════════════
//  10. 本地时区的「今天」
// ═══════════════════════════════════════════════════════════════

/**
 * 取指定时区下的今天（'YYYY-MM-DD'）。
 *
 * 为什么不用 `new Date().toISOString().slice(0,10)`：那个返回的是 UTC 日期。
 * Vercel 的服务器跑在 UTC，于是北京时间早上 8 点之前，
 * 用户记的早餐会被写进【前一天】。而且这个 bug 只在早上出现，
 * 你自己测的时候大概率碰不到。
 *
 * 用 Intl.DateTimeFormat 的 'en-CA' locale 是因为它的日期格式
 * 恰好就是 YYYY-MM-DD —— 不用手动拼字符串。
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    // 时区字符串非法时退回 UTC，而不是抛错 ——
    // 记不上账比记错一天更糟，而且时区是可修正的。
    return now.toISOString().slice(0, 10);
  }
}

/** 把日期字符串加减若干天，返回 'YYYY-MM-DD' */
export function addDays(date: string, days: number): string {
  return fromDayNumber(toDayNumber(date) + days);
}

// ═══════════════════════════════════════════════════════════════
//  断言
// ═══════════════════════════════════════════════════════════════

function assertPositive(n: number, label: string): void {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
    throw new Error(`${label}必须是正数，收到：${n}`);
  }
}
