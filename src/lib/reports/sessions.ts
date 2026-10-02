/**
 * Turns a person's raw biometric punches into shifts. Pure — no I/O.
 *
 * Stores have no fixed shift: people work different shifts at different times, some
 * overnight (e.g. 22:00 → 07:00). Grouping punches by calendar day would split a night
 * shift into two half-days, so instead a shift starts at the first punch not yet
 * assigned and includes every punch within `windowHours` of it. See SHIFT_WINDOW_HOURS.
 */

export interface Shift {
  first: Date;
  last: Date;
  punches: number;
}

/** `punches` must be sorted oldest → newest. */
export function groupIntoShifts(punches: Date[], windowHours: number): Shift[] {
  const windowMs = windowHours * 3_600_000;
  const shifts: Shift[] = [];
  let cur: Shift | null = null;
  for (const p of punches) {
    if (cur && p.getTime() - cur.first.getTime() <= windowMs) {
      cur.last = p;
      cur.punches += 1;
    } else {
      cur = { first: p, last: p, punches: 1 };
      shifts.push(cur);
    }
  }
  return shifts;
}
