import type { Designation } from '@prisma/client';
import type { RecordNote } from './rules';

/** One employee on one day, whichever way the store captures attendance. */
export type DayStatus =
  | 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'WEEK_OFF' | 'HOLIDAY'
  /** Biometric store was open that day but this person never punched. Could be absence, a week-off or leave. */
  | 'NO_PUNCH'
  /** Manual store, nobody has entered this person's attendance for that day (yet). */
  | 'NOT_RECORDED';

export const DAY_STATUSES: DayStatus[] = [
  'PRESENT', 'HALF_DAY', 'ABSENT', 'ON_LEAVE', 'WEEK_OFF', 'HOLIDAY', 'NO_PUNCH', 'NOT_RECORDED',
];

export const STATUS_LABEL: Record<DayStatus, string> = {
  PRESENT: 'Present',
  HALF_DAY: 'Half day',
  ABSENT: 'Absent',
  ON_LEAVE: 'On leave',
  WEEK_OFF: 'Week off',
  HOLIDAY: 'Holiday',
  NO_PUNCH: 'No punch',
  NOT_RECORDED: 'Not recorded',
};

/** Short codes for the muster roll grid. */
export const STATUS_CODE: Record<DayStatus, string> = {
  PRESENT: 'P', HALF_DAY: 'HD', ABSENT: 'A', ON_LEAVE: 'L', WEEK_OFF: 'WO', HOLIDAY: 'H', NO_PUNCH: 'NP', NOT_RECORDED: 'NR',
};

export interface DayRecord {
  date: string; // YYYY-MM-DD
  employeeId: string;
  staffCode: string;
  name: string;
  designation: Designation;
  storeId: string;
  storeName: string;
  clientId: string;
  clientName: string;
  mode: 'BIOMETRIC' | 'MANUAL';
  status: DayStatus;
  checkIn: string | null; // HH:mm
  checkOut: string | null;
  /** Hours between first and last punch / check-in and check-out, when both exist. */
  hours: number | null;
  /** Daily OT exactly as a manager entered it. Never estimated — biometric punches carry no OT. */
  otHours: number;
  punches: number | null;
  /** Rule outcomes, e.g. NO_CHECKOUT (counted as a standard shift). */
  notes: RecordNote[];
}

/** Payroll's monthly OT total per employee-month — wins over summed daily OT when present. */
export type MonthlyOt = Map<string, number>; // key: `${employeeId}|${YYYY-MM}`

export interface Totals {
  employees: number;
  present: number;
  halfDay: number;
  absent: number;
  onLeave: number;
  weekOff: number;
  holiday: number;
  noPunch: number;
  notRecorded: number;
  /** present + 0.5 × half-day */
  daysWorked: number;
  /** Days someone was expected to attend: everything except week-off, holiday and not-recorded. */
  scheduledDays: number;
  /** daysWorked / scheduledDays, 0–100, or null when nothing was scheduled. */
  attendancePct: number | null;
  hours: number;
  /** Shifts with no check-out that were counted as a standard shift. */
  autoClosed: number;
  otHours: number;
  /** Of otHours: from payroll monthly totals / from managers' daily entries. */
  otPayroll: number;
  otDaily: number;
}

export interface GroupRow extends Totals {
  key: string;
  label: string;
  /** Secondary text (e.g. the client under a store, the staff code under a name). */
  sub?: string;
}
