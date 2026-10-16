import { movingAverage, type WeightPoint } from '@/lib/nutrition';

/* 体重趋势 × 热量摄入 —— 本项目真正的差异点。
 *
 * 调研了 13 个开源项目（wger 7.1k★、Grocy 9.6k★、OpenNutriTracker 2.7k★ …），
 * 没有一个把这两条曲线画在同一根时间轴上：体重在「身体测量」模块，
 * 饮食在「营养」模块，两个月度报表互不相识。而这恰恰是减脂期
 * 最想问的问题 ——「我这周明明少吃了，体重怎么没动」。
 *
 * ── 为什么手写 SVG 而不是用 Recharts ──────────────────────────────
 *   1. 苹果健康那种图表的辨识度，一半来自**柱顶圆角**和**柱间留缝**，
 *      另一半来自细折线的圆头描边。这些在 SVG 里是原生属性
 *      （stroke-linecap / 自绘 path），而 Recharts 的 radius 做不到
 *      胶囊顶 + 段间隙，要自定义 shape 才行 —— 既然都要自绘 shape，
 *      不如直接自绘整张图，省掉 125 KB 的运行时。
 *   2. 服务端渲染：图表不需要任何客户端 JS，首屏直接可见。
 *      对「打开就想看一眼」的场景，这比进场动画重要。
 *   3. 主题切换靠 CSS 变量，Canvas 方案（ECharts）拿不到变量，
 *      切换主题时图表不会跟着变。
 *
 * ── 为什么坐标用 0–100 而不是 0–720，且文字全在 SVG 外面 ───────────
 *   最初的版本用 viewBox="0 0 720 292" + w-full。这在**手机上是错的**：
 *   卡片内宽只有 324px，等比缩放系数 = 324/720 = 0.45，于是
 *     · 整张图只有 131px 高（两个面板挤在一起）
 *     · SVG 里 text-[11px] 的标签实际渲染成 5px，肉眼不可读
 *   根因是**等比缩放**：显示宽度在 326（手机）到 900（桌面）之间变化
 *   2.76 倍，而图表高度必须两种设备都合适 —— 等比缩放做不到这件事。
 *
 *   所以这里把两条约束拆开：
 *     · 几何图形用 preserveAspectRatio="none" 自由拉伸，x 坐标是百分比；
 *     · 描边一律 vector-effect="non-scaling-stroke"，
 *       圆头端点因此永远是正圆，不会被拉成椭圆；
 *     · **所有文字搬到 HTML**，用正常的排版 token，永远清晰。
 *   代价是日期标签要靠 left:X% 定位，但换来的是两端都可读。
 *
 * 已知取舍：没有 hover tooltip（那需要客户端 JS）。代之以
 * 图下方的关键数字摘要 + 时间范围切换。
 */

export type TrendDay = {
  date: string; // YYYY-MM-DD
  weightKg: number | null;
  intakeKcal: number;
  itemCount: number;
  targetKcal: number | null;
};

/* viewBox 宽度取 100，于是 x 坐标天然就是百分比。
 * 左右各留 1.5：柱子有宽度，贴边会被裁掉一半。 */
const VB_W = 100;
const X0 = 1.5;
const X1 = 98.5;

const WEIGHT_H = 136; // 体重面板高度（也是它的 viewBox 高度，所以 y 坐标 = 像素）
const KCAL_H = 88;

