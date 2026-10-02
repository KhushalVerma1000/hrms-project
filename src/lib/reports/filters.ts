import { DAY_STATUSES, type DayStatus } from './types';
import { defaultPeriodInput, isDateKey, type PeriodInput, type PeriodType, type YearBasis } from './period';

export type ReportKind = 'records' | 'employees' | 'stores' | 'muster';
export const REPORT_KINDS: ReportKind[] = ['records', 'employees', 'stores', 'muster'];

export interface ReportFilters {
  period: PeriodInput;
  clientId?: string;
  storeId?: string;
  mode?: 'BIOMETRIC' | 'MANUAL';
  designation?: string;
  /** Narrows the daily-records list and its download only — analytics always use every status. */
  status?: DayStatus;
  /** Name or staff-code search. */
  q?: string;
}

const int = (s: string | undefined, min: number, max: number): number | undefined => {
  const n = Number(s);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/**
 * Reads filters from any key→value getter (Next's searchParams object or a
 * URLSearchParams), so the page and the download route interpret a URL the same
 * way. Anything invalid quietly falls back to a default.
 */
export function parseFilters(get: (key: string) => string | undefined, today: string): ReportFilters {
  const d = defaultPeriodInput(today);
  const type = (['month', 'quarter', 'year', 'custom'] as PeriodType[]).find((t) => t === get('period')) ?? d.type;
  const basis: YearBasis = get('basis') === 'calendar' ? 'calendar' : 'fy';
  const from = get('from');
  const to = get('to');

  const period: PeriodInput = {
    type: type === 'custom' && !(isDateKey(from) && isDateKey(to)) ? 'month' : type,
    year: int(get('year'), 2000, 2100) ?? d.year,
    month: int(get('month'), 1, 12) ?? d.month,
    quarter: int(get('quarter'), 1, 4) ?? d.quarter,
    basis,
    from: isDateKey(from) ? from : undefined,
    to: isDateKey(to) ? to : undefined,
  };
  // A fresh load (no period chosen) shows the current FY quarter's year, not the calendar year.
  if (!get('year') && (period.type === 'quarter' || period.type === 'year') && basis === 'fy') {
    period.year = Number(today.slice(5, 7)) >= 4 ? Number(today.slice(0, 4)) : Number(today.slice(0, 4)) - 1;
  }

  const clean = (k: string) => {
    const v = get(k)?.trim();
    return v ? v.slice(0, 100) : undefined;
  };
  const mode = get('mode');
  const status = get('status') as DayStatus | undefined;

  return {
    period,
    clientId: clean('clientId'),
    storeId: clean('storeId'),
    mode: mode === 'BIOMETRIC' || mode === 'MANUAL' ? mode : undefined,
    designation: clean('designation'),
    status: status && DAY_STATUSES.includes(status) ? status : undefined,
    q: clean('q'),
  };
}

/** The exact query string that reproduces these filters — used for download links. */
export function filtersToQuery(f: ReportFilters): URLSearchParams {
  const p = new URLSearchParams();
  p.set('period', f.period.type);
  p.set('basis', f.period.basis);
  p.set('year', String(f.period.year));
  p.set('month', String(f.period.month));
  p.set('quarter', String(f.period.quarter));
  if (f.period.type === 'custom' && f.period.from && f.period.to) {
    p.set('from', f.period.from);
    p.set('to', f.period.to);
  }
  for (const k of ['clientId', 'storeId', 'mode', 'designation', 'status', 'q'] as const) {
    if (f[k]) p.set(k, f[k]!);
  }
  return p;
}
