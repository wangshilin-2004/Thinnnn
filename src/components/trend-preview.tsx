/* 首屏的产品预览图。
 *
 * 这是一个【服务端组件】，没有 'use client'，也不需要 hydration：
 * 图里的每个坐标都在构建/请求时用纯函数算好，产出静态 SVG。
 * 好处是首屏不下载图表库、JS 关掉也能看、LCP 只受 HTML 体积影响。
 *
 * 为什么不用 Recharts：真正会用 Recharts 的地方是仪表盘（需要 tooltip、
 * 缩放、响应式重算）。首屏这张图是「一张会随主题变色的静态插画」，
 * 引一个 125KB 的库只为了画 21 个矩形和一条折线，是把首屏当成代价。
 * 反过来，这里用 SVG 手写也是因为苹果风图表本来就是 SVG 的活儿：
 * 圆角柱顶、渐变面积、round 线帽这些在 SVG 里都是原生属性。
 *
 * 数据是写死的样例（21 天）。它模拟的是一个真实、合理的使用轨迹：
 * 三周从 76.8 掉到 74.9（约 −0.63 kg/周，落在安全的 0.5–1 kg/周区间内），
 * 摄入日均约 1960 kcal，日间波动很大——这正是「单日数字没有意义、
 * 必须看移动平均」的直观演示。 */

const DAYS = 21;

/** 每日总摄入（kcal）。刻意做出大起大落：周末高、工作日低。 */
const KCAL = [
  1980, 2140, 1760, 1890, 2320, 2010, 1855, 1930, 2100, 1740, 1880, 2260, 1990,
  1820, 1940, 2050, 1790, 1910, 2180, 1880, 1955,
];

/** 每日晨起空腹体重（kg）。含 1–2 天「反常上涨」，用来展示噪声。 */
const WEIGHT = [
  76.8, 76.9, 76.5, 76.6, 76.4, 76.5, 76.2, 76.3, 76.1, 76.0, 76.2, 75.9, 75.8,
  75.9, 75.6, 75.5, 75.6, 75.3, 75.2, 75.2, 74.9,
];

const TARGET_KCAL = 1800;

/** 7 日移动平均。窗口不满 7 天时用已有天数求均值，而不是丢掉前 6 个点——
 *  否则图上会莫名其妙缺一截。 */
function movingAverage(values: number[], window: number): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const slice = values.slice(from, i + 1);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}

type Point = { x: number; y: number };

/** 把一串数值映射到 SVG 坐标。min/max 由调用方传入而不是各自算，
 *  这样折线和移动平均线共用同一把尺子，两条线的相对位置才有意义。 */
function project(
  values: number[],
  { width, height, top, bottom, min, max }: {
    width: number; height: number; top: number; bottom: number; min: number; max: number;
  },
): Point[] {
  const span = max - min || 1;
  const usable = height - top - bottom;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: i * step,
    y: top + (1 - (v - min) / span) * usable,
  }));
}

const toPath = (pts: Point[]) =>
  pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

/** 只圆顶部的柱子。
 *  不能用 <rect rx>：rx 会把四个角都磨圆，柱子底部会浮起来、露出缝隙，
 *  而「柱底贴住轴线」正是苹果健康里柱状图最显眼的特征。
 *  路径顺序：左下 → 上 → 圆角 → 右 → 下 → 闭合。 */
function topRoundedBar(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.min(r, w / 2, h);
  return [
    `M${x.toFixed(1)} ${(y + h).toFixed(1)}`,
    `L${x.toFixed(1)} ${(y + radius).toFixed(1)}`,
    `Q${x.toFixed(1)} ${y.toFixed(1)} ${(x + radius).toFixed(1)} ${y.toFixed(1)}`,
    `L${(x + w - radius).toFixed(1)} ${y.toFixed(1)}`,
    `Q${(x + w).toFixed(1)} ${y.toFixed(1)} ${(x + w).toFixed(1)} ${(y + radius).toFixed(1)}`,
    `L${(x + w).toFixed(1)} ${(y + h).toFixed(1)}`,
    'Z',
  ].join(' ');
}

