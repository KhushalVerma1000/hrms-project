/**
 * Active liveness check for face-scan attendance: a random "turn your head"
 * challenge. Pure logic (no camera, no React) so it can be unit tested.
 *
 * Why a head turn: a printed or on-screen photo cannot turn. Rotating a flat
 * photo shifts every facial landmark by the same proportion, but a real 3-D
 * face moves the nose tip relative to the jaw outline — that is what `yaw`
 * measures. The direction is random each time, so a pre-recorded video of the
 * right person turning the wrong way does not pass either.
 *
 * What this does NOT stop: a 3-D mask, or someone injecting a fake camera feed
 * at operating-system level. It is a browser-only, free-tier check — sized for
 * a supervisor watching the person being scanned, not for unattended kiosks.
 *
 * All thresholds live here so they can be tuned in one place after testing on
 * real phones.
 */

/** Direction as the person holding the phone sees it on the SCREEN. */
export type TurnDirection = 'LEFT' | 'RIGHT';

/** |yaw| at or below this counts as facing the camera. (yaw ≈ ±0.5 at full profile) */
export const FRONTAL_YAW = 0.07;
/** yaw must reach this far in the requested direction to count as a turn. */
export const TURN_YAW = 0.15;
/** Time allowed to complete the turn. */
export const TURN_TIMEOUT_MS = 8000;
/** Time allowed to come back to face the camera after turning. */
export const RETURN_TIMEOUT_MS = 6000;
/** Consecutive frontal frames needed to finish. */
export const FRONTAL_HOLD_FRAMES = 2;
/** The face at the start and at the end must be the same person (Euclidean distance). */
export const SAME_PERSON_MAX = 0.45;

export interface Point { x: number; y: number }

/**
 * Head yaw from face-api's 68 landmarks, in image space (un-mirrored camera
 * frame): 0 = facing the camera, positive = nose moved toward the image's
 * right. Uses nose tip (30) against the jaw's left/right extremes (0, 16).
 */
export function computeYaw(points: readonly Point[]): number | null {
  const nose = points[30];
  const jawL = points[0];
  const jawR = points[16];
  if (!nose || !jawL || !jawR) return null;
  const width = jawR.x - jawL.x;
  if (!(width > 1)) return null;
  return (nose.x - jawL.x) / width - 0.5;
}

export function isFrontal(yaw: number): boolean {
  return Math.abs(yaw) <= FRONTAL_YAW;
}

/**
 * Sign of the image-space yaw that satisfies a SCREEN direction. The rear
 * camera preview is shown as-is; the front camera preview is mirrored, so
 * screen-left there is image-right.
 */
export function requiredYawSign(direction: TurnDirection, mirrored: boolean): 1 | -1 {
  const base = direction === 'RIGHT' ? 1 : -1;
  return (mirrored ? -base : base) as 1 | -1;
}

export function pickDirection(previous: TurnDirection | null, rand: () => number = Math.random): TurnDirection {
  // Mostly random, but never the same direction twice in a row.
  const next: TurnDirection = rand() < 0.5 ? 'LEFT' : 'RIGHT';
  return previous && next === previous ? (previous === 'LEFT' ? 'RIGHT' : 'LEFT') : next;
}

export type ChallengePhase = 'TURN' | 'RETURN' | 'PASSED' | 'FAILED';

export interface ChallengeState {
  direction: TurnDirection;
  mirrored: boolean;
  phase: ChallengePhase;
  startedAt: number;
  turnedAt: number | null;
  frontalFrames: number;
  /** Set when phase === 'FAILED'. */
  failReason: 'LOST_FACE' | 'TIMEOUT' | null;
}

export function startChallenge(direction: TurnDirection, mirrored: boolean, now: number): ChallengeState {
  return { direction, mirrored, phase: 'TURN', startedAt: now, turnedAt: null, frontalFrames: 0, failReason: null };
}

/**
 * Advances the challenge by one frame. `yaw` is null when there is not
 * exactly one face in view — that fails the check outright, so the face
 * cannot be swapped out mid-challenge.
 */
export function stepChallenge(state: ChallengeState, yaw: number | null, now: number): ChallengeState {
  if (state.phase === 'PASSED' || state.phase === 'FAILED') return state;

  if (yaw === null) return { ...state, phase: 'FAILED', failReason: 'LOST_FACE' };

  if (state.phase === 'TURN') {
    if (now - state.startedAt > TURN_TIMEOUT_MS) return { ...state, phase: 'FAILED', failReason: 'TIMEOUT' };
    const sign = requiredYawSign(state.direction, state.mirrored);
    if (yaw * sign >= TURN_YAW) return { ...state, phase: 'RETURN', turnedAt: now, frontalFrames: 0 };
    return state;
  }

  // RETURN
  if (now - (state.turnedAt ?? state.startedAt) > RETURN_TIMEOUT_MS) {
    return { ...state, phase: 'FAILED', failReason: 'TIMEOUT' };
  }
  if (isFrontal(yaw)) {
    const frontalFrames = state.frontalFrames + 1;
    return frontalFrames >= FRONTAL_HOLD_FRAMES ? { ...state, phase: 'PASSED', frontalFrames } : { ...state, frontalFrames };
  }
  return { ...state, frontalFrames: 0 };
}

export function challengeHint(state: ChallengeState): string {
  const side = state.direction === 'LEFT' ? 'left' : 'right';
  switch (state.phase) {
    case 'TURN': return `Slowly turn your head to the ${side} of the screen`;
    case 'RETURN': return 'Now look straight at the camera';
    case 'PASSED': return 'Checking…';
    case 'FAILED': return state.failReason === 'LOST_FACE' ? 'Face lost — start again' : 'Too slow — start again';
  }
}
