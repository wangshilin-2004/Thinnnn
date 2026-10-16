/* 今日热量环。
 *
 * 为什么手写 SVG 而不用 Recharts：
 *   Recharts 是客户端组件，为了一个环要多下载 125 KB 并等 hydration。
 *   这个环是静态的，服务端渲染的 <svg> 就够了，还能直接读 CSS 变量。
 *
 * 为什么 strokeLinecap="round" 很重要：
 *   苹果健康/健身里的进度环端点都是圆的。默认的 butt 端点会让
 *   进度条像被刀切断，一眼就不像苹果。
 */

type Props = {
  intake: number;
  target: number;
  size?: number;
  stroke?: number;
};

export function CalorieRing({ intake, target, size = 176, stroke = 14 }: Props) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;

  const ratio = target > 0 ? intake / target : 0;
  // 环最多画满一圈。超过了不画第二圈（那会绕回来盖住起点），
  // 改用颜色和文案表达「超了」，这样信息不会因为视觉截断而丢失。
  const drawn = Math.min(Math.max(ratio, 0), 1);
  const offset = circumference * (1 - drawn);

  const over = intake > target && target > 0;
  const remaining = Math.max(target - intake, 0);

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // -90 度让弧线从 12 点方向开始，而不是 3 点
        style={{ transform: 'rotate(-90deg)' }}
        role="img"
        aria-label={`今日摄入 ${Math.round(intake)} 千卡，目标 ${target} 千卡`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-separator)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={over ? 'var(--color-data-intake)' : 'var(--color-brand)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>

      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1">
        <span className="text-footnote text-ink-3">今日摄入</span>
        <span className="tabular text-title-1 font-semibold tracking-title text-ink">
          {Math.round(intake).toLocaleString('zh-CN')}
        </span>
        <span className="text-caption-1 text-ink-3">
          {/* 取整到整卡。显示「还可吃 977.5 kcal」会让人以为精度很有意义，
              但热量估算本身的误差远大于 0.5 kcal —— 小数点在这里是假精确。 */}
          {over
            ? `超出 ${Math.round(intake - target).toLocaleString('zh-CN')} kcal`
            : `还可吃 ${Math.round(remaining).toLocaleString('zh-CN')} kcal`}
        </span>
      </div>
    </div>
  );
}

/** 三大营养素的一条横向进度条。
 *  颜色之外还有文字数值 —— 依据 HIG：「不要只靠颜色传达信息」，
 *  红绿色盲用户看不出蓝/紫的区别，必须有数字兜底。 */
export function MacroBar({
  label,
  value,
  target,
  colorVar,
}: {
  label: string;
  value: number;
  target: number;
  colorVar: string;
}) {
  const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-subhead text-ink-2">{label}</span>
        <span className="tabular text-subhead text-ink">
          <span className="font-semibold">{Math.round(value)}</span>
          <span className="text-ink-3"> / {Math.round(target)} g</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-separator">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${pct}%`, background: colorVar }}
        />
      </div>
    </div>
  );
}
