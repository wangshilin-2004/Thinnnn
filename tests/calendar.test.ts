/**
 * ═══════════════════════════════════════════════════════════════
 *  日历排布与日期展示测试
 * ═══════════════════════════════════════════════════════════════
 *
 *  运行：npm run test
 *
 *  为什么这个模块值得单独测：
 *
 *  热力图和日期标签出错是「静默」的 —— 界面不会崩，只是悄悄错一格。
 *  「周一那格显示了周二的数据」「2 月 31 日被渲染成 3 月 3 日」
 *  这两种 bug 光看页面看不出来，必须靠断言钉住。
 *
 *  另一个重点：**不能依赖运行机器的时区**。服务器跑 UTC、用户在东八区，
 *  如果实现里用了本地时间的 getDay()/getDate()，同一段代码在两边
 *  会算出不同的星期。所以下面特意挑了几个跨月、跨年、闰年的日期。
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  buildCalendarGrid,
  formatCnDate,
  formatCnMonthDay,
  formatShort,
  isDateString,
  monthLabels,
  relativeDayLabel,
  weekdayIndex,
} from '../src/lib/calendar.ts';

// ═══════════════════════════════════════════════════════════════
describe('isDateString：只放行真实存在的日期', () => {
  it('正常日期', () => {
    assert.equal(isDateString('2026-10-15'), true);
    assert.equal(isDateString('2000-01-01'), true);
    assert.equal(isDateString('2026-12-31'), true);
  });

  it('格式不对', () => {
    assert.equal(isDateString(''), false);
    assert.equal(isDateString('2026-1-5'), false, '月份日份必须补零');
    assert.equal(isDateString('2026/10/15'), false);
    assert.equal(isDateString('20261015'), false);
    assert.equal(isDateString('2026-10-15T00:00:00Z'), false, '不接受完整时间戳');
    assert.equal(isDateString('abc'), false);
  });

  it('格式对但那天不存在', () => {
    // 这是本函数存在的全部理由：正则挡不住这个。
    assert.equal(isDateString('2026-02-31'), false);
    assert.equal(isDateString('2026-04-31'), false, '四月只有 30 天');
    assert.equal(isDateString('2026-13-01'), false);
    assert.equal(isDateString('2026-00-10'), false);
    assert.equal(isDateString('2026-10-00'), false);
    assert.equal(isDateString('2026-10-32'), false);
  });

  it('闰年 2 月 29 日', () => {
    assert.equal(isDateString('2024-02-29'), true, '2024 是闰年');
    assert.equal(isDateString('2026-02-29'), false, '2026 不是');
    assert.equal(isDateString('1900-02-29'), false, '整百年不闰');
    assert.equal(isDateString('2000-02-29'), true, '四百年又闰');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('weekdayIndex：0 = 周日', () => {
  it('和已知的星期对得上（这组日期是项目截图里核对过的）', () => {
    // 2026-10-17 在界面上显示为「周六」，从它反推相邻几天。
    assert.equal(weekdayIndex('2026-10-17'), 6, '周六');
    assert.equal(weekdayIndex('2026-10-16'), 5, '周五');
    assert.equal(weekdayIndex('2026-10-15'), 4, '周四');
    assert.equal(weekdayIndex('2026-10-18'), 0, '周日');
    assert.equal(weekdayIndex('2026-10-19'), 1, '周一');
  });

  it('跨年边界', () => {
    // 2027-01-01 是周五
    assert.equal(weekdayIndex('2027-01-01'), 5);
    assert.equal(weekdayIndex('2026-12-31'), 4);
  });

  it('闰年 2 月 29 日当天是周六', () => {
    assert.equal(weekdayIndex('2024-02-29'), 4);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('中文格式', () => {
  it('完整日期带星期', () => {
    assert.equal(formatCnDate('2026-10-15'), '2026 年 10 月 15 日 · 周四');
    assert.equal(formatCnDate('2026-01-01'), '2026 年 1 月 1 日 · 周四');
  });

  it('月日不带年份、不补零', () => {
    assert.equal(formatCnMonthDay('2026-10-05'), '10 月 5 日');
    assert.equal(formatCnMonthDay('2026-01-31'), '1 月 31 日');
  });

  it('紧凑格式给热力图用', () => {
    assert.equal(formatShort('2026-10-05'), '10/5');
    assert.equal(formatShort('2026-12-31'), '12/31');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('relativeDayLabel：只做三天', () => {
  const today = '2026-10-17';

  it('今天 / 昨天 / 前天', () => {
    assert.equal(relativeDayLabel('2026-10-17', today), '今天');
    assert.equal(relativeDayLabel('2026-10-16', today), '昨天');
    assert.equal(relativeDayLabel('2026-10-15', today), '前天');
  });

  it('再往前不给标签（「9 天前」对人没有直觉）', () => {
    assert.equal(relativeDayLabel('2026-10-14', today), null);
    assert.equal(relativeDayLabel('2026-09-17', today), null);
  });

  it('未来也不给标签', () => {
    assert.equal(relativeDayLabel('2026-10-18', today), null);
  });

  it('跨月仍然算得对', () => {
    assert.equal(relativeDayLabel('2026-09-30', '2026-10-01'), '昨天');
    assert.equal(relativeDayLabel('2026-12-31', '2027-01-01'), '昨天');
  });
});

// ═══════════════════════════════════════════════════════════════
describe('buildCalendarGrid：列 = 周，行 = 星期几', () => {
  it('周六单独一天：前面补六个空位', () => {
    const weeks = buildCalendarGrid('2026-10-17', '2026-10-17');
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]!.length, 7);
    assert.equal(weeks[0]![6]!.date, '2026-10-17');
    for (let i = 0; i < 6; i += 1) assert.equal(weeks[0]![i], null);
  });

  it('周日开头：第一格就是数据，没有补位', () => {
    const weeks = buildCalendarGrid('2026-10-18', '2026-10-18');
    assert.equal(weeks[0]![0]!.date, '2026-10-18');
  });

  it('周四到周六：行号 4/5/6，前四格空', () => {
    const weeks = buildCalendarGrid('2026-10-15', '2026-10-17');
    assert.equal(weeks.length, 1);
    assert.equal(weeks[0]![4]!.date, '2026-10-15');
    assert.equal(weeks[0]![5]!.date, '2026-10-16');
    assert.equal(weeks[0]![6]!.date, '2026-10-17');
  });

  it('跨月：月末两天在第一列尾巴，月初两天在第二列开头', () => {
    const weeks = buildCalendarGrid('2026-10-30', '2026-11-02');
    assert.equal(weeks.length, 2);
    // 10-30 是周五
    assert.equal(weeks[0]![5]!.date, '2026-10-30');
    assert.equal(weeks[0]![6]!.date, '2026-10-31');
    assert.equal(weeks[1]![0]!.date, '2026-11-01');
    assert.equal(weeks[1]![1]!.date, '2026-11-02');
    assert.equal(weeks[1]![2], null);
  });

  it('连续 30 天：不多不少，每列都是 7 格', () => {
    const weeks = buildCalendarGrid('2026-10-01', '2026-10-30');
    const cells = weeks.flat();
    assert.equal(cells.length % 7, 0);
    const dates = cells.filter((c) => c !== null);
    assert.equal(dates.length, 30);
    assert.equal(dates[0]!.date, '2026-10-01');
    assert.equal(dates[29]!.date, '2026-10-30');
  });

  it('跨年不出错', () => {
    const weeks = buildCalendarGrid('2026-12-28', '2027-01-03');
    const dates = weeks.flat().filter((c) => c !== null);
    assert.equal(dates.length, 7);
    assert.equal(dates[0]!.date, '2026-12-28');
    assert.equal(dates[6]!.date, '2027-01-03');
  });

  it('from 晚于 to 时返回空数组，不崩', () => {
    assert.deepEqual(buildCalendarGrid('2026-10-17', '2026-10-10'), []);
  });
});

// ═══════════════════════════════════════════════════════════════
describe('monthLabels：只在列里出现 1 号时标一次', () => {
  it('跨月那列标出新月份', () => {
    const weeks = buildCalendarGrid('2026-10-30', '2026-11-02');
    assert.deepEqual(monthLabels(weeks), [null, 11]);
  });

  it('整段里没有 1 号：一个标签都没有', () => {
    // 2026-10-18 是周日，正好一整周，不会多出一列
    const weeks = buildCalendarGrid('2026-10-18', '2026-10-24');
    assert.equal(weeks.length, 1);
    assert.deepEqual(monthLabels(weeks), [null]);
  });

  it('正好包含 1 号的那列才有', () => {
    const weeks = buildCalendarGrid('2026-09-28', '2026-10-04');
    // 2026-09-28 是周一，所以这一列前面有一个空位；
    // 10-01（周四）落在第一列，之后还剩一列装 10-04。
    assert.equal(weeks.length, 2);
    assert.deepEqual(monthLabels(weeks), [10, null]);
  });
});
