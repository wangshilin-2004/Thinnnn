import { type NextRequest, NextResponse } from 'next/server';

import { getAllMeals, getAllWeights, MEAL_LABELS } from '@/db/queries';
import { getCurrentUser } from '@/lib/auth';
import { formatLocalDateTime } from '@/lib/calendar';
import { toCsvFile } from '@/lib/csv';
import { todayInTimezone } from '@/lib/nutrition';

/* 导出接口。用法：`/settings/export?kind=meals` / `?kind=weights`
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

type Kind = 'meals' | 'weights';

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

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    /* 下载链接被未登录的人点到 → 回登录页，而不是返回一个 401 的
     * 空白文件（用户会以为「导出坏了」）。 */
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const kind: Kind = request.nextUrl.searchParams.get('kind') === 'weights'
    ? 'weights'
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
