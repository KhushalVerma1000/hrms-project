/**
 * Wide-format attendance CSV: template generation + parsing.
 *
 * No csv library dependency is added — the format is simple enough (no
 * embedded newlines in any field we write) that a small hand-rolled
 * RFC4180-ish quote/escape is safer than pulling in a new package for it.
 *
 * See attendance-upload-and-daily-register-spec.md §5 for the full design.
 * Two template modes:
 *   - "daily": ECode, Name, then a Status + OT pair of columns per calendar
 *     date ("1", "1_OT", "2", "2_OT", ...).
 *   - "total": ECode, Name, then one Status column per calendar date, then
 *     a single trailing OT_Hours column (monthly total).
 * Upload parsing auto-detects which mode a file is by its header shape —
 * the manager never has to declare it twice.
 */

import type { ManualAttendanceStatus } from '@prisma/client';

export type OtTemplateMode = 'daily' | 'total';

export const STATUS_CODES = ['P', 'A', 'HD', 'L', 'WO', 'H'] as const;
export type StatusCode = (typeof STATUS_CODES)[number];

export const STATUS_CODE_TO_ENUM: Record<StatusCode, ManualAttendanceStatus> = {
  P: 'PRESENT',
  A: 'ABSENT',
  HD: 'HALF_DAY',
  L: 'ON_LEAVE',
  WO: 'WEEK_OFF',
  H: 'HOLIDAY',
};

export const ENUM_TO_STATUS_CODE: Record<ManualAttendanceStatus, StatusCode> = {
  PRESENT: 'P',
  ABSENT: 'A',
  HALF_DAY: 'HD',
  ON_LEAVE: 'L',
  WEEK_OFF: 'WO',
  HOLIDAY: 'H',
};

export interface TemplateEmployeeRow {
  staffCode: string;
  name: string;
}

