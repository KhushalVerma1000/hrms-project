/**
 * CSV writer for report downloads.
 *  - UTF-8 BOM so Excel opens Hindi/accented names correctly.
 *  - CRLF line endings (what Excel expects).
 *  - Formula-injection guard: a cell starting with = + - @ (or tab/CR) would be
 *    run as a formula when opened in Excel/Sheets, and names come from user
 *    input, so those get a leading apostrophe-style quote prefix.
 */
const DANGEROUS_START = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let s = typeof value === 'number' ? String(value) : String(value);
  // Plain negative numbers are data, not formulas.
  if (typeof value !== 'number' && DANGEROUS_START.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][], preamble: string[] = []): string {
  const lines = [
    ...preamble.map((l) => csvCell(l)),
    ...(preamble.length ? [''] : []),
    header.map(csvCell).join(','),
    ...rows.map((r) => r.map(csvCell).join(',')),
  ];
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