export function CombinedTrend({ days }: { days: TrendDay[] }) {
  const n = days.length;

  /* 体重点：只取当天真记了体重的日子。移动平均必须按**日历天**算，
   * 不能按「有数据的点」算 —— 否则漏记三天的人会看到一条假的平滑曲线
   * （详见 nutrition.ts 里 movingAverage 的注释）。 */
  const weightPoints: WeightPoint[] = days
    .filter((d) => d.weightKg !== null)
    .map((d) => ({ date: d.date, value: d.weightKg as number }));

  if (n === 0) {
    return (
      <p className="rounded-md bg-card px-4 py-10 text-center text-subhead text-ink-3">
        这段时间还没有记录。
      </p>
    );
  }

  const avg = movingAverage(weightPoints, 7);
  /* avg 可能是 null（窗口内有效点不足）。这些点直接不画，而不是画成 0 ——
   * 体重 0 kg 会把 y 轴范围彻底毁掉。 */
  const avgByDate = new Map(
    avg.filter((p) => p.avg !== null).map((p) => [p.date, p.avg as number]),
  );

  /* ── y 轴范围：体重 ────────────────────────────────────────────
   * 上下各留 15% 余量。最小与最大相同时（比如只记过一天）会得到一条
   * 贴着边框的直线，所以给一个 0.4 kg 的最小跨度。 */
  const kgValues = [...weightPoints.map((p) => p.value), ...avgByDate.values()].filter((v) =>
    Number.isFinite(v),
  );
  let kgMin = kgValues.length ? Math.min(...kgValues) : 0;
  let kgMax = kgValues.length ? Math.max(...kgValues) : 1;
  if (kgMax - kgMin < 0.4) {
    const mid = (kgMin + kgMax) / 2;
    kgMin = mid - 0.2;
    kgMax = mid + 0.2;
  }
  const kgPad = (kgMax - kgMin) * 0.15;
  const kgLo = kgMin - kgPad;
  const kgHi = kgMax + kgPad;

  /* ── y 轴范围：热量 ────────────────────────────────────────────
   * 上界取「最大摄入」与「目标」的较大者，这样目标虚线一定在画面内。
   * 从 0 起算而不是从最小值起算：柱子的长度本身就是「多少」的编码，
   * 截断基线会让 1200 和 1300 看起来差一倍。 */
  const kcalTop = Math.max(
    ...days.map((d) => d.intakeKcal),
    ...days.map((d) => d.targetKcal ?? 0),
    1,
  );
  const kcalMax = kcalTop * 1.12;

  /* x 位置按**天序号**算，不按数据点序号 —— 漏记的日子要留出空白，
   * 否则「跳过三天」会被画成「连续三天」，趋势的斜率就骗人了。 */
  const xAt = (i: number) => (n > 1 ? X0 + (i * (X1 - X0)) / (n - 1) : (X0 + X1) / 2);

  const yWeight = (kg: number) => WEIGHT_H - ((kg - kgLo) / (kgHi - kgLo)) * WEIGHT_H;
  const yKcal = (k: number) => KCAL_H - (k / kcalMax) * KCAL_H;

  /* 每日实测折线要**在缺失处断开**，不能用一条 polyline 连过去 ——
   * 那会在两个相隔十天的点之间画一条直线，凭空造出一段趋势。 */
  const dailySegments: string[] = [];
  {
    let current: string[] = [];
    days.forEach((d, i) => {
      if (d.weightKg === null) {
        if (current.length > 1) dailySegments.push(current.join(' '));
        current = [];
      } else {
        current.push(`${xAt(i).toFixed(2)},${yWeight(d.weightKg).toFixed(2)}`);
      }
    });
    if (current.length > 1) dailySegments.push(current.join(' '));
  }

  const avgCoords = days
    .map((d, i) => {
      const v = avgByDate.get(d.date);
      return v === undefined ? null : { x: xAt(i), y: yWeight(v) };
    })
    .filter((c): c is { x: number; y: number } => c !== null);

  const avgLine = avgCoords.map((c) => `${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ');

  /* 面积填充：从均值折线的最后一个点垂到底边，再沿底边回到起点。
   * 只在有 ≥2 个均值点时画，单点画不出面积。 */
  const avgArea =
    avgCoords.length > 1
      ? `M${avgCoords[0]!.x.toFixed(2)},${WEIGHT_H} ` +
        avgCoords.map((c) => `L${c.x.toFixed(2)},${c.y.toFixed(2)}`).join(' ') +
        ` L${avgCoords[avgCoords.length - 1]!.x.toFixed(2)},${WEIGHT_H} Z`
      : '';

  const targetKcal = days.find((d) => d.targetKcal !== null)?.targetKcal ?? null;
  const latestKg = weightPoints.length ? weightPoints[weightPoints.length - 1]!.value : null;

  /* 日期标签：最多 5 个，均匀取。取整除法而不是按固定间隔 —— 
   * 7 天和 90 天都能得到合理的密度。 */
  const labelCount = Math.min(5, n);
  const labelIdx = new Set(
    Array.from({ length: labelCount }, (_, k) =>
      labelCount === 1 ? 0 : Math.round((k * (n - 1)) / (labelCount - 1)),
    ),
  );

  const hasWeight = weightPoints.length > 0;

  return (
    <div>
      {/* ══ 上：体重 ══════════════════════════════════════════════ */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-caption-1 text-ink-3">体重</span>
        {hasWeight && (
          <span className="tabular text-caption-1 text-ink-4">
            {kgLo.toFixed(1)} – {kgHi.toFixed(1)} kg
          </span>
        )}
      </div>

      <div className="relative mt-1" style={{ height: WEIGHT_H }}>
        {hasWeight ? (
          <svg
            viewBox={`0 0 ${VB_W} ${WEIGHT_H}`}
            preserveAspectRatio="none"
            className="h-full w-full"
            role="img"
            aria-label={`体重趋势，${weightPoints.length} 天有记录，最新 ${latestKg} kg`}
          >
            <defs>
              <linearGradient id="ct-weight-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-data-weight)" stopOpacity="0.20" />
                <stop offset="100%" stopColor="var(--color-data-weight)" stopOpacity="0" />
              </linearGradient>
            </defs>

            {avgArea && <path d={avgArea} fill="url(#ct-weight-fill)" />}

            {dailySegments.map((seg, i) => (
              <polyline
                key={i}
                points={seg}
                fill="none"
                stroke="var(--color-data-weight)"
                strokeWidth="1.4"
                strokeOpacity="0.35"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {avgLine && (
              <polyline
                points={avgLine}
                fill="none"
                stroke="var(--color-data-weight)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
        ) : (
          <p className="flex h-full items-center justify-center text-caption-1 text-ink-3">
            还没有体重记录
          </p>
        )}
      </div>

      {/* ══ 下：热量 ══════════════════════════════════════════════ */}
      <div className="mt-3 flex items-baseline justify-between gap-2">
        <span className="text-caption-1 text-ink-3">每日摄入</span>
        {targetKcal !== null && (
          <span className="tabular text-caption-1 text-ink-4">目标 {targetKcal} kcal</span>
        )}
      </div>

      <div className="relative mt-1" style={{ height: KCAL_H }}>
        <svg
          viewBox={`0 0 ${VB_W} ${KCAL_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label={`每日热量摄入，共 ${n} 天`}
        >
          {targetKcal !== null && (
            <line
              x1={X0}
              y1={yKcal(targetKcal)}
              x2={X1}
              y2={yKcal(targetKcal)}
              stroke="var(--color-ink-3)"
              strokeWidth="1"
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )}

          {/* 柱子用「圆头描边的竖线」而不是 <rect>：
           * preserveAspectRatio="none" 会把矩形和它的 rx 横向拉长，
           * 圆角变成扁椭圆；而 non-scaling-stroke 的线帽是**设备像素**里
           * 画的，无论横向拉伸多少倍都保持正圆。 */}
          {days.map((d, i) => {
            if (d.intakeKcal <= 0) return null;
            const over = targetKcal !== null && d.intakeKcal > targetKcal;
            const y = yKcal(d.intakeKcal);
            return (
              <line
                key={d.date}
                x1={xAt(i)}
                y1={KCAL_H}
                x2={xAt(i)}
                y2={y}
                className="ct-bar"
                stroke="var(--color-data-intake)"
                strokeOpacity={over ? 1 : 0.45}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}

          {/* 基线：柱子是圆头的，没有基线会像浮在空中 */}
          <line
            x1={X0}
            y1={KCAL_H}
            x2={X1}
            y2={KCAL_H}
            stroke="var(--color-separator)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>

      {/* ── x 轴日期（HTML，不是 SVG text —— 见文件头注释） ────── */}
      <div className="relative mt-1 h-4">
        {days.map((d, i) =>
          labelIdx.has(i) ? (
            <span
              key={d.date}
              className="tabular absolute -translate-x-1/2 text-caption-2 text-ink-3"
              style={{ left: `${xAt(i)}%` }}
            >
              {d.date.slice(5).replace('-', '/')}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}
