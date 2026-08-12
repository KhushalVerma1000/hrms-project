/**
 * SmartOffice API type definitions.
 * All inbound response shapes from SmartOffice are normalized into SmartOfficeResult<T>
 * before leaving this module. Nothing downstream should special-case response shapes.
 */

/** The canonical normalized response from any SmartOffice API call. */
export interface SmartOfficeResult<T = unknown> {
  ok: boolean;
  message: string;
  data?: T;
}

/** Raw response shapes from SmartOffice (varies by endpoint — all normalized). */
export interface RawSmartOfficeResponse {
  status?: string | number;
  message?: string;
  Message?: string;
  result?: unknown;
  Result?: unknown;
  records?: unknown;
  Records?: unknown;
}

/** Set of plain-English message substrings that indicate a terminal business-rule rejection. */
const TERMINAL_ERROR_PATTERNS = [
  'Device Logs exists',
  'API key is not correct',
  'Invalid API Key',
  'Employee already exists',
  'Location already exists',
  'Company already exists',
  'Serial Number already exists',
  'Device not found',
  'Employee not found',
  'Biometric not found',
  'User not found in device',
  'Not authorized',
  'Access denied',
];

/**
 * Returns true if the error message from SmartOffice is a business-rule rejection
 * that should NOT be retried (retrying won't fix it; a human needs to intervene).
 */
export function isTerminalError(message: string): boolean {
  const lower = message.toLowerCase();
  return TERMINAL_ERROR_PATTERNS.some((pattern) =>
    lower.includes(pattern.toLowerCase()),
  );
}

/** Normalizes any raw SmartOffice response shape into SmartOfficeResult<T>. */
export function normalizeResponse<T = unknown>(
  raw: unknown,
): SmartOfficeResult<T> {
  // Handle plain string responses
  if (typeof raw === 'string') {
    const lower = raw.toLowerCase();
    const ok = lower.includes('success') || lower.includes('added') || lower.includes('deleted') || lower.includes('completed');
    return { ok, message: raw };
  }

  // Handle object responses
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as RawSmartOfficeResponse;
    const message = r.message ?? r.Message ?? 'No message';
    const result = r.result ?? r.Result ?? r.records ?? r.Records;
    
    // Status can be string "success"/"error" or numeric 1/0
    const statusOk =
      r.status === 'success' ||
      r.status === 'Success' ||
      r.status === 1 ||
      r.status === '1' ||
      (typeof message === 'string' && (
        message.toLowerCase().includes('success') ||
        message.toLowerCase().includes('added') ||
        message.toLowerCase().includes('updated') ||
        message.toLowerCase().includes('deleted') ||
        message.toLowerCase().includes('completed')
      ));

    return {
      ok: statusOk,
      message: typeof message === 'string' ? message : JSON.stringify(message),
      data: result as T,
    };
  }

  return { ok: false, message: 'Unexpected response format from SmartOffice' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Request param types
// ─────────────────────────────────────────────────────────────────────────────

export interface AddBiometricParams {
  APIKey: string;
  SerialNumber: string;
  DeviceName: string;
  LocationId: string;
  DeviceModel?: string;
}

export interface DeleteBiometricParams {
  APIKey: string;
  SerialNumber: string;
}

export interface GetDeviceLogsParams {
  APIKey: string;
  FromDate: string;  // yyyy-MM-dd
  ToDate: string;    // yyyy-MM-dd
  SerialNumber?: string;
}

export interface UploadUserParams {
  APIKey: string;
  EmployeeCode: string;
  EmployeeName: string;
  SerialNumber: string;
  CardNumber?: string;
  ExpiryDate?: string; // yyyy-MM-dd
}

export interface DeleteUserParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
}

export interface FetchLiveUsersParams {
  APIKey: string;
  SerialNumber: string;
}

export interface SetUserExpirationParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
  ExpiryDate: string; // yyyy-MM-dd
}

export interface GetDeviceCommandsParams {
  APIKey: string;
  FromDate: string;
  ToDate: string;
  SerialNumber?: string;
}

export interface PhotoUploadParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
  PhotoBase64: string;
}

export interface BlockUserParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
}

export interface ClearLogsParams {
  APIKey: string;
  SerialNumber: string;
}

export interface ClearLogsByTimeParams {
  APIKey: string;
  SerialNumber: string;
  FromDate: string;
  ToDate: string;
}

export interface TriggerEnrollmentParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
  MobileNumber?: string;
}

export interface AddEmployeeParams {
  APIKey: string;
  StaffCode: string;
  EmployeeName: string;
  CompanyId: string;       // Maps to WarehouseType in this app
  LocationId: string;      // Maps to Store
  DepartmentId?: string;
  DesignationId?: string;
  GradeId?: string;
  TeamId?: string;
  Gender?: string;
  DateOfBirth?: string;    // yyyy-MM-dd
  DateOfJoining?: string;  // yyyy-MM-dd
  CardNumber?: string;
}

export interface DeleteEmployeeParams {
  APIKey: string;
  StaffCode: string;
}

export interface AddCompanyParams {
  APIKey: string;
  CompanyName: string;
  CompanyShortName: string;
}

export interface AddDepartmentParams {
  APIKey: string;
  DepartmentName: string;
  CompanyId: string;
}

export interface AddLocationParams {
  APIKey: string;
  LocationName: string;
  CompanyId: string;
  Address?: string;
  Latitude?: string;
  Longitude?: string;
  Radius?: string;
}

export interface AddDesignationParams {
  APIKey: string;
  DesignationName: string;
  CompanyId: string;
}

export interface AddGradeParams {
  APIKey: string;
  GradeName: string;
  CompanyId: string;
}

export interface AddTeamParams {
  APIKey: string;
  TeamName: string;
  CompanyId: string;
}

/** Device log record as returned by GetDeviceLogs */
export interface DeviceLogRecord {
  EmployeeCode: string;
  LogDate: string;
  SerialNumber: string;
  PunchDirection?: string;
  Temperature?: number;
  CreationDate?: string;
}

/** Device command record as returned by GetDeviceCommands */
export interface DeviceCommandRecord {
  CommandId: string;
  CommandType: string;
  Status: string;
  EmployeeCode?: string;
  SerialNumber?: string;
  CreatedAt?: string;
  ExecutedAt?: string;
  ErrorMessage?: string;
}
