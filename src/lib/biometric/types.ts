/**
 * Biometric provider abstraction — vendor-agnostic contract.
 *
 * SmartOffice is the first adapter behind this interface, not the interface
 * itself. Business logic (route actions, the command worker, attendance
 * sync) should only ever import from `facade.ts`, never from an adapter or
 * from `src/lib/smartoffice/client.ts` directly.
 *
 * Method names below map close to 1:1 with today's SmartOffice client
 * functions (`src/lib/smartoffice/client.ts`) so `SmartOfficeAdapter` is
 * near-pass-through — see the mapping table in each adapter file. Field
 * names on the DTOs are this app's own vocabulary (camelCase, generic),
 * NOT SmartOffice's wire format — each adapter translates at its own
 * boundary. This deliberately mirrors the spec (Section 3.1) plus a small,
 * documented extension: the spec's interface sketch names 9 required
 * methods, which don't cover every SmartOffice command the worker actually
 * dispatches today (UPLOAD_USER, DELETE_USER, CLEAR_LOGS have no 1:1 spec
 * method). Those are added here as `uploadEmployeeToDevice`,
 * `removeEmployeeFromDevice`, and `clearAllLogs` so Patch C can migrate
 * 100% of existing command types without a second interface revision.
 *
 * Deliberately OUT of scope for this interface: SmartOffice's
 * company/department/location/designation/grade/team "AddX" taxonomy
 * endpoints (ADD_COMPANY, ADD_DEPARTMENT, ADD_LOCATION, ADD_DESIGNATION,
 * ADD_GRADE, ADD_TEAM command types). Those are SmartOffice account/taxonomy
 * setup calls, not biometric-device operations — a device vendor (eSSL,
 * ZKTeco, a generic REST device) has no equivalent concept. `queue/worker.ts`
 * keeps dispatching those directly against `smartoffice/client.ts` even
 * after Patch C; see Section 2.3 "Capability negotiation" in the spec for
 * the same reasoning applied to optional methods below.
 */

import type { BiometricProviderType } from '@prisma/client';

export type { BiometricProviderType };

export interface BiometricCapabilities {
  /** PhotoUploadInBiometric — NOT wired up by SmartOffice's own client today either (see client.ts). */
  photoUpload: boolean;
  /** ClearLogsFromDeviceByTime — Speed Face models only, even on SmartOffice. */
  clearLogsByTime: boolean;
  /** TriggerUserOnlineEnrollment. */
  remoteEnrollment: boolean;
  /** FetchLiveUsersFromBiometric. */
  liveUserFetch: boolean;
}

/**
 * Normalized result of any provider call. Mirrors SmartOffice's existing
 * `SmartOfficeResult<T>` / `isTerminalError` pattern (see smartoffice/types.ts)
 * so retry logic in `queue/worker.ts` stays provider-agnostic — a `terminal`
 * result should NOT be retried by the caller; a non-terminal failure should.
 */
export type BiometricResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; terminal: boolean; code: string; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// DTOs — this app's vocabulary, not any one vendor's wire format.
// ─────────────────────────────────────────────────────────────────────────────

/** Creates the employee record itself (SmartOffice: company/location level, no device involved). */
export interface EnrollEmployeeParams {
  staffCode: string;
  staffName: string;
  gender?: string;
  status?: string;
  /** Maps to WarehouseType.name. */
  companyShortName: string;
  departmentShortName?: string;
  /** Maps to Store.name. */
  locationName: string;
  designation?: string;
  grade?: string;
  team?: string;
  /** yyyy-MM-dd */
  dateOfJoining?: string;
  /** yyyy-MM-dd */
  dateOfConfirmation?: string;
  /** yyyy-MM-dd */
  dateOfBirth?: string;
  /** yyyy-MM-dd */
  dateOfRelieving?: string;
}

/** Pushes an already-created employee's biometric enrollment onto one or more devices. */
export interface UploadEmployeeToDeviceParams {
  employeeCode: string;
  employeeName: string;
  /** Comma-separate to target more than one device serial at once. */
  serialNumbers: string;
  cardNumber?: string;
  verifyMode?: string;
  isFaceUpload?: boolean;
  isFingerprintUpload?: boolean;
  isCardUpload?: boolean;
  isBioPasswordUpload?: boolean;
}

export interface RemoveEmployeeFromDeviceParams {
  employeeCode: string;
  /** Comma-separate to target more than one device serial at once. */
  serialNumbers: string;
}

export interface DeleteEmployeeParams {
  employeeCode: string;
}

export interface BlockEmployeeParams {
  employeeCode: string;
  serialNumber: string;
  /** true = block, false = unblock. */
  block: boolean;
}

