/* CSV 生成。
 *
 * 单独成文件是为了能脱离数据库单测 —— 这里只有三个「看起来能跑、
 * 其实坏了」的坑，每一个都值得写测试钉住：
 *
 *   1. **BOM**：不加 `\ufeff` 时 Excel 会按系统本地编码打开，中文列名
 *      全是乱码。这是「导出功能演示时能用、用户拿到手是废文件」最常见的死法。
 *   2. **转义**：逗号、双引号、换行都会把表格切错位。食物名里带逗号
 *      （「鸡胸肉, 水煮」）完全可能，换行也可能出现在备注里。
 *   3. **null**：必须输出空单元格，不能输出字符串 "null"。
 *
 * 行尾用 CRLF：Excel 和 Numbers 都认，只用 LF 的话在 Windows 记事本里
 * 会挤成一行。
 */

/** 需要加引号的字符：逗号、双引号、回车、换行。 */
const NEEDS_QUOTE = /[",\r\n]/;

/**
 * 把一个单元格转成 CSV 字段。
 *
 * 数字不转成千分位、不补小数位 —— CSV 是给机器和表格读的，
 * 格式化的活留给 Excel。
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (!NEEDS_QUOTE.test(s)) return s;
  /* CSV 的转义规则只有一条：整个字段包在双引号里，
   * 字段内部的双引号写两遍。不是反斜杠转义。 */
  return `"${s.replaceAll('"', '""')}"`;
}

/** 行数组 → CSV 文本（不含 BOM）。 */
export function toCsv(
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}

/**
 * 行数组 → 可以直接写进响应体的 CSV 文件内容。
 *
 * 末尾补一个换行：部分解析器（含 Excel 的某些版本）把「没有结尾换行」
 * 当成文件被截断。
 */
export function toCsvFile(
  rows: readonly (readonly (string | number | null | undefined)[])[],
): string {
  return `\ufeff${toCsv(rows)}\r\n`;
}
