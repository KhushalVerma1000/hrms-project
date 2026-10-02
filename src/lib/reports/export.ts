import { STANDARD_SHIFT_HOURS } from '@/lib/config';
import { NOTE_LABEL } from './rules';
import { toCsv } from './csv';
import { groupRows, workedByMonth } from './aggregate';
import { eachDay, monthLabel, diffDays, type ResolvedPeriod } from './period';
import { STATUS_CODE, STATUS_LABEL, type DayRecord, type GroupRow, type MonthlyOt } from './types';
import type { ReportFilters, ReportKind } from './filters';

export const MUSTER_MAX_DAYS = 31;

export const REPORT_META: Record<ReportKind, { label: string; description: string }> = {
  records: { label: 'Daily attendance records', description: 'One row per person per day — status, in/out times, hours and overtime.' },
  employees: { label: 'Employee summary', description: 'One row per person — days present, absent, leave, attendance % and overtime.' },
  stores: { label: 'Store summary', description: 'One row per store — headcount, attendance % and overtime.' },
  muster: { label: 'Muster roll', description: `Person × day grid (P / A / HD …) for payroll. Periods up to ${MUSTER_MAX_DAYS} days.` },
};

export function musterAvailable(period: ResolvedPeriod): boolean {
  return diffDays(period.from, period.to) + 1 <= MUSTER_MAX_DAYS;
}

/** Plain-language description of what was filtered, repeated at the top of every download. */
export function describeFilters(f: ReportFilters, period: ResolvedPeriod, names: { client?: string; store?: string }): string[] {
  const parts = [`Period: ${period.label} (${period.from} to ${period.to})`];
  if (names.client) parts.push(`Client: ${names.client}`);
  if (names.store) parts.push(`Store: ${names.store}`);
  if (f.mode) parts.push(`Attendance mode: ${f.mode === 'MANUAL' ? 'Manual' : 'Biometric'}`);
  if (f.designation) parts.push(`Designation: ${f.designation.replace(/_/g, ' ')}`);
  if (f.status) parts.push(`Status: ${STATUS_LABEL[f.status]}`);
  if (f.q) parts.push(`Search: ${f.q}`);
  return parts;
}

const num = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 100) / 100);
const TOTAL_HEADER = ['Present', 'Half day', 'Absent', 'On leave', 'Week off', 'Holiday', 'No punch', 'Not recorded', 'Days worked', 'Attendance %', 'Hours', 'No check-out (auto shift)', 'OT hours'];
const totalCells = (t: GroupRow) => [
  t.present, t.halfDay, t.absent, t.onLeave, t.weekOff, t.holiday, t.noPunch, t.notRecorded,
  num(t.daysWorked), t.attendancePct ?? '', num(t.hours), t.autoClosed, num(t.otHours),
];

export interface BuiltReport { filename: string; csv: string; rowCount: number }

export function buildReport(
  kind: ReportKind,
  records: DayRecord[],
  monthlyOt: MonthlyOt,
  period: ResolvedPeriod,
  filters: ReportFilters,
  preamble: string[],
): BuiltReport {
  const stamp = `${period.from}_to_${period.to}`;
  const notes = [
    ...preamble,
    'Attendance % = days worked ÷ scheduled days (excludes week-offs, holidays and not-recorded days). Half day counts as 0.5.',
    'OT hours are recorded figures only, never estimated: the payroll monthly total where the period covers that whole month, otherwise the daily OT managers entered. Biometric punches carry no OT, so biometric-only stores show none unless payroll has entered it.',
    `No check-out: anyone who checked in but never checked out is counted as a ${STANDARD_SHIFT_HOURS}-hour shift and flagged in the Remarks column.`,
    'Biometric stores: punches are grouped into shifts, and a shift (including an overnight one) counts on the day it started.',
  ];

  if (kind === 'records') {
    const rows = filters.status ? records.filter((r) => r.status === filters.status) : records;
    return {
      filename: `attendance-records_${stamp}.csv`,
      rowCount: rows.length,
      csv: toCsv(
        ['Date', 'Staff code', 'Name', 'Designation', 'Client', 'Store', 'Attendance mode', 'Status', 'Check in', 'Check out', 'Hours', 'OT hours', 'Punches', 'Remarks'],
        rows.map((r) => [
          r.date, r.staffCode, r.name, r.designation.replace(/_/g, ' '), r.clientName, r.storeName,
          r.mode === 'MANUAL' ? 'Manual' : 'Biometric', STATUS_LABEL[r.status],
          r.checkIn ?? '', r.checkOut ?? '', r.hours ?? '', r.otHours || '', r.punches ?? '',
          r.notes.map((n) => NOTE_LABEL[n]).join('; '),
        ]),
        notes,
      ),
    };
  }

  if (kind === 'employees') {
    const rows = groupRows(records, monthlyOt, 'employee');
    const byEmp = workedByMonth(records);
    const info = new Map(records.map((r) => [r.employeeId, r]));
    const multi = period.months.length > 1;
    return {
      filename: `employee-summary_${stamp}.csv`,
      rowCount: rows.length,
      csv: toCsv(
        ['Staff code', 'Name', 'Designation', 'Client', 'Store', ...TOTAL_HEADER, ...(multi ? period.months.map((m) => `Days worked – ${monthLabel(m)}`) : [])],
        rows.map((g) => {
          const r = info.get(g.key)!;
          return [
            r.staffCode, r.name, r.designation.replace(/_/g, ' '), r.clientName, r.storeName, ...totalCells(g),
            ...(multi ? period.months.map((m) => num(byEmp.get(g.key)?.get(m) ?? 0)) : []),
          ];
        }),
        notes,
      ),
    };
  }

  if (kind === 'stores') {
    const rows = groupRows(records, monthlyOt, 'store');
    return {
      filename: `store-summary_${stamp}.csv`,
      rowCount: rows.length,
      csv: toCsv(['Store', 'Client', 'Employees', ...TOTAL_HEADER], rows.map((g) => [g.label, g.sub ?? '', g.employees, ...totalCells(g)]), notes),
    };
  }

  // muster roll
  const days = eachDay(period.from, period.to);
  const byEmp = new Map<string, Map<string, DayRecord>>();
  for (const r of records) {
    const m = byEmp.get(r.employeeId) ?? new Map<string, DayRecord>();
    m.set(r.date, r);
    byEmp.set(r.employeeId, m);
  }
  const people = groupRows(records, monthlyOt, 'employee');
  const info = new Map(records.map((r) => [r.employeeId, r]));
  return {
    filename: `muster-roll_${stamp}.csv`,
    rowCount: people.length,
    csv: toCsv(
      ['Staff code', 'Name', 'Store', ...days.map((d) => d.slice(8)), 'Present', 'Half day', 'Absent', 'On leave', 'Days worked', 'OT hours'],
      people.map((g) => {
        const r = info.get(g.key)!;
        const mine = byEmp.get(g.key);
        return [
          r.staffCode, r.name, r.storeName,
          ...days.map((d) => { const rec = mine?.get(d); return rec ? STATUS_CODE[rec.status] : ''; }),
          g.present, g.halfDay, g.absent + g.noPunch, g.onLeave, num(g.daysWorked), num(g.otHours),
        ];
      }),
      [...notes, 'Codes: P present, HD half day, A absent, L on leave, WO week off, H holiday, NP no punch (biometric store open, no scan), NR not recorded (manual store, nothing entered). A blank cell means no data that day (e.g. biometric store closed or nobody punched). "Absent" total includes no-punch days.'],
    ),
  };
}
