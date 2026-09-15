/**
 * SmartOfficeAdapter — the first (and, until Patch D, only) BiometricProvider
 * implementation.
 *
 * This WRAPS `src/lib/smartoffice/client.ts`; it does not reimplement it.
 * `client.ts`, `types.ts` (normalizeResponse / isTerminalError), and
 * `audit.ts` are untouched by this patch — see Section 2.4 of the spec.
 *
 * Every method below is a straight translation: generic DTO in →
 * SmartOffice's `Omit<XParams, 'APIKey'>` shape → existing client.ts
 * function → `SmartOfficeResult<T>` → `BiometricResult<T>`, via the shared
 * `callSmartOffice` helper so the SmartOfficeResult → BiometricResult
 * mapping (and isTerminalError reuse) lives in exactly one place.
 */

import * as so from '@/lib/smartoffice/client';
import { isTerminalError } from '@/lib/smartoffice/types';
import { SmartOfficeError } from '@/lib/errors';
import type { BiometricProviderConfig } from '@prisma/client';
import type {
  BiometricProvider,
  BiometricCapabilities,
  BiometricResult,
  EnrollEmployeeParams,
  UploadEmployeeToDeviceParams,
  RemoveEmployeeFromDeviceParams,
  DeleteEmployeeParams,
  BlockEmployeeParams,
  SetExpirationParams,
  AddDeviceParams,
  RemoveDeviceParams,
  GetDeviceLogsParams,
  NormalizedLogRecord,
  GetDeviceCommandsParams,
  NormalizedCommandRecord,
  FetchLiveUsersParams,
  NormalizedUserRecord,
  ClearAllLogsParams,
  PhotoUploadParams,
  ClearLogsByTimeParams,
  TriggerEnrollmentParams,
} from '../types';

const CAPABILITIES: BiometricCapabilities = {
  // photoUploadInBiometric throws "not wired up in this MVP" in client.ts
  // itself (Section 7.1 of the base spec) — false here for the same reason,
  // not a new restriction introduced by this adapter.
  photoUpload: false,
  // Real capability gate is per-device (Speed Face models only, via
  // Device.model) — that's a facade/call-site concern, not a provider-level
  // one, so this stays true; SmartOffice supports the endpoint.
  clearLogsByTime: true,
  remoteEnrollment: true,
  liveUserFetch: true,
};

/**
 * Normalizes a client.ts call into BiometricResult<T>. client.ts functions
 * either resolve with a SmartOfficeResult (success, or a non-terminal
 * failure) or throw SmartOfficeError (terminal business-rule rejection, or
 * "unreachable" after exhausting retries) — both paths are handled here so
 * every adapter method below stays a one-line call.
 */