/* ---- 画布尺寸 ---- */
const W = 640;
const WEIGHT_H = 132;
const WEIGHT_TOP = 14;
const WEIGHT_BOTTOM = 14;
const KCAL_H = 84;

const ma = movingAverage(WEIGHT, 7);

/* 体重图共用一把尺子：把日值和均值的极值合起来取范围，再向外留 12% 呼吸空间，
 * 免得最高/最低点正好压在图的边缘上。 */
const wMin = Math.min(...WEIGHT, ...ma);
const wMax = Math.max(...WEIGHT, ...ma);
const wPad = (wMax - wMin) * 0.12 || 1;
const weightPts = project(WEIGHT, {
  width: W, height: WEIGHT_H, top: WEIGHT_TOP, bottom: WEIGHT_BOTTOM,
  min: wMin - wPad, max: wMax + wPad,
});
const maPts = project(ma, {
  width: W, height: WEIGHT_H, top: WEIGHT_TOP, bottom: WEIGHT_BOTTOM,
  min: wMin - wPad, max: wMax + wPad,
});

/* 热量图固定从 0 起算。柱状图的基线必须是 0，从 1500 起会把
 * 「1740 vs 2320」画成「几乎一样高」——那是欺骗性的。 */
const kcalMax = Math.max(...KCAL, TARGET_KCAL) * 1.06;
const SLOT = W / DAYS;
const BAR_W = SLOT * 0.46;

const kcalBars = KCAL.map((v, i) => {
  const h = (v / kcalMax) * KCAL_H;
  return {
    d: topRoundedBar(i * SLOT + (SLOT - BAR_W) / 2, KCAL_H - h, BAR_W, h, BAR_W / 2),
    over: v > TARGET_KCAL,
  };
});
const targetY = KCAL_H - (TARGET_KCAL / kcalMax) * KCAL_H;

/* ---- 派生出的读数（都从上面的数组算，不另写死一份，避免图与数字对不上）---- */
const latest = WEIGHT[WEIGHT.length - 1]!;
const latestMa = ma[ma.length - 1]!;
const totalChange = latest - WEIGHT[0]!;
const avgKcal = Math.round(KCAL.reduce((s, v) => s + v, 0) / KCAL.length);
const weeks = DAYS / 7;

const nf1 = (n: number) => n.toFixed(1);

