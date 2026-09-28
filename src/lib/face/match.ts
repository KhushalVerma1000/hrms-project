/**
 * Pure face-matching + punch-decision logic. No database, no browser APIs —
 * so it's shared by the server actions and easy to unit test.
 *
 * A "descriptor" is the 128-number vector face-api computes from a face.
 * Two descriptors of the same person are close (small Euclidean distance);
 * different people are far apart.
 */

export const DESCRIPTOR_LENGTH = 128;

/** A live scan matches an enrolled employee below this distance. face-api's own default is 0.6; 0.5 trades a few more "not recognised" for far fewer wrong matches. */
export const MATCH_THRESHOLD = 0.5;

/** If the runner-up employee is within this margin of the best, the scan is ambiguous — refuse rather than guess. */
export const AMBIGUITY_MARGIN = 0.04;

/** At enrolment, a face closer than this to a DIFFERENT employee's template is treated as the same person already enrolled. */
export const DUPLICATE_THRESHOLD = 0.45;

/** All enrolment samples of one person must be within this distance of each other. */
export const SAMPLE_CONSISTENCY_MAX = 0.5;

export const ENROLL_MIN_SAMPLES = 3;
export const ENROLL_MAX_SAMPLES = 5;

/** A second scan sooner than this after the last punch is ignored (double-scan guard). */
export const MIN_GAP_MS = 2 * 60 * 1000;

/** Returns a clean number[128] or null if the input isn't a valid descriptor. */
export function parseDescriptor(input: unknown): number[] | null {
  if (!Array.isArray(input) || input.length !== DESCRIPTOR_LENGTH) return null;
  const out: number[] = [];
  for (const v of input) {
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 10) return null;
    out.push(v);
  }
  return out;
}

export function distance(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export interface TemplateRow {
  employeeId: string;
  descriptor: readonly number[];
}

export type MatchResult =
  | { kind: 'MATCH'; employeeId: string; distance: number }
  | { kind: 'NO_MATCH'; bestDistance: number | null }
  | { kind: 'AMBIGUOUS'; bestDistance: number };

/**
 * Finds which employee a live descriptor belongs to. Each employee's score is
 * the distance to their CLOSEST sample. Refuses (AMBIGUOUS) when a second,
 * different employee is nearly as close as the best one.
 */
export function findBestMatch(live: readonly number[], templates: readonly TemplateRow[]): MatchResult {
  const bestByEmployee = new Map<string, number>();
  for (const t of templates) {
    const d = distance(live, t.descriptor);
    const prev = bestByEmployee.get(t.employeeId);
    if (prev === undefined || d < prev) bestByEmployee.set(t.employeeId, d);
  }
  if (bestByEmployee.size === 0) return { kind: 'NO_MATCH', bestDistance: null };

  const ranked = [...bestByEmployee.entries()].sort((x, y) => x[1] - y[1]);
  const [bestId, bestDist] = ranked[0]!;
  if (bestDist > MATCH_THRESHOLD) return { kind: 'NO_MATCH', bestDistance: bestDist };

  const runnerUp = ranked[1];
  if (runnerUp && runnerUp[1] - bestDist < AMBIGUITY_MARGIN && runnerUp[1] <= MATCH_THRESHOLD) {
    return { kind: 'AMBIGUOUS', bestDistance: bestDist };
  }
  return { kind: 'MATCH', employeeId: bestId, distance: bestDist };
}

/** True if every pair of enrolment samples is within SAMPLE_CONSISTENCY_MAX. */
export function samplesAreConsistent(samples: readonly (readonly number[])[]): boolean {
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      if (distance(samples[i]!, samples[j]!) > SAMPLE_CONSISTENCY_MAX) return false;
    }
  }
  return true;
}

// ─── Punch decision ─────────────────────────────────────────────────────────

export type EntryStatus = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'ON_LEAVE' | 'WEEK_OFF' | 'HOLIDAY';

export interface ExistingEntry {
  status: EntryStatus;
  checkInTime: Date | null;
  checkOutTime: Date | null;
}

export type PunchDecision =
  | { action: 'CREATE_CHECK_IN' }
  | { action: 'SET_CHECK_IN'; keepStatus: boolean }
  | { action: 'SET_CHECK_OUT'; isUpdate: boolean }
  | { action: 'TOO_SOON'; lastPunch: Date }
  | { action: 'BLOCKED'; status: EntryStatus };

/**
 * Decides what a recognised scan should do to today's attendance row.
 *
 *  - no row yet                          → check in (PRESENT)
 *  - ABSENT row                          → treated like no row: the person is standing there
 *  - ON_LEAVE / WEEK_OFF / HOLIDAY       → blocked; a manager must change that deliberately
 *  - PRESENT/HALF_DAY without a time     → this scan becomes the check-in (status kept)
 *  - within MIN_GAP_MS of the last punch → ignored
 *  - otherwise                           → this scan becomes the check-out (last scan wins)
 */
export function decidePunch(existing: ExistingEntry | null, now: Date): PunchDecision {
  if (!existing || existing.status === 'ABSENT') return existing ? { action: 'SET_CHECK_IN', keepStatus: false } : { action: 'CREATE_CHECK_IN' };

  if (existing.status === 'ON_LEAVE' || existing.status === 'WEEK_OFF' || existing.status === 'HOLIDAY') {
    return { action: 'BLOCKED', status: existing.status };
  }

  if (!existing.checkInTime) return { action: 'SET_CHECK_IN', keepStatus: true };

  const last = existing.checkOutTime ?? existing.checkInTime;
  if (now.getTime() - last.getTime() < MIN_GAP_MS) return { action: 'TOO_SOON', lastPunch: last };

  return { action: 'SET_CHECK_OUT', isUpdate: existing.checkOutTime !== null };
}
