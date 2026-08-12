/**
 * SmartOffice API client.
 *
 * All 21 endpoint wrappers live here. Every function:
 * 1. Reads credentials from env (never hardcoded)
 * 2. Calls SmartOffice with timeout + retry
 * 3. Normalizes the response into SmartOfficeResult<T>
 *
 * IMPORTANT: Write commands (AddEmployee, UploadUser, etc.) should NOT be called
 * directly from user-facing requests. They are called by the queue worker (Section 12).
 * This module is the low-level transport; the queue is the retry/durability layer.
 */

import {
  type SmartOfficeResult,
  type AddBiometricParams,
  type DeleteBiometricParams,
  type GetDeviceLogsParams,
  type UploadUserParams,
  type DeleteUserParams,
  type FetchLiveUsersParams,
  type SetUserExpirationParams,
  type GetDeviceCommandsParams,
  type PhotoUploadParams,
  type BlockUserParams,
  type ClearLogsParams,
  type ClearLogsByTimeParams,
  type TriggerEnrollmentParams,
  type AddEmployeeParams,
  type DeleteEmployeeParams,
  type AddCompanyParams,
  type AddDepartmentParams,
  type AddLocationParams,
  type AddDesignationParams,
  type AddGradeParams,
  type AddTeamParams,
  type DeviceLogRecord,
  type DeviceCommandRecord,
  normalizeResponse,
  isTerminalError,
} from './types';
import { SMARTOFFICE_BASE_URL, SMARTOFFICE_API_KEY } from '@/lib/config';
import { SmartOfficeError } from '@/lib/errors';

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 2_000;

/** Formats a Date to 'yyyy-MM-dd' as required by SmartOffice. */
export function formatSmartOfficeDate(date: Date): string {
  return date.toISOString().split('T')[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal fetch helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Internal GET request to SmartOffice with retry logic.
 * DO NOT call this directly — use the typed endpoint functions below.
 */
async function smartGet<T = unknown>(
  path: string,
  params: Record<string, string | number | undefined>,
): Promise<SmartOfficeResult<T>> {
  const url = new URL(`${SMARTOFFICE_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url.toString());
      const text = await response.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      const result = normalizeResponse<T>(parsed);
      // Terminal errors should not be retried
      if (!result.ok && isTerminalError(result.message)) {
        throw new SmartOfficeError(result.message, true);
      }
      return result;
    } catch (err) {
      if (err instanceof SmartOfficeError && err.isTerminal) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new SmartOfficeError(`SmartOffice unreachable: ${lastError?.message}`, false);
}

/**
 * Internal POST request to SmartOffice with retry logic.
 */
async function smartPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<SmartOfficeResult<T>> {
  const url = `${SMARTOFFICE_BASE_URL}${path}`;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await response.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      const result = normalizeResponse<T>(parsed);
      if (!result.ok && isTerminalError(result.message)) {
        throw new SmartOfficeError(result.message, true);
      }
      return result;
    } catch (err) {
      if (err instanceof SmartOfficeError && err.isTerminal) throw err;
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < MAX_RETRIES) await delay(RETRY_DELAY_MS * (attempt + 1));
    }
  }
  throw new SmartOfficeError(`SmartOffice unreachable: ${lastError?.message}`, false);
}

// ─────────────────────────────────────────────────────────────────────────────
// Endpoint wrappers (21 total)
// ─────────────────────────────────────────────────────────────────────────────

export async function addBiometricDevice(
  params: Omit<AddBiometricParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/AddBiometric', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function deleteBiometricDevice(
  params: Omit<DeleteBiometricParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/DeleteBiometric', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function getDeviceLogs(
  params: Omit<GetDeviceLogsParams, 'APIKey'>,
): Promise<SmartOfficeResult<DeviceLogRecord[]>> {
  return smartGet('/api/v2/WebAPI/GetDeviceLogs', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function uploadUser(
  params: Omit<UploadUserParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/UploadUser', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function deleteUser(
  params: Omit<DeleteUserParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/DeleteUser', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function fetchLiveUsers(
  params: Omit<FetchLiveUsersParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/FetchLiveUsersFromBiometric', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function setUserExpiration(
  params: Omit<SetUserExpirationParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/SetUserExpiration', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function getDeviceCommands(
  params: Omit<GetDeviceCommandsParams, 'APIKey'>,
): Promise<SmartOfficeResult<DeviceCommandRecord[]>> {
  return smartGet('/api/v2/WebAPI/GetDeviceCommands', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

/**
 * Photo upload to biometric device.
 * ❌ NOT WIRED UP IN MVP — the wrapper is here for completeness/future use.
 * Do NOT call this from any onboarding step or user-facing flow.
 * See Section 7.1 of the spec.
 */
export async function photoUploadInBiometric(
  _params: Omit<PhotoUploadParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  throw new Error(
    'photoUploadInBiometric is not wired up in this MVP. ' +
    'See Section 7.1 of the spec — this endpoint is deferred.',
  );
}

export async function blockUserInBiometric(
  params: Omit<BlockUserParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/BlockUserinBiometric', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function clearAllLogsFromDevice(
  params: Omit<ClearLogsParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/ClearAllLogsFromDevice', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

/**
 * Speed Face models only. Feature-flag by checking Device.model before calling.
 */
export async function clearLogsFromDeviceByTime(
  params: Omit<ClearLogsByTimeParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/ClearLogsFromDeviceByTime', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function triggerUserOnlineEnrollment(
  params: Omit<TriggerEnrollmentParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/TriggerUserOnlineEnrollment', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addEmployee(
  params: Omit<AddEmployeeParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/AddEmployee', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function deleteEmployee(
  params: Omit<DeleteEmployeeParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/DeleteEmployee', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addCompany(
  params: Omit<AddCompanyParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/AddCompany', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addDepartment(
  params: Omit<AddDepartmentParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/AddDepartment', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addLocation(
  params: Omit<AddLocationParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartGet('/api/v2/WebAPI/AddLocation', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addDesignation(
  params: Omit<AddDesignationParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/AddDesignation', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addGrade(
  params: Omit<AddGradeParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/AddGrade', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export async function addTeam(
  params: Omit<AddTeamParams, 'APIKey'>,
): Promise<SmartOfficeResult> {
  return smartPost('/api/v2/WebAPI/AddTeam', { APIKey: SMARTOFFICE_API_KEY, ...params });
}

export const smartOfficeClient = {
  addBiometricDevice,
  deleteBiometricDevice,
  getDeviceLogs,
  uploadUser,
  deleteUser,
  fetchLiveUsers,
  setUserExpiration,
  getDeviceCommands,
  photoUploadInBiometric,
  blockUserInBiometric,
  clearAllLogsFromDevice,
  clearLogsFromDeviceByTime,
  triggerUserOnlineEnrollment,
  addEmployee,
  deleteEmployee,
  addCompany,
  addDepartment,
  addLocation,
  addDesignation,
  addGrade,
  addTeam,
};

