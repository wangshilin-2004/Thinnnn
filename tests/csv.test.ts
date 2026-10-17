/**
 * ═══════════════════════════════════════════════════════════════
 *  CSV 生成测试
 * ═══════════════════════════════════════════════════════════════
 *
 *  运行：npm run test
 *
 *  为什么这个模块值得单独测：
 *
 *  CSV 坏掉的方式全是「静默」的 —— 文件能下载、能打开、看起来有数据，
 *  只是列错位了、中文乱码了、或者某一行被一个逗号劈成两半。
 *  用户不会报 bug，他会以为「这东西本来就导出不全」。
 *
 *  下面每种情况都对应一个真实踩过的坑，不是假想的边界。
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { csvCell, toCsv, toCsvFile } from '../src/lib/csv.ts';

describe('csvCell —— 单个字段', () => {
  it('普通文本不加引号', () => {
    assert.equal(csvCell('米饭'), '米饭');
    assert.equal(csvCell('2026-10-17'), '2026-10-17');
  });

  it('数字原样输出，不加千分位也不补小数位', () => {
    assert.equal(csvCell(1723.5), '1723.5');
    assert.equal(csvCell(0), '0');
    assert.equal(csvCell(1234567), '1234567');
  });

  it('null / undefined 输出空单元格，不是字符串 "null"', () => {
    // 「导出的表里出现了 null 三个字母」是用户要手删的经典垃圾
    assert.equal(csvCell(null), '');
    assert.equal(csvCell(undefined), '');
  });

  it('含逗号 → 整个字段加引号', () => {
    // 食物名「鸡胸肉, 水煮」里的逗号不处理，这一行就会被劈成两列
    assert.equal(csvCell('鸡胸肉, 水煮'), '"鸡胸肉, 水煮"');
  });

  it('含双引号 → 加引号且内部引号翻倍', () => {
    // CSV 的转义规则只有这一条，不是反斜杠
    assert.equal(csvCell('他说"好吃"'), '"他说""好吃"""');
  });

  it('含换行 → 整个字段加引号（换行本身保留）', () => {
    assert.equal(csvCell('第一行\n第二行'), '"第一行\n第二行"');
    assert.equal(csvCell('第一行\r\n第二行'), '"第一行\r\n第二行"');
  });

  it('空字符串是空单元格，且不加引号', () => {
    assert.equal(csvCell(''), '');
  });

  it('中文、emoji、全角标点不会被误转义', () => {
    assert.equal(csvCell('苹果🍎（一个）'), '苹果🍎（一个）');
  });
});

describe('toCsv —— 多行拼接', () => {
  it('用 CRLF 分隔行（Excel 与 Numbers 都认）', () => {
    const out = toCsv([
      ['日期', '热量'],
      ['2026-10-17', 410],
    ]);
    assert.equal(out, '日期,热量\r\n2026-10-17,410');
  });

  it('每一行内部用逗号分隔，字段数量不因转义而变化', () => {
    const out = toCsv([
      ['名称', '说明'],
      ['米饭', '含逗号, 的说明'],
    ]);
    // 第二行被引号包住的逗号不算分隔符
    assert.equal(out, '名称,说明\r\n米饭,"含逗号, 的说明"');
  });

  it('只有表头也能正常输出', () => {
    assert.equal(toCsv([['日期', '体重']]), '日期,体重');
  });

  it('null 出现在行中间不会让后面的列左移', () => {
    const out = toCsv([['a', null, 'c']]);
    assert.equal(out, 'a,,c');
  });
});

describe('toCsvFile —— 真正写进文件的形态', () => {
  it('以 BOM 开头', () => {
    // 没有 BOM，Excel 按系统编码解析 UTF-8 中文 → 全是乱码
    const out = toCsvFile([['日期']]);
    assert.equal(out.charCodeAt(0), 0xfeff);
  });

  it('BOM 之后紧跟表头，不以逗号或换行开头', () => {
    const out = toCsvFile([['日期', '热量']]);
    assert.equal(out.slice(1, 5), '日期,热');
  });

  it('末尾一定有 CRLF（缺了会被当成文件截断）', () => {
    const out = toCsvFile([['日期'], ['2026-10-17']]);
    assert.ok(out.endsWith('\r\n'));
  });

  it('一次导出多条记录的完整形态', () => {
    const out = toCsvFile([
      ['日期', '餐次', '食物', '克数', '热量'],
      ['2026-10-17', '午餐', '测试烤冷面', 260, 410],
      ['2026-10-16', '加餐', '全麦面包', 50, 86],
    ]);
    const lines = out.split('\r\n').filter(Boolean);
    assert.equal(lines.length, 3);
    assert.equal(lines[1], '2026-10-17,午餐,测试烤冷面,260,410');
  });
});
