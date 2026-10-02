/**
 * Report periods. Pure functions, no I/O — everything is a 'YYYY-MM-DD' string
 * so there are no timezone surprises (a "day" here is the store's calendar day).
 *
 * Quarters/years default to the Indian financial year (Apr–Mar), because that
 * is how payroll and compliance reports are cut. `basis: 'calendar'` gives
 * Jan–Dec instead.
 */

export type PeriodType = 'month' | 'quarter' | 'year' | 'custom';
export type YearBasis = 'fy' | 'calendar';

export interface PeriodInput {
  type: PeriodType;
  /** Month/calendar year, or the year a financial year STARTS in (FY 2026-27 → 2026). */
  year: number;
  /** 1–12. Used when type = 'month'. */
  month: number;
  /** 1–4. Used when type = 'quarter'. Q1 = Apr–Jun under 'fy'. */
  quarter: number;
  basis: YearBasis;
  /** Used when type = 'custom'. */
  from?: string;
  to?: string;
}

export interface ResolvedPeriod {
  type: PeriodType;
  from: string;
  to: string;
  label: string;
  /** Every 'YYYY-MM' the range touches, in order. */
  months: string[];
}

export const MAX_CUSTOM_SPAN_DAYS = 366;

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ─── date-key helpers ───────────────────────────────────────────────────────

export function isDateKey(s: string | undefined | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

const toUtc = (key: string) => new Date(`${key}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(key: string, n: number): string {
  const d = toUtc(key);
  d.setUTCDate(d.getUTCDate() + n);
  return toKey(d);
}

/** Whole days from a to b (b - a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86_400_000);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let k = from; k <= to; k = addDays(k, 1)) out.push(k);
  return out;
}

export const monthOf = (key: string) => key.slice(0, 7);

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function lastDayOfMonth(year: number, month: number): string {
  return toKey(new Date(Date.UTC(year, month, 0)));
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const end = to.slice(0, 7);
  for (;;) {
    const ym = `${y}-${String(m).padStart(2, '0')}`;
    out.push(ym);
    if (ym >= end) break;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

// ─── resolution ─────────────────────────────────────────────────────────────

/** Financial-year label, e.g. 2026 → "FY 2026-27". */
export const fyLabel = (startYear: number) => `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;

/** The financial year (start year) that a given date falls in. */
export const fyStartYearOf = (key: string) => {
  const y = Number(key.slice(0, 4));
  return Number(key.slice(5, 7)) >= 4 ? y : y - 1;
};

export function resolvePeriod(input: PeriodInput): ResolvedPeriod {
  const { type, year, month, quarter, basis } = input;

  if (type === 'custom' && isDateKey(input.from) && isDateKey(input.to)) {
    let from = input.from;
    let to = input.to;
    if (to < from) [from, to] = [to, from];
    if (diffDays(from, to) + 1 > MAX_CUSTOM_SPAN_DAYS) to = addDays(from, MAX_CUSTOM_SPAN_DAYS - 1);
    return { type, from, to, label: `${from} to ${to}`, months: monthsBetween(from, to) };
  }

  if (type === 'month') {
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = lastDayOfMonth(year, month);
    return { type, from, to, label: monthLabel(from.slice(0, 7)), months: [from.slice(0, 7)] };
  }

  if (type === 'quarter') {
    // First month of the quarter, as an offset from the start of the year basis.
    const startMonth0 = (basis === 'fy' ? 3 : 0) + (quarter - 1) * 3; // 0-based, may run past 11
    const startYear = year + Math.floor(startMonth0 / 12);
    const sm = (startMonth0 % 12) + 1;
    const em0 = startMonth0 + 2;
    const endYear = year + Math.floor(em0 / 12);
    const em = (em0 % 12) + 1;
    const from = `${startYear}-${String(sm).padStart(2, '0')}-01`;
    const to = lastDayOfMonth(endYear, em);
    const span = `${MONTH_NAMES[sm - 1]}–${MONTH_NAMES[em - 1]}`;
    const label = basis === 'fy' ? `Q${quarter} (${span}) ${fyLabel(year)}` : `Q${quarter} (${span}) ${year}`;
    return { type, from, to, label, months: monthsBetween(from, to) };
  }

  // year (also the fallback for an invalid custom range)
  const from = basis === 'fy' ? `${year}-04-01` : `${year}-01-01`;
  const to = basis === 'fy' ? `${year + 1}-03-31` : `${year}-12-31`;
  return { type: 'year', from, to, label: basis === 'fy' ? fyLabel(year) : String(year), months: monthsBetween(from, to) };
}

/** Sensible default: the current month. */
export function defaultPeriodInput(today: string): PeriodInput {
  return {
    type: 'month',
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)),
    quarter: Math.floor(((Number(today.slice(5, 7)) + 8) % 12) / 3) + 1, // current FY quarter
    basis: 'fy',
  };
}
