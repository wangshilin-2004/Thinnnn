import { type NextRequest, NextResponse } from 'next/server';

import {
  getAllCardio,
  getAllMeals,
  getAllStrength,
  getAllWater,
  getAllWeights,
  MEAL_LABELS,
} from '@/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatLocalDateTime } from '@/lib/calendar';
import { toCsvFile } from '@/lib/csv';
import { todayInTimezone } from '@/lib/nutrition';

/* 导出接口。用法：`/settings/export?kind=meals` / `?kind=weights` / `?kind=training` / `?kind=water`
 *
 * 为什么是一个 Route Handler 而不是 server action：
 * server action 的返回值要经过 React 的序列化管道，塞不进
 * `Content-Disposition: attachment` 这种响应头。下载必须由浏览器
 * 发起一个真正的 GET 请求。
 *
 * 文件名用 ASCII：中文文件名要靠 RFC 5987 的 `filename*=UTF-8''…`
 * 才能在部分浏览器上正确落地，而 Safari 旧版对这一段的支持并不可靠。
 * 中文只出现在 CSV 内部（表头与数据），文件名保持纯 ASCII 最稳。
 */

export const dynamic = 'force-dynamic';

const INTENSITY_TEXT: Record<string, string> = {
  easy: '轻松',
  moderate: '适中',
  hard: '吃力',
};

type Kind = 'meals' | 'weights' | 'training' | 'water';

const MEAL_COLUMNS = [
  '日期',
  '餐次',
  '食物',
  '份量',
  '克数',
  '热量(kcal)',
  '蛋白质(g)',
  '脂肪(g)',
  '碳水(g)',
  '记录时间',
  '备注',
] as const;

const WEIGHT_COLUMNS = ['日期', '体重(kg)', '测量时间', '备注'] as const;

/* 训练用一张表装两种记录（有氧 / 力量），靠「类型」列区分。
 * 分成两个文件会让「我某天练了什么」这件事被拆开，还得自己对时间 ——
 * 而 CSV 的读者只想按日期排序看一眼。空列（有氧没有组数、力量没有分钟）
 * 留空而不是填 0：0 组和「不是力量训练」是两件事。 */
const WATER_COLUMNS = ['日期', '时间', '毫升'];

const TRAINING_COLUMNS = [
  '日期',
  '类型',
  '项目',
  '时长(分钟)',
  '强度',
  '距离(km)',
  '部位',
  '组数',
  '次数',
  '重量(kg)',
  '备注',
] as const;

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    /* 下载链接被未登录的人点到 → 回登录页，而不是返回一个 401 的
     * 空白文件（用户会以为「导出坏了」）。 */
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const rawKind = request.nextUrl.searchParams.get('kind');
  const kind: Kind =
    rawKind === 'weights'
      ? 'weights'
      : rawKind === 'training'
        ? 'training'
        : rawKind === 'water'
          ? 'water'
          : 'meals';

  const rows: (string | number | null)[][] = [];
  let filename: string;

  if (kind === 'weights') {
    const weights = await getAllWeights(user.id);
    rows.push([...WEIGHT_COLUMNS]);
    for (const w of weights) {
      rows.push([
        w.date,
        w.weightKg,
        w.measuredAt === null ? null : formatLocalDateTime(w.measuredAt, user.timezone),
        w.note,
      ]);
    }
    filename = `slim-weights-${todayInTimezone(user.timezone)}.csv`;
  } else if (kind === 'water') {
    const water = await getAllWater(user.id);
    rows.push([...WATER_COLUMNS]);
    for (const entry of water) {
      rows.push([entry.date, formatLocalDateTime(entry.loggedAt.toISOString(), user.timezone), entry.amountMl]);
    }
    filename = `slim-water-${todayInTimezone(user.timezone)}.csv`;
  } else if (kind === 'training') {
    const [cardio, strength] = await Promise.all([
      getAllCardio(user.id),
      getAllStrength(user.id),
    ]);
    rows.push([...TRAINING_COLUMNS]);
    /* 按日期排好再输出：两种记录各查一次，合并后必须重排，
     * 否则文件里会先是一整段有氧、再是一整段力量。 */
    const merged = [
      ...cardio.map((c) => ({ date: c.date, cells: [c.date, '有氧', c.activityName, c.minutes, INTENSITY_TEXT[c.intensity] ?? c.intensity, c.distanceKm, null, null, null, null, c.note] })),
      ...strength.map((s2) => ({ date: s2.date, cells: [s2.date, '力量', s2.exerciseName, null, null, null, s2.part, s2.sets, s2.reps, s2.weightKg, s2.note] })),
    ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    for (const row of merged) rows.push(row.cells as (string | number | null)[]);
    filename = `slim-training-${todayInTimezone(user.timezone)}.csv`;
  } else {
    const meals = await getAllMeals(user.id);
    rows.push([...MEAL_COLUMNS]);
    for (const m of meals) {
      rows.push([
        m.date,
        MEAL_LABELS[m.mealType] ?? m.mealType,
        m.foodName,
        m.servingLabel,
        m.quantityG,
        m.kcal,
        m.proteinG,
        m.fatG,
        m.carbG,
        formatLocalDateTime(m.loggedAt, user.timezone),
        m.note,
      ]);
    }
    filename = `slim-meals-${todayInTimezone(user.timezone)}.csv`;
  }

  return new NextResponse(toCsvFile(rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      /* 导出的是用户隐私数据，任何缓存层都不该留一份 */
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}