async function callSmartOffice<T>(
  fn: () => Promise<{ ok: boolean; message: string; data?: unknown }>,
): Promise<BiometricResult<T>> {
  try {
    const result = await fn();
    if (result.ok) return { ok: true, data: result.data as T };
    return {
      ok: false,
      terminal: isTerminalError(result.message),
      code: 'SMARTOFFICE_REJECTED',
      message: result.message,
    };
  } catch (err) {
    if (err instanceof SmartOfficeError) {
      return {
        ok: false,
        terminal: err.isTerminal,
        code: err.isTerminal ? 'SMARTOFFICE_REJECTED' : 'SMARTOFFICE_UNREACHABLE',
        message: err.message,
      };
    }
    return {
      ok: false,
      terminal: false,
      code: 'SMARTOFFICE_UNKNOWN_ERROR',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export class SmartOfficeAdapter implements BiometricProvider {
  readonly type = 'SMARTOFFICE' as const;
  readonly capabilities = CAPABILITIES;

  /**
   * `config` (baseUrl/apiKeyEnv/timezone on the BiometricProviderConfig row)
   * is accepted for interface symmetry with future adapters but NOT yet
   * read here — client.ts still sources SMARTOFFICE_BASE_URL /
   * SMARTOFFICE_API_KEY directly from src/lib/config.ts, matching "zero
   * behavior change on day one" (spec Section 2.4). Only relevant once a
   * second SmartOffice-type config row (or a per-row credential) is
   * actually needed.
   */
  constructor(private readonly config: BiometricProviderConfig) {}

  enrollEmployee(params: EnrollEmployeeParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.addEmployee({
        StaffCode: params.staffCode,
        StaffName: params.staffName,
        Gender: params.gender,
        Status: params.status,
        CompanySName: params.companyShortName,
        DepartmentSName: params.departmentShortName,
        Location: params.locationName,
        Designation: params.designation,
        Grade: params.grade,
        Team: params.team,
        DOJ: params.dateOfJoining,
        DOC: params.dateOfConfirmation,
        DOB: params.dateOfBirth,
        DOR: params.dateOfRelieving,
      }),
    );
  }

  uploadEmployeeToDevice(params: UploadEmployeeToDeviceParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.uploadUser({
        EmployeeCode: params.employeeCode,
        EmployeeName: params.employeeName,
        SerialNumber: params.serialNumbers,
        CardNumber: params.cardNumber,
        VerifyMode: params.verifyMode,
        IsFaceUpload: params.isFaceUpload,
        IsFPUpload: params.isFingerprintUpload,
        IsCardUpload: params.isCardUpload,
        IsBioPasswordUpload: params.isBioPasswordUpload,
      }),
    );
  }

  removeEmployeeFromDevice(params: RemoveEmployeeFromDeviceParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.deleteUser({
        EmployeeCode: params.employeeCode,
        SerialNumber: params.serialNumbers,
      }),
    );
  }

  deleteEmployee(params: DeleteEmployeeParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() => so.deleteEmployee({ EmployeeCode: params.employeeCode }));
  }

  blockEmployee(params: BlockEmployeeParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.blockUserInBiometric({
        EmployeeCode: params.employeeCode,
        SerialNumber: params.serialNumber,
        BlockUser: params.block ? 0 : 1,
      }),
    );
  }

  setEmployeeExpiration(params: SetExpirationParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.setUserExpiration({
        SerialNumber: params.serialNumber,
        EmployeeCode: params.employeeCode,
        ExpirationDate: params.expirationDate,
      }),
    );
  }

  addDevice(params: AddDeviceParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.addBiometricDevice({
        SerialNumber: params.serialNumber,
        DeviceName: params.deviceName,
      }),
    );
  }

  removeDevice(params: RemoveDeviceParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() => so.deleteBiometricDevice({ SerialNumber: params.serialNumber }));
  }

  async getDeviceLogs(params: GetDeviceLogsParams): Promise<BiometricResult<NormalizedLogRecord[]>> {
    const result = await callSmartOffice(() =>
      so.getDeviceLogs({
        FromDate: params.fromDate,
        ToDate: params.toDate,
        SerialNumber: params.serialNumber,
      }),
    );
    if (!result.ok) return result;
    const records = (result.data ?? []) as Array<{
      EmployeeCode: string;
      LogDate: string;
      SerialNumber: string;
      PunchDirection?: string;
      Temperature?: number;
      TemperatureState?: string;
    }>;
    return {
      ok: true,
      data: records.map((r) => ({
        employeeCode: r.EmployeeCode,
        logDate: r.LogDate,
        serialNumber: r.SerialNumber,
        punchDirection: r.PunchDirection,
        temperature: r.Temperature,
        temperatureState: r.TemperatureState,
      })),
    };
  }

  async getDeviceCommands(
    params: GetDeviceCommandsParams,
  ): Promise<BiometricResult<NormalizedCommandRecord[]>> {
    const result = await callSmartOffice(() =>
      so.getDeviceCommands({
        FromDate: params.fromDate,
        ToDate: params.toDate,
        SerialNumbers: params.serialNumbers,
      }),
    );
    if (!result.ok) return result;
    const records = (result.data ?? []) as Array<{
      Title: string;
      DeviceCode: string;
      SerialNumber: string;
      CreationDate: string;
      ExecutionDate?: string;
      Status: string;
      Response?: string;
    }>;
    return {
      ok: true,
      data: records.map((r) => ({
        title: r.Title,
        deviceCode: r.DeviceCode,
        serialNumber: r.SerialNumber,
        creationDate: r.CreationDate,
        executionDate: r.ExecutionDate,
        status: r.Status,
        response: r.Response,
      })),
    };
  }

  async fetchLiveUsers(params: FetchLiveUsersParams): Promise<BiometricResult<NormalizedUserRecord[]>> {
    const result = await callSmartOffice<unknown>(() =>
      so.fetchLiveUsers({ SerialNumber: params.serialNumber }),
    );
    if (!result.ok) return result;
    // client.ts leaves FetchLiveUsersFromBiometric untyped (see types.ts
    // comment) — normalize just enough to guarantee an array downstream.
    const data = Array.isArray(result.data) ? (result.data as NormalizedUserRecord[]) : [];
    return { ok: true, data };
  }

  clearAllLogs(params: ClearAllLogsParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() => so.clearAllLogsFromDevice({ SerialNumber: params.serialNumber }));
  }

  // uploadPhoto intentionally NOT implemented — capabilities.photoUpload is
  // false, so the facade will short-circuit to UNSUPPORTED_BY_PROVIDER
  // before this would ever be called. client.ts's own wrapper throws for
  // the same reason (see Section 7.1 of the base spec).

  clearLogsByTime(params: ClearLogsByTimeParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.clearLogsFromDeviceByTime({
        SerialNumber: params.serialNumber,
        StartTime: params.startTime,
        EndTime: params.endTime,
      }),
    );
  }

  triggerRemoteEnrollment(params: TriggerEnrollmentParams): Promise<BiometricResult<void>> {
    return callSmartOffice(() =>
      so.triggerUserOnlineEnrollment({
        SerialNumber: params.serialNumber,
        EmployeeCode: params.employeeCode,
        EmployeeName: params.employeeName,
        backup_number: params.backupNumber,
      }),
    );
  }
}
