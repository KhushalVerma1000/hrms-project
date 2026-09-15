/**
 * ManualAdapter — formalizes what a MANUAL-mode store (no biometric device
 * at all) means to the biometric-provider abstraction: every write is a
 * harmless no-op success, every read returns an empty result, `ok: true`.
 *
 * Resolves the Open Question flagged in Section 7 of the spec: reads return
 * empty arrays rather than erroring, because `ManualAttendanceEntry` is
 * already the source of truth for MANUAL stores (see
 * src/lib/attendance) — the facade should never fail a caller just because
 * a store has no biometric device.
 */

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
} from '../types';

const CAPABILITIES: BiometricCapabilities = {
  photoUpload: false,
  clearLogsByTime: false,
  remoteEnrollment: false,
  liveUserFetch: false,
};

export class ManualAdapter implements BiometricProvider {
  readonly type = 'MANUAL' as const;
  readonly capabilities = CAPABILITIES;

  // Accepted for interface symmetry with SmartOfficeAdapter; MANUAL config
  // rows carry no baseUrl/apiKeyEnv/timezone worth reading.
  constructor(private readonly config: BiometricProviderConfig) {}

  async enrollEmployee(_params: EnrollEmployeeParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async uploadEmployeeToDevice(_params: UploadEmployeeToDeviceParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async removeEmployeeFromDevice(_params: RemoveEmployeeFromDeviceParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async deleteEmployee(_params: DeleteEmployeeParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async blockEmployee(_params: BlockEmployeeParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async setEmployeeExpiration(_params: SetExpirationParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async addDevice(_params: AddDeviceParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async removeDevice(_params: RemoveDeviceParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  async getDeviceLogs(_params: GetDeviceLogsParams): Promise<BiometricResult<NormalizedLogRecord[]>> {
    return { ok: true, data: [] };
  }

  async getDeviceCommands(
    _params: GetDeviceCommandsParams,
  ): Promise<BiometricResult<NormalizedCommandRecord[]>> {
    return { ok: true, data: [] };
  }

  async fetchLiveUsers(_params: FetchLiveUsersParams): Promise<BiometricResult<NormalizedUserRecord[]>> {
    return { ok: true, data: [] };
  }

  async clearAllLogs(_params: ClearAllLogsParams): Promise<BiometricResult<void>> {
    return { ok: true, data: undefined };
  }

  // uploadPhoto / clearLogsByTime / triggerRemoteEnrollment intentionally
  // left unimplemented — capabilities are all false, so the facade
  // short-circuits to UNSUPPORTED_BY_PROVIDER before these would be called.
}