export interface SetExpirationParams {
  employeeCode: string;
  /** Pass "0" to apply to all of this provider's devices, where the vendor supports it. */
  serialNumber: string;
  /** yyyy-MM-dd */
  expirationDate: string;
}

export interface AddDeviceParams {
  serialNumber: string;
  deviceName: string;
}

export interface RemoveDeviceParams {
  serialNumber: string;
}

export interface GetDeviceLogsParams {
  /** yyyy-MM-dd */
  fromDate: string;
  /** yyyy-MM-dd */
  toDate: string;
  serialNumber?: string;
}

export interface NormalizedLogRecord {
  employeeCode: string;
  logDate: string;
  serialNumber: string;
  punchDirection?: string;
  temperature?: number;
  temperatureState?: string;
}

export interface GetDeviceCommandsParams {
  /** yyyy-MM-dd */
  fromDate: string;
  /** yyyy-MM-dd */
  toDate: string;
  /** Comma-separated list of device serials. */
  serialNumbers?: string;
}

export interface NormalizedCommandRecord {
  title: string;
  deviceCode: string;
  serialNumber: string;
  creationDate: string;
  executionDate?: string;
  status: string;
  response?: string;
}

export interface FetchLiveUsersParams {
  serialNumber: string;
}

/**
 * SmartOffice's own client (client.ts) does not give FetchLiveUsersFromBiometric
 * a typed record shape today — its result is untyped. This stays a loose,
 * documented pass-through rather than inventing a shape SmartOffice itself
 * doesn't commit to; tighten this once a second vendor's shape is known.
 */
export interface NormalizedUserRecord {
  employeeCode?: string;
  employeeName?: string;
  [key: string]: unknown;
}

export interface ClearAllLogsParams {
  serialNumber: string;
}

export interface PhotoUploadParams {
  serialNumber: string;
  employeeName: string;
  employeeCode: string;
  /** Base64-encoded image data. */
  base64Image: string;
}

/** Speed Face models only, even on SmartOffice — gated by `capabilities.clearLogsByTime`. */
export interface ClearLogsByTimeParams {
  serialNumber: string;
  /** e.g. "2022-05-09 09:00" */
  startTime: string;
  /** e.g. "2022-05-09 07:00" */
  endTime: string;
}

export interface TriggerEnrollmentParams {
  serialNumber: string;
  employeeCode: string;
  employeeName: string;
  backupNumber?: string;
}

/**
 * Returned by the facade (never by an adapter) when it declines to call an
 * optional method because `capabilities` says the resolved provider doesn't
 * support it — normalizes what would otherwise be a vendor-specific 4xx.
 */
export const UNSUPPORTED_BY_PROVIDER_CODE = 'UNSUPPORTED_BY_PROVIDER';

export interface BiometricProvider {
  readonly type: BiometricProviderType;
  readonly capabilities: BiometricCapabilities;

  enrollEmployee(params: EnrollEmployeeParams): Promise<BiometricResult<void>>;
  uploadEmployeeToDevice(params: UploadEmployeeToDeviceParams): Promise<BiometricResult<void>>;
  removeEmployeeFromDevice(params: RemoveEmployeeFromDeviceParams): Promise<BiometricResult<void>>;
  deleteEmployee(params: DeleteEmployeeParams): Promise<BiometricResult<void>>;
  blockEmployee(params: BlockEmployeeParams): Promise<BiometricResult<void>>;
  setEmployeeExpiration(params: SetExpirationParams): Promise<BiometricResult<void>>;

  addDevice(params: AddDeviceParams): Promise<BiometricResult<void>>;
  removeDevice(params: RemoveDeviceParams): Promise<BiometricResult<void>>;
  getDeviceLogs(params: GetDeviceLogsParams): Promise<BiometricResult<NormalizedLogRecord[]>>;
  getDeviceCommands(params: GetDeviceCommandsParams): Promise<BiometricResult<NormalizedCommandRecord[]>>;
  fetchLiveUsers(params: FetchLiveUsersParams): Promise<BiometricResult<NormalizedUserRecord[]>>;
  clearAllLogs(params: ClearAllLogsParams): Promise<BiometricResult<void>>;

  // Optional-by-capability — the facade checks `capabilities` before calling
  // these and returns UNSUPPORTED_BY_PROVIDER instead of letting a
  // vendor-specific rejection (or a missing method) leak up.
  uploadPhoto?(params: PhotoUploadParams): Promise<BiometricResult<void>>;
  clearLogsByTime?(params: ClearLogsByTimeParams): Promise<BiometricResult<void>>;
  triggerRemoteEnrollment?(params: TriggerEnrollmentParams): Promise<BiometricResult<void>>;
}
