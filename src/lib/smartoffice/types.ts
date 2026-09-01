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
//
// IMPORTANT: field names below are taken verbatim from
// SmartOfficeAPIDocumentation.pdf (v1.0.4), NOT guessed/renamed to match this
// app's internal naming. SmartOffice's own field names are frequently
// inconsistent across endpoints (e.g. "CompanySName" vs "CompanyShortName"
// nowhere in the doc, "StaffName" instead of "EmployeeName" for AddEmployee
// but "EmployeeName" elsewhere) — resist the urge to "clean these up" to be
// consistent with each other; they must match the live API exactly.
// ─────────────────────────────────────────────────────────────────────────────

export interface AddBiometricParams {
  APIKey: string;
  SerialNumber: string;
  DeviceName: string;
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
  /** Comma-separate multiple serial numbers to upload to more than one device at once. */
  SerialNumber: string;
  CardNumber?: string;
  /** Dual verification mode (face+card). */
  VerifyMode?: string;
  IsFaceUpload?: boolean;
  IsFPUpload?: boolean;
  IsCardUpload?: boolean;
  IsBioPasswordUpload?: boolean;
}

export interface DeleteUserParams {
  APIKey: string;
  EmployeeCode: string;
  /** Comma-separate multiple serial numbers to delete from more than one device at once. */
  SerialNumber: string;
}

export interface FetchLiveUsersParams {
  APIKey: string;
  SerialNumber: string;
}

export interface SetUserExpirationParams {
  APIKey: string;
  /** Biometric serial number. Pass "0" to apply to all biometric devices. */
  SerialNumber: string;
  EmployeeCode: string;
  /** yyyy-MM-dd */
  ExpirationDate: string;
}

export interface GetDeviceCommandsParams {
  APIKey: string;
  FromDate: string;
  ToDate: string;
  /** Comma-separated list, e.g. "C2688C21CB2D172711,ADZV213760072". Plural per the API. */
  SerialNumbers?: string;
}

export interface PhotoUploadParams {
  APIKey: string;
  SerialNumber: string;
  EmployeeName: string;
  EmployeeCode: string;
  Base64String: string;
}

export interface BlockUserParams {
  APIKey: string;
  EmployeeCode: string;
  SerialNumber: string;
  /** 0 = block the user, 1 = unblock the user. */
  BlockUser: 0 | 1;
}

export interface ClearLogsParams {
  APIKey: string;
  SerialNumber: string;
}

/** Speed Face models only. */
export interface ClearLogsByTimeParams {
  APIKey: string;
  SerialNumber: string;
  /** e.g. "2022-05-09 09:00" */
  StartTime: string;
  /** e.g. "2022-05-09 07:00" */
  EndTime: string;
}

export interface TriggerEnrollmentParams {
  APIKey: string;
  SerialNumber: string;
  EmployeeCode: string;
  EmployeeName: string;
  backup_number?: string;
}

export interface AddEmployeeParams {
  APIKey: string;
  StaffCode: string;
  StaffName: string;
  Gender?: string;
  /** e.g. "Working" */
  Status?: string;
  /** Company short name — maps to WarehouseType.name in this app. */
  CompanySName: string;
  /** Department short name. */
  DepartmentSName?: string;
  /** Location name — maps to Store.name in this app. */
  Location: string;
  Designation?: string;
  Grade?: string;
  Team?: string;
  /** Date of Joining, yyyy-MM-dd */
  DOJ?: string;
  /** Date of Confirmation, yyyy-MM-dd */
  DOC?: string;
  /** Date of Birth, yyyy-MM-dd */
  DOB?: string;
  /** Date of Relieving, yyyy-MM-dd */
  DOR?: string;
}

export interface DeleteEmployeeParams {
  APIKey: string;
  EmployeeCode: string;
}

export interface AddCompanyParams {
  APIKey: string;
  BranchFullName: string;
  BranchShortName: string;
  BranchAddress?: string;
  BrancheMail?: string;
  BranchWebsite?: string;
}

export interface AddDepartmentParams {
  APIKey: string;
  DepartmentFName: string;
  DepartmentSName: string;
  DepartmenteMail?: string;
  Description?: string;
}

export interface AddLocationParams {
  APIKey: string;
  LocationName: string;
  LocationCode: string;
  eMail?: string;
  LocationLattitude?: string;
  LocationLongitude?: string;
  Radius?: string;
  LocationFullAddress?: string;
}

export interface AddDesignationParams {
  APIKey: string;
  DesignationsName: string;
  DesignationCode: string;
}

export interface AddGradeParams {
  APIKey: string;
  GradeCode: string;
  GradeName: string;
}

export interface AddTeamParams {
  APIKey: string;
  TeamCode: string;
  TeamName: string;
}

/** Device log record as returned by GetDeviceLogs */
export interface DeviceLogRecord {
  EmployeeCode: string;
  LogDate: string;
  SerialNumber: string;
  PunchDirection?: string;
  Temperature?: number;
  TemperatureState?: string;
}

/** Device command record as returned by GetDeviceCommands */
export interface DeviceCommandRecord {
  Title: string;
  DeviceCode: string;
  SerialNumber: string;
  CreationDate: string;
  ExecutionDate?: string;
  Status: string;
  Response?: string;
}
