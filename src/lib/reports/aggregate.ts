import type { DayRecord, DayStatus, GroupRow, MonthlyOt, Totals } from './types';
import { monthOf } from './period';

const round2 = (n: number) => Math.round(n * 100) / 100;

function blank(): Totals {
  return {
    employees: 0, present: 0, halfDay: 0, absent: 0, onLeave: 0, weekOff: 0, holiday: 0, noPunch: 0, notRecorded: 0,
    daysWorked: 0, scheduledDays: 0, attendancePct: null, hours: 0, autoClosed: 0, otHours: 0, otPayroll: 0, otDaily: 0,
  };
}

const COUNTER: Record<DayStatus, keyof Totals> = {
  PRESENT: 'present', HALF_DAY: 'halfDay', ABSENT: 'absent', ON_LEAVE: 'onLeave',
  WEEK_OFF: 'weekOff', HOLIDAY: 'holiday', NO_PUNCH: 'noPunch', NOT_RECORDED: 'notRecorded',
};

function finish(t: Totals): Totals {
  t.daysWorked = t.present + t.halfDay * 0.5;
  t.scheduledDays = t.present + t.halfDay + t.absent + t.onLeave + t.noPunch;
  t.attendancePct = t.scheduledDays > 0 ? Math.round((t.daysWorked / t.scheduledDays) * 1000) / 10 : null;
  t.hours = round2(t.hours);
  t.otPayroll = round2(t.otPayroll);
  t.otDaily = round2(t.otDaily);
  t.otHours = round2(t.otPayroll + t.otDaily);
  return t;
}

/**
 * Overtime for these records, split by where it came from. Only recorded figures are used —
 * nothing is estimated. For each employee and month:
 *   - payroll's monthly total, if there is one (it wins), otherwise
 *   - the sum of the daily OT managers entered.
 * Only employees that appear in `records` count, so a group (one store, one person) never
 * picks up anyone else's overtime.
 */
function otOf(records: DayRecord[], monthlyOt: MonthlyOt): { payroll: number; daily: number } {
  const emps = new Set(records.map((r) => r.employeeId));
  const daily = new Map<string, number>(); // `${emp}|${ym}` → summed daily OT
  for (const r of records) {
    if (r.otHours) {
      const k = `${r.employeeId}|${monthOf(r.date)}`;
      daily.set(k, (daily.get(k) ?? 0) + r.otHours);
    }
  }
  const keys = new Set(daily.keys());
  for (const k of monthlyOt.keys()) if (emps.has(k.split('|')[0]!)) keys.add(k);
  let payroll = 0;
  let dailySum = 0;
  for (const k of keys) {
    const m = monthlyOt.get(k);
    if (m !== undefined) payroll += m;
    else dailySum += daily.get(k) ?? 0;
  }
  return { payroll, daily: dailySum };
}

export function totalsOf(records: DayRecord[], monthlyOt: MonthlyOt): Totals {
  const t = blank();
  const emps = new Set<string>();
  for (const r of records) {
    emps.add(r.employeeId);
    (t[COUNTER[r.status]] as number) += 1;
    if (r.hours) t.hours += r.hours;
    if (r.notes.includes('NO_CHECKOUT')) t.autoClosed += 1;
  }
  t.employees = emps.size;
  const ot = otOf(records, monthlyOt);
  t.otPayroll = ot.payroll;
  t.otDaily = ot.daily;
  return finish(t);
}

export type GroupBy = 'store' | 'client' | 'employee' | 'designation';

const GROUPERS: Record<GroupBy, (r: DayRecord) => { key: string; label: string; sub?: string }> = {
  store: (r) => ({ key: r.storeId, label: r.storeName, sub: r.clientName }),
  client: (r) => ({ key: r.clientId, label: r.clientName }),
  employee: (r) => ({ key: r.employeeId, label: r.name, sub: r.staffCode }),
  designation: (r) => ({ key: r.designation, label: r.designation.replace(/_/g, ' ') }),
};

export function groupRows(records: DayRecord[], monthlyOt: MonthlyOt, by: GroupBy): GroupRow[] {
  const buckets = new Map<string, { label: string; sub?: string; recs: DayRecord[] }>();
  const g = GROUPERS[by];
  for (const r of records) {
    const { key, label, sub } = g(r);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { label, sub, recs: [] }));
    b.recs.push(r);
  }
  return [...buckets.entries()]
    .map(([key, b]) => ({ key, label: b.label, sub: b.sub, ...totalsOf(b.recs, monthlyOt) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export interface TrendPoint { key: string; worked: number; scheduled: number; pct: number | null }

/** Attendance per day or per month, for the trend chart. */
export function trend(records: DayRecord[], bucket: 'day' | 'month'): TrendPoint[] {
  const m = new Map<string, { worked: number; scheduled: number }>();
  for (const r of records) {
    const k = bucket === 'day' ? r.date : monthOf(r.date);
    const cur = m.get(k) ?? { worked: 0, scheduled: 0 };
    if (r.status === 'PRESENT') { cur.worked += 1; cur.scheduled += 1; }
    else if (r.status === 'HALF_DAY') { cur.worked += 0.5; cur.scheduled += 1; }
    else if (r.status === 'ABSENT' || r.status === 'ON_LEAVE' || r.status === 'NO_PUNCH') cur.scheduled += 1;
    m.set(k, cur);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({ key, worked: v.worked, scheduled: v.scheduled, pct: v.scheduled ? Math.round((v.worked / v.scheduled) * 1000) / 10 : null }));
}

/** Days worked per month for each employee — extra columns in multi-month summaries. */
export function workedByMonth(records: DayRecord[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>(); // employeeId → ym → days worked
  for (const r of records) {
    const add = r.status === 'PRESENT' ? 1 : r.status === 'HALF_DAY' ? 0.5 : 0;
    const per = out.get(r.employeeId) ?? new Map<string, number>();
    per.set(monthOf(r.date), (per.get(monthOf(r.date)) ?? 0) + add);
    out.set(r.employeeId, per);
  }
  return out;
}
