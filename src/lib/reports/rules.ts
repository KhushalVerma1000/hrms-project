import { STANDARD_SHIFT_HOURS } from '@/lib/config';

/**
 * Attendance rules applied to every report, in one place so more can be added later.
 * Rules only fix up what we can state from the data itself — nothing here estimates
 * overtime.
 *
 * Rule 1 — no check-out: someone who checked in but never checked out is counted as a
 *          full standard shift (STANDARD_SHIFT_HOURS, 9h) and flagged, so the day isn't
 *          lost and the gap is visible in the reports.
 */

export type RecordNote = 'NO_CHECKOUT';

export const NOTE_LABEL: Record<RecordNote, string> = {
  NO_CHECKOUT: `No check-out — counted as a ${STANDARD_SHIFT_HOURS}-hour shift`,
};

export interface HoursInput {
  checkedIn: boolean;
  checkedOut: boolean;
  /** Hours measured from the check-in/out (or first/last punch), when both exist. */
  measuredHours: number | null;
}

export function applyHoursRules(input: HoursInput): { hours: number | null; notes: RecordNote[] } {
  if (input.checkedIn && !input.checkedOut) {
    return { hours: STANDARD_SHIFT_HOURS, notes: ['NO_CHECKOUT'] };
  }
  return { hours: input.measuredHours, notes: [] };
}