export function TrendPreview() {
  return (
    <div className="glass rounded-2xl p-5 sm:p-7">
      {/* ---------- 读数行 ---------- */}
      <div className="grid grid-cols-3 gap-3 text-center sm:gap-4">
        <Stat label="当前体重" value={nf1(latest)} unit="kg" />
        <Stat label="7 日均值" value={nf1(latestMa)} unit="kg" muted />
        <Stat
          label={`${weeks} 周变化`}
          value={totalChange > 0 ? `+${nf1(totalChange)}` : nf1(totalChange)}
          unit="kg"
          tone={totalChange <= 0 ? 'good' : 'warn'}
        />
      </div>

      {/* ---------- 体重趋势 ---------- */}
      <div className="mt-6">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-caption-1 text-ink-3">体重趋势</span>
          <span className="text-caption-1 text-ink-4">粗线 = 7 日均值 · 细线 = 每日实测</span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${WEIGHT_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`近 ${DAYS} 天体重从 ${nf1(WEIGHT[0]!)} 公斤变化到 ${nf1(latest)} 公斤，其中 7 日移动平均为 ${nf1(latestMa)} 公斤`}
        >
          <defs>
            {/* 三点渐变而不是两点：两点线性衰减在整块面积上平均下来仍然很实，
                看起来像一块实心粉色，会盖过折线本身。
                让它在 60% 处就基本衰减到 0，面积才退回「一层光」的角色。 */}
            <linearGradient id="tp-weight-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-data-weight)" stopOpacity="0.17" />
              <stop offset="42%" stopColor="var(--color-data-weight)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--color-data-weight)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 面积：把折线闭合到底边。注意这里【没有】用 min/max 当上下边界，
              而是闭到图底，视觉上像一层薄薄的光，不抢折线的主体地位。 */}
          <path
            d={`${toPath(weightPts)} L${W} ${WEIGHT_H} L0 ${WEIGHT_H} Z`}
            fill="url(#tp-weight-fill)"
          />

          {/* 每日实测：细、半透明、虚线感靠低透明度表达。
              它的作用是「显示噪声」，所以必须比均值线弱。 */}
          <path
            d={toPath(weightPts)}
            fill="none"
            stroke="var(--color-data-weight)"
            strokeOpacity="0.4"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* 7 日移动平均：主视觉。整张图想说的就一句话——
              单日线在抖，均值线在稳稳往下走。 */}
          <path
            d={toPath(maPts)}
            fill="none"
            stroke="var(--color-data-weight)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />

          {/* 最后一个均值点加个实心圆点：视线需要有一个「现在」的锚。 */}
          <circle
            cx={maPts[maPts.length - 1]!.x}
            cy={maPts[maPts.length - 1]!.y}
            r="3.5"
            fill="var(--color-data-weight)"
            stroke="var(--color-canvas)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* ---------- 热量摄入 ---------- */}
      <div className="mt-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-caption-1 text-ink-3">每日热量摄入</span>
          <span className="text-caption-1 text-ink-4 tabular">
            日均 {avgKcal.toLocaleString('zh-CN')} kcal
          </span>
        </div>

        <svg
          viewBox={`0 0 ${W} ${KCAL_H}`}
          className="h-auto w-full"
          role="img"
          aria-label={`近 ${DAYS} 天每日热量摄入，日均 ${avgKcal} 千卡，目标 ${TARGET_KCAL} 千卡`}
        >
          {kcalBars.map((bar, i) => (
            <path
              key={i}
              d={bar.d}
              fill="var(--color-data-intake)"
              /* 超标的日子提亮，达标的日子压暗。
                 这样一眼就能扫出「哪几天吃多了」，不需要看坐标轴。
                 注意不是用红/绿——摄入超标不是「错误」，是信息。 */
              fillOpacity={bar.over ? 0.85 : 0.34}
            />
          ))}

          {/* 目标线：虚线 + 右侧标签。虚线是「参考值」在图表里的通用语法。 */}
          <line
            x1="0"
            y1={targetY}
            x2={W}
            y2={targetY}
            stroke="var(--color-ink-3)"
            strokeWidth="1"
            strokeDasharray="3 4"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="mt-1.5 flex items-center gap-1.5">
          <span
            className="inline-block h-px w-4 shrink-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(to right, var(--color-ink-3) 0 3px, transparent 3px 7px)',
            }}
            aria-hidden
          />
          <span className="text-caption-2 text-ink-4">
            目标 {TARGET_KCAL.toLocaleString('zh-CN')} kcal · 高于此线的日子用更亮的柱子标出
          </span>
        </div>
      </div>
    </div>
  );
}

/* 单个读数。数值用 proportional-nums（大号数字关掉等宽更舒展），
 * 但单位用 tabular——单位不动、数字在动的时候，等宽能让整行不抖。 */
function Stat({
  label,
  value,
  unit,
  tone = 'default',
  muted = false,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: 'default' | 'good' | 'warn';
  muted?: boolean;
}) {
  const valueColor =
    tone === 'good' ? 'text-accent-green' : tone === 'warn' ? 'text-accent-orange' : 'text-ink';

  return (
    <div>
      <div className="text-caption-1 text-ink-3">{label}</div>
      <div className={`proportional-nums mt-0.5 text-title-2 font-medium ${valueColor}`}>
        {value}
        <span className={`ml-0.5 text-subhead font-normal ${muted ? 'text-ink-4' : 'text-ink-3'}`}>
          {unit}
        </span>
      </div>
    </div>
  );
}
