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
 * Google Forms integration config.
 */
export const GOOGLE_FORM_BASE_URL: string =
  process.env.GOOGLE_FORM_BASE_URL ?? '';
export const GOOGLE_FORM_ECODE_FIELD_ID: string =
  process.env.GOOGLE_FORM_ECODE_FIELD_ID ?? '';

/**
 * Generates a pre-filled Google Form URL with the employee code pre-populated.
 * Returns an empty string if form config is not set.
 */
export function generatePrefilledFormUrl(employeeCode: string): string {
  if (!GOOGLE_FORM_BASE_URL || !GOOGLE_FORM_ECODE_FIELD_ID) return '';
  const url = new URL(GOOGLE_FORM_BASE_URL);
  url.searchParams.set(GOOGLE_FORM_ECODE_FIELD_ID, employeeCode);
  return url.toString();
}