/** Number of calendar days in periodYear/periodMonth (periodMonth is 1-12). */
export function daysInMonth(periodYear: number, periodMonth: number): number {
  return new Date(periodYear, periodMonth, 0).getDate();
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds the downloadable CSV text for a store+month. Pre-fills ECode and
 * Name from the given roster (already filtered to active-at-this-store by
 * the caller) so the manager cross-checks the name against the ecode
 * before marking anything, rather than typing ecodes from memory.
 */
export function generateAttendanceTemplateCsv(
  employees: TemplateEmployeeRow[],
  periodYear: number,
  periodMonth: number,
  otMode: OtTemplateMode,
): string {
  const days = daysInMonth(periodYear, periodMonth);
  const dateColumns = Array.from({ length: days }, (_, i) => String(i + 1));

  const header: string[] = ['ECode', 'Name'];
  if (otMode === 'daily') {
    for (const d of dateColumns) {
      header.push(d, `${d}_OT`);
    }
  } else {
    header.push(...dateColumns, 'OT_Hours');
  }

  const rows = employees.map((emp) => {
    const cells: string[] = [emp.staffCode, emp.name];
    if (otMode === 'daily') {
      for (const _d of dateColumns) cells.push('', ''); // status, OT — both blank
    } else {
      for (const _d of dateColumns) cells.push(''); // status, blank
      cells.push(''); // OT_Hours, blank
    }
    return cells;
  });

  const lines = [header, ...rows].map((row) => row.map(csvEscape).join(','));
  return lines.join('\r\n') + '\r\n';
}

/** Minimal RFC4180 line splitter — handles quoted fields with embedded commas/quotes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

export interface ParsedAttendanceRow {
  rowIndex: number; // 1-based, matches spreadsheet row (header = row 1)
  staffCode: string;
  name: string;
  /// dayOfMonth (1-31) -> raw status cell text, uppercased, trimmed. Empty string = blank.
  statusByDay: Map<number, string>;
  /// Only set when otMode = 'daily'. dayOfMonth -> raw OT cell text.
  otByDay?: Map<number, string>;
  /// Only set when otMode = 'total'. Raw OT_Hours cell text.
  otTotal?: string;
}

export interface ParsedAttendanceCsv {
  otMode: OtTemplateMode;
  days: number[]; // the date columns actually present in the file, in order
  rows: ParsedAttendanceRow[];
}

/**
 * Parses raw CSV text into structured rows, detecting otMode from the
 * header shape. Does NOT validate against the DB (ecode existence, name
 * match, etc.) or against the target period's month — that's
 * validateParsedAttendance in actions.ts, which needs DB access. This
 * function only has to agree with generateAttendanceTemplateCsv's shape.
 */
export function parseAttendanceCsv(csvText: string): ParsedAttendanceCsv {
  const lines = csvText.split(/\r\n|\n|\r/).filter((l) => l.length > 0);
  if (lines.length === 0) {
    throw new Error('CSV file is empty.');
  }

  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  if (header[0] !== 'ECode' || header[1] !== 'Name') {
    throw new Error('CSV header must start with "ECode,Name" — this doesn\'t look like the downloaded template.');
  }

  // Detect mode: does the header contain any "N_OT" columns? -> daily.
  // Otherwise, does it end in "OT_Hours"? -> total. Otherwise: no OT columns
  // at all is treated as an error — the template always includes one or the other.
  const hasDailyOtColumns = header.some((h) => /^\d+_OT$/.test(h));
  const hasTotalOtColumn = header[header.length - 1] === 'OT_Hours';

  if (hasDailyOtColumns) {
    return parseDailyMode(header, lines);
  }
  if (hasTotalOtColumn) {
    return parseTotalMode(header, lines);
  }
  throw new Error(
    'Could not detect OT column format — expected either paired "N_OT" columns (daily mode) ' +
    'or a trailing "OT_Hours" column (total mode). Re-download the template rather than editing headers.',
  );
}

function parseDailyMode(header: string[], lines: string[]): ParsedAttendanceCsv {
  const days: number[] = [];
  const dayColIndex = new Map<number, { status: number; ot: number }>();

  for (let i = 2; i < header.length; i += 2) {
    const statusHeader = header[i];
    const otHeader = header[i + 1];
    const day = Number(statusHeader);
    if (!Number.isInteger(day) || otHeader !== `${statusHeader}_OT`) {
      throw new Error(`Unexpected column pair at position ${i + 1}: "${statusHeader}", "${otHeader}".`);
    }
    days.push(day);
    dayColIndex.set(day, { status: i, ot: i + 1 });
  }

  const rows: ParsedAttendanceRow[] = lines.slice(1).map((line, idx) => {
    const cells = parseCsvLine(line);
    const statusByDay = new Map<number, string>();
    const otByDay = new Map<number, string>();
    for (const day of days) {
      const cols = dayColIndex.get(day)!;
      statusByDay.set(day, (cells[cols.status] ?? '').trim().toUpperCase());
      otByDay.set(day, (cells[cols.ot] ?? '').trim());
    }
    return {
      rowIndex: idx + 2,
      staffCode: (cells[0] ?? '').trim(),
      name: (cells[1] ?? '').trim(),
      statusByDay,
      otByDay,
    };
  });

  return { otMode: 'daily', days, rows };
}

function parseTotalMode(header: string[], lines: string[]): ParsedAttendanceCsv {
  const dayColIndex = new Map<number, number>();
  const days: number[] = [];

  // Every column between index 2 and the last (OT_Hours) is a date column.
  for (let i = 2; i < header.length - 1; i++) {
    const day = Number(header[i]);
    if (!Number.isInteger(day)) {
      throw new Error(`Unexpected column "${header[i]}" at position ${i + 1} — expected a date number.`);
    }
    days.push(day);
    dayColIndex.set(day, i);
  }
  const otColIndex = header.length - 1;

  const rows: ParsedAttendanceRow[] = lines.slice(1).map((line, idx) => {
    const cells = parseCsvLine(line);
    const statusByDay = new Map<number, string>();
    for (const day of days) {
      statusByDay.set(day, (cells[dayColIndex.get(day)!] ?? '').trim().toUpperCase());
    }
    return {
      rowIndex: idx + 2,
      staffCode: (cells[0] ?? '').trim(),
      name: (cells[1] ?? '').trim(),
      statusByDay,
      otTotal: (cells[otColIndex] ?? '').trim(),
    };
  });

  return { otMode: 'total', days, rows };
}
