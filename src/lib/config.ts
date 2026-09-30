/**
 * Application-wide configuration constants.
 *
 * All values that might need to change across deployments or environments
 * are sourced from environment variables with documented defaults.
 *
 * ─── TIMEZONE NOTE ────────────────────────────────────────────────────────────
 * SmartOffice timestamps are assumed to be in IST (Asia/Kolkata) based on the
 * deployment context. If you need to change this (e.g. the device server is
 * running in UTC), update SMARTOFFICE_TIMEZONE in your .env file.
 *
 * To verify: punch a device at a known wall-clock time, pull that punch via
 * GetDeviceLogs, and compare. If it's off by ~5h30m, flip to 'UTC'.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * IANA timezone string for SmartOffice log timestamps.
 * Defaults to 'Asia/Kolkata' (IST). Change via SMARTOFFICE_TIMEZONE env var.
 *
 * @example 'Asia/Kolkata' | 'UTC' | 'Asia/Dubai'
 */
export const SMARTOFFICE_TIMEZONE: string =
  process.env.SMARTOFFICE_TIMEZONE ?? 'Asia/Kolkata';

/**
 * Base URL for the SmartOffice API (no trailing slash).
 * e.g. 'http://45.118.183.175:86'
 */
export const SMARTOFFICE_BASE_URL: string = (
  process.env.SMARTOFFICE_BASE_URL || 'http://localhost:8080'
).replace(/\/$/, '');

export const SMARTOFFICE_API_KEY: string =
  process.env.SMARTOFFICE_API_KEY || 'dev-placeholder-key';

/**
 * Command queue retry backoff schedule (in milliseconds), applied sequentially.
 * After all retries are exhausted, the command is marked FAILED.
 * Adjust these values based on observed SmartOffice downtime patterns.
 */
export const COMMAND_RETRY_BACKOFF_MS: number[] = [
  1 * 60 * 1000,   // 1 minute
  5 * 60 * 1000,   // 5 minutes
  15 * 60 * 1000,  // 15 minutes
  60 * 60 * 1000,  // 1 hour
  4 * 60 * 60 * 1000,  // 4 hours
  12 * 60 * 60 * 1000, // 12 hours
];

/** Max attempts before a command is permanently marked FAILED. */
export const COMMAND_MAX_ATTEMPTS: number = COMMAND_RETRY_BACKOFF_MS.length;

/**
 * How long (ms) a command can remain IN_PROGRESS before the worker considers
 * it a crash-recovery candidate on startup.
 */
export const COMMAND_IN_PROGRESS_TIMEOUT_MS: number = 2 * 60 * 1000; // 2 minutes

/**
 * Number of days to look back when enforcing the Manager hard-delete guard.
 * If an employee has attendance within this window, Manager cannot hard-delete them.
 */
export const MANAGER_HARD_DELETE_LOOKBACK_DAYS: number = 30;

/**
 * Attendance sync interval — how far back to pull logs on each sync run
 * if no previous sync timestamp is found for a device.
 */
export const ATTENDANCE_SYNC_DEFAULT_LOOKBACK_DAYS: number = 7;

/**
 * Fallback deadline day (day-of-month, in the month AFTER the one being
 * reported) used when neither a store override nor a client default
 * AttendanceDeadlinePolicy row exists. e.g. 5 = attendance for August is
 * due before the 5th of September.
 */
export const SYSTEM_DEFAULT_DEADLINE_DAY: number =
  Number(process.env.ATTENDANCE_DEFAULT_DEADLINE_DAY) || 5;

/**
 * Standard shift length used to approximate daily overtime from raw
 * SmartOffice punch times (first IN → last OUT) for a Biometric-mode store,
 * for the purpose of flagging a discrepancy against a manually-uploaded
 * daily OT figure. SmartOffice/AttendanceLog has no OT field of its own —
 * this is a stated assumption, not a synced value. Adjust if your actual
 * shift length differs (or varies by store — flag if you need per-store).
 */
export const STANDARD_SHIFT_HOURS: number =
  Number(process.env.ATTENDANCE_STANDARD_SHIFT_HOURS) || 8;

/**
 * Tolerance (hours) within which a manually-uploaded daily OT figure is
 * considered to "match" the biometric-approximated figure — below this,
 * no discrepancy flag is raised. Guards against flagging rounding noise.
 */
export const OT_DISCREPANCY_TOLERANCE_HOURS: number = 0.25;

/**
 * Google Forms integration config.
 */
export const GOOGLE_FORM_BASE_URL: string =
  process.env.GOOGLE_FORM_BASE_URL ?? '';
export const GOOGLE_FORM_ECODE_FIELD_ID: string =
  process.env.GOOGLE_FORM_ECODE_FIELD_ID ?? '';

type FormPair = { googleFormBaseUrl?: string | null; googleFormECodeFieldId?: string | null };

/** A store row (with its client) as needed to resolve the onboarding form. */
export type OnboardingFormSource = FormPair & { client?: FormPair | null };

/** Prisma `select` that loads everything resolveOnboardingForm() needs. */
export const ONBOARDING_FORM_STORE_SELECT = {
  googleFormBaseUrl: true,
  googleFormECodeFieldId: true,
  client: { select: { googleFormBaseUrl: true, googleFormECodeFieldId: true } },
} as const;

/**
 * Which Google Form applies to a store: the store's own override, else its
 * client's default, else the global env vars. The URL and the e-code field id
 * belong to the same form, so they are taken together from the first level
 * that has BOTH — never mixed across levels.
 */
export function resolveOnboardingForm(
  source?: OnboardingFormSource | null,
): { baseUrl: string; fieldId: string; level: 'store' | 'client' | 'global' | 'none' } {
  const has = (p?: FormPair | null): p is Required<FormPair> =>
    !!p?.googleFormBaseUrl && !!p?.googleFormECodeFieldId;
  if (has(source)) {
    return { baseUrl: source.googleFormBaseUrl!, fieldId: source.googleFormECodeFieldId!, level: 'store' };
  }
  if (has(source?.client)) {
    return {
      baseUrl: source!.client!.googleFormBaseUrl!,
      fieldId: source!.client!.googleFormECodeFieldId!,
      level: 'client',
    };
  }
  if (GOOGLE_FORM_BASE_URL && GOOGLE_FORM_ECODE_FIELD_ID) {
    return { baseUrl: GOOGLE_FORM_BASE_URL, fieldId: GOOGLE_FORM_ECODE_FIELD_ID, level: 'global' };
  }
  return { baseUrl: '', fieldId: '', level: 'none' };
}

/**
 * Generates a pre-filled Google Form URL with the employee code pre-populated,
 * using the store's override -> client default -> global env vars (see
 * resolveOnboardingForm). Returns an empty string if no usable form is found.
 */
export function generatePrefilledFormUrl(
  employeeCode: string,
  source?: OnboardingFormSource | null,
): string {
  const { baseUrl, fieldId } = resolveOnboardingForm(source);
  if (!baseUrl || !fieldId) return '';
  const url = new URL(baseUrl);
  url.searchParams.set(fieldId, employeeCode);
  return url.toString();
}
