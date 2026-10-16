import { movingAverage, type TrendResult, type WeightPoint } from '@/lib/nutrition';

/* 体重趋势图（服务端渲染 SVG，无客户端 JS）。
 *
 * 这个图的表达重点是【主次分明】：
 *   细线 + 低透明度 = 每日实测（噪声，一天里上下 1-2 公斤是正常的）
 *   粗线 + 渐变面积 = 7 日移动平均（信号，这条才是该看的）
 *
 * 大多数 App 只画每日点，于是用户被日波动牵着情绪走。
 * 把两条线画在一起，用户第一眼看到的就是「日线在抖，但周线在稳稳下降」。
 */

type Props = {
  points: WeightPoint[];
  trend: TrendResult;
  height?: number;
};

const W = 720;
const PAD = { top: 16, right: 8, bottom: 8, left: 8 };

export function WeightTrend({ points, trend, height = 180 }: Props) {
  if (points.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded-lg bg-sunken text-subhead text-ink-3"
        style={{ height }}
      >
        还没有体重记录
      </div>
    );
  }

  const avg = movingAverage(points, 7);

  // y 轴范围取「两条线的整体极值」，不能只取日线 ——
  // 否则移动平均线可能画到画面外（它的端点会超出日线的范围）。
  const allValues = [
    ...points.map((p) => p.value),
    ...avg.map((p) => p.avg).filter((v): v is number => v !== null),
  ];
  let min = Math.min(...allValues);
  let max = Math.max(...allValues);
  // 全平的数据（min === max）会让比例尺除零，给一个人为的上下留白
  if (max - min < 0.2) {
    const mid = (max + min) / 2;
    min = mid - 0.5;
    max = mid + 0.5;
  }
  const pad = (max - min) * 0.15;
  min -= pad;
  max += pad;

  const firstMs = Date.parse(`${points[0]!.date}T00:00:00Z`);
  const lastMs = Date.parse(`${points[points.length - 1]!.date}T00:00:00Z`);
  const spanMs = Math.max(lastMs - firstMs, 86_400_000);

  const x = (date: string) =>
    PAD.left + ((Date.parse(`${date}T00:00:00Z`) - firstMs) / spanMs) * (W - PAD.left - PAD.right);

  const y = (v: number) =>
    PAD.top + (1 - (v - min) / (max - min)) * (height - PAD.top - PAD.bottom);

  const dailyPath = points.map((p) => `${x(p.date)},${y(p.value)}`).join(' ');

  const avgPoints = avg.filter((p) => p.avg !== null);
  const avgPath = avgPoints.map((p) => `${x(p.date)},${y(p.avg!)}`).join(' ');

  // 面积 = 平均线 + 底边闭合，用来做渐变填充
  const areaPath =
    avgPoints.length > 1
      ? `M ${x(avgPoints[0]!.date)},${y(avgPoints[0]!.avg!)} ` +
        avgPoints
          .slice(1)
          .map((p) => `L ${x(p.date)},${y(p.avg!)}`)
          .join(' ') +
        ` L ${x(avgPoints[avgPoints.length - 1]!.date)},${height - PAD.bottom}` +
        ` L ${x(avgPoints[0]!.date)},${height - PAD.bottom} Z`
      : '';

  const last = points[points.length - 1]!;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      className="w-full"
      preserveAspectRatio="none"
      role="img"
      aria-label={`体重趋势：${trend.message}`}
    >
      <defs>
        <linearGradient id="wt-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-data-weight)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-data-weight)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {areaPath && <path d={areaPath} fill="url(#wt-fill)" />}

      {/* 每日实测：细、淡、无端点。它的作用是提供「原始数据还在」的诚实感，
          不是让人去读每一个点。 */}
      <polyline
        points={dailyPath}
        fill="none"
        stroke="var(--color-data-weight)"
        strokeOpacity="0.3"
        strokeWidth="1.5"
        strokeLinejoin="round"
        style={{ vectorEffect: 'non-scaling-stroke' }}
      />

      {/* 7 日移动平均：粗、圆端点、实色。这是主角。 */}
      {avgPoints.length > 1 && (
        <polyline
          points={avgPath}
          fill="none"
          stroke="var(--color-data-weight)"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ vectorEffect: 'non-scaling-stroke' }}
        />
      )}

      {/* 最后一天加一个端点。preserveAspectRatio="none" 会把圆拉成椭圆，
          所以用 non-scaling-stroke 的描边技巧之外，这里靠 viewBox 与容器
          等宽来避免变形 —— r 用 4.5 是个视觉折中。 */}
      <circle cx={x(last.date)} cy={y(last.value)} r="4.5" fill="var(--color-data-weight)" />
    </svg>
  );
}
