/**
 * ═══════════════════════════════════════════════════════════════
 *  日历排布与日期展示
 * ═══════════════════════════════════════════════════════════════
 *
 * 这个模块为什么存在，以及它和 `nutrition.ts` 里那些日期函数的分工：
 *
 *   · 日期**运算**（今天是哪天、加减 N 天）在 `nutrition.ts` 的
 *     `todayInTimezone()` / `addDays()` —— 那是全项目最早用到日期的地方，
 *     而且 `parseDate()` / `toDayNumber()` 还被营养计算的移动平均等内部
 *     函数用着，搬出来会牵动一大片。不动它。
 *
 *   · 这个模块只管 `/history` 与 `/day/[date]` 新需要的两件事：
 *       1. **校验**从 URL 里来的日期（用户能直接改地址栏，必须挡住脏值）
 *       2. **排布与展示**：把日期排成日历格子、显示成中文
 *
 * 纯函数、不碰数据库、不读环境变量 —— 所以能被 `tests/calendar.test.ts`
 * 直接跑，不需要起服务或连库。
 */

/* 为什么到处都用 Date.UTC 而不是 `new Date('2026-10-15')`：
 *
 * `new Date('YYYY-MM-DD')` 按 **UTC 零点**解析。在 UTC+8 的机器上，
 * 它变成北京时间 10 月 15 日 08:00 —— 取 getDay() 还是对的，但一旦
 * 有人写成 getDate() 再拼回去，就整体错一天。更阴的是服务器跑在 UTC、
 * 用户在东八区，同一个值在两边算出不同的星期。
 *
 * 所以这里全部走「UTC 三件套」：Date.UTC 构造 + getUTC* 读取。
 * 传入的日期字符串本身就没有时区概念，用 UTC 当它的坐标系是最诚实的。 */

/** 星期几的中文，下标 0 = 周日，和 Date.getUTCDay() 对齐 */
const WEEKDAY_CN = ['日', '一', '二', '三', '四', '五', '六'] as const;

/** 热身：把 'YYYY-MM-DD' 拆成三个数字。调用前必须已过 isDateString()。 */
function parts(date: string): [number, number, number] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  /* 走到这里说明调用方没先校验。抛错而不是返回兜底值 ——
   * 静默用 1970-01-01 顶上，界面上会显示一个看似正常但完全错误的日期，
   * 那种 bug 比直接崩难查一百倍。 */
  if (!m) throw new Error(`日期格式必须是 YYYY-MM-DD，收到：${date}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * 是不是一个「真实存在」的 `YYYY-MM-DD`。
 *
 * 只对格式做正则是不够的：`2026-02-31` 格式合法但那天不存在，
 * `new Date(Date.UTC(2026, 1, 31))` 会静默滚到 3 月 3 日。
 * 所以构造完再回读三个字段逐一比对 —— 滚动了就说明原值非法。
 *
 * 用途：`/day/2026-13-45` 这种 URL 必须返回 404，而不是渲染一页空数据
 * 让人以为「那天我没记」。区分「没记」和「没这天」对用户是有意义的。
 */
export function isDateString(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return (
    dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d
  );
}

/** 0 = 周日 … 6 = 周六。热力图要靠它把每列对齐到同一个星期几。 */
export function weekdayIndex(date: string): number {
  const [y, mo, d] = parts(date);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** 两个日期差几天（b - a）。只用于「今天/昨天/前天」这种相对标签。 */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = parts(a);
  const [by, bm, bd] = parts(b);
  const MS = 86_400_000;
  return Math.round(
    (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / MS,
  );
}

/** `2026-10-15` → `2026 年 10 月 15 日 · 周四` */
export function formatCnDate(date: string): string {
  const [y, mo, d] = parts(date);
  return `${y} 年 ${mo} 月 ${d} 日 · 周${WEEKDAY_CN[weekdayIndex(date)]}`;
}

/** `2026-10-15` → `周四` */
export function formatCnWeekday(date: string): string {
  return `周${WEEKDAY_CN[weekdayIndex(date)]}`;
}

/** `2026-10-15` → `10 月 15 日`。列表里用，省掉年份。 */
export function formatCnMonthDay(date: string): string {
  const [, mo, d] = parts(date);
  return `${mo} 月 ${d} 日`;
}

/** `2026-10-15` → `10/15`。热力图下方的紧凑标签用。 */
export function formatShort(date: string): string {
  const [, mo, d] = parts(date);
  return `${mo}/${d}`;
}

/**
 * 相对今天的叫法：今天 / 昨天 / 前天。超出这个范围返回 null，
 * 让调用方自己决定显示完整日期还是别的。
 *
 * 为什么只做三天：再往前说「3 天前」对人已经失去直觉了 ——
 * 用户心里想的是「上周三」，不是「9 天前」。
 */
export function relativeDayLabel(date: string, today: string): string | null {
  const diff = dayDiff(date, today);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff === 2) return '前天';
  return null;
}

/**
 * 把 [from, to] 排成 GitHub 那种「列 = 周、行 = 星期几」的网格。
 *
 * 返回的每个格子是 `{ date }` 或 `null`（补位）。补位是必须的：
 * 2026-10-15 是周四，那一列前面四格要留空，否则整张热力图会错位，
 * 「周一那格」会被画成周三的数据 —— 这种错误看图是发现不了的。
 *
 * 行序固定为 周日→周六（`weekdayIndex` 的返回值直接当行号）。
 *
 * 调用方保证 from <= to，且两个都是合法日期。这里不重复校验，
 * 因为参数来自服务端计算（today 减 N 天），不是用户输入。
 */
export function buildCalendarGrid(
  from: string,
  to: string,
): ({ date: string } | null)[][] {
  const total = dayDiff(from, to) + 1;
  if (total <= 0) return [];

  const leading = weekdayIndex(from);
  const cells: ({ date: string } | null)[] = Array.from(
    { length: leading },
    () => null,
  );

  /* 逐日推进：用 UTC 毫秒加一天，而不是自己处理月末进位。
   * 跨月、跨年、闰年二月都由 Date 内部算掉。 */
  const [fy, fm, fd] = parts(from);
  const startMs = Date.UTC(fy, fm - 1, fd);
  for (let i = 0; i < total; i += 1) {
    const dt = new Date(startMs + i * 86_400_000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    cells.push({ date: `${y}-${m}-${d}` });
  }

  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: ({ date: string } | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/**
 * 热力图上方那排月份标签：只在「这一列包含某月 1 号」的位置标一次。
 *
 * 返回一个长度等于 weeks.length 的数组，元素是要显示的月份数字或 null。
 * 用 1 号来判断是因为一列可能跨月，用户需要知道哪列开始换月了。
 */
export function monthLabels(
  weeks: ({ date: string } | null)[][],
): (number | null)[] {
  return weeks.map((week) => {
    const firstOfMonth = week.find((c) => c !== null && c.date.endsWith('-01'));
    if (!firstOfMonth) return null;
    return Number(firstOfMonth.date.slice(5, 7));
  });
}
