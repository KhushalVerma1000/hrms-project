import type { DayRecord, MonthlyOt } from '@/lib/reports/types';

/** What the attendance data says about one employee for one payroll month. */
export interface AttendanceSummary {
  presentDays: number;
  /** Week-offs + paid holidays. */
  weekOffDays: number;
  halfDays: number;
  /** Absent, on leave, no punch, not recorded — all unpaid (see warnings). */
  absentDays: number;
  /** Recorded OT (monthly payroll total wins over summed daily entries — same rule as the reports). */
  otHours: number;
  noPunchDays: number;
  notRecordedDays: number;
  autoClosedShifts: number;
  /** Days that have a record at all; < days in month means part of the month has no data. */
  recordedDays: number;
}

const blank = (): AttendanceSummary => ({
  presentDays: 0, weekOffDays: 0, halfDays: 0, absentDays: 0, otHours: 0,
  noPunchDays: 0, notRecordedDays: 0, autoClosedShifts: 0, recordedDays: 0,
});

/**
 * ASSUMPTION (policy, easy to change here): PRESENT, HALF_DAY, WEEK_OFF and HOLIDAY are paid;
 * ABSENT, ON_LEAVE, NO_PUNCH and NOT_RECORDED are unpaid. NO_PUNCH / NOT_RECORDED are surfaced
 * as warnings on the payroll line so a person is never silently docked pay for missing data.
 */
export function summariseAttendance(
  records: DayRecord[],
  monthlyOt: MonthlyOt,
  yearMonth: string,
): Map<string, AttendanceSummary> {
  const byEmployee = new Map<string, AttendanceSummary>();
  const dailyOt = new Map<string, number>();

  for (const r of records) {
    if (r.date.slice(0, 7) !== yearMonth) continue;
    const s = byEmployee.get(r.employeeId) ?? blank();
    s.recordedDays += 1;
    switch (r.status) {
      case 'PRESENT': s.presentDays += 1; break;
      case 'HALF_DAY': s.halfDays += 1; break;
      case 'WEEK_OFF':
      case 'HOLIDAY': s.weekOffDays += 1; break;
      case 'NO_PUNCH': s.noPunchDays += 1; s.absentDays += 1; break;
      case 'NOT_RECORDED': s.notRecordedDays += 1; s.absentDays += 1; break;
      default: s.absentDays += 1; // ABSENT, ON_LEAVE
    }
    if (r.notes.includes('NO_CHECKOUT')) s.autoClosedShifts += 1;
    dailyOt.set(r.employeeId, (dailyOt.get(r.employeeId) ?? 0) + (r.otHours || 0));
    byEmployee.set(r.employeeId, s);
  }

  for (const [employeeId, s] of byEmployee) {
    const monthly = monthlyOt.get(`${employeeId}|${yearMonth}`);
    s.otHours = monthly ?? dailyOt.get(employeeId) ?? 0;
  }
  return byEmployee;
}

export const emptyAttendance = blank;
