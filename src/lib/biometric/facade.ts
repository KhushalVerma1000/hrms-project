/**
 * Biometric facade — the ONLY import surface business logic should use for
 * biometric-provider operations (Section 3.4 of the spec). Route actions,
 * `queue/worker.ts`, and `sync/attendance.ts` resolve which adapter to use
 * from here; they should never import an adapter or
 * `src/lib/smartoffice/client.ts` directly.
 *
 * This file is purely additive as of Patch B — no existing call site has
 * been migrated to it yet (that's Patch C). It's safe to deploy standalone.
 *
 * Resolution rule (documented once, applies to every function below):
 *   - Functions scoped to an existing Device (`deviceId` first param) — e.g.
 *     pushing a punch log, blocking a user on one device — resolve their
 *     provider from that Device's `providerId` and auto-fill `serialNumber`
 *     from the device row, so call sites don't have to duplicate it.
 *   - Functions with no Device row to resolve against — registering a
 *     brand-new device (the row doesn't exist yet), or SmartOffice's
 *     AddEmployee/DeleteEmployee (Location-level, not device-level) — take
 *     `providerId` directly. Today that's effectively always the single
 *     default SmartOffice config; per-store provider resolution is flagged
 *     as an open question for Patch C once the 11 call sites are migrated
 *     and it's clear which of them actually need it (a Store has no
 *     `providerId` of its own in this schema — only Device does).
 */

import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import { resolveProvider, getProviderById, getProviderBySerialNumber, getProvidersForSerialNumbers } from './registry';
import { UNSUPPORTED_BY_PROVIDER_CODE } from './types';
import type {
  BiometricProvider,
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
  NormalizedUserRecord,
  PhotoUploadParams,
  ClearLogsByTimeParams,
  TriggerEnrollmentParams,
} from './types';

interface ResolvedDevice {
  provider: BiometricProvider;
  serialNumber: string;
}

async function resolveDevice(deviceId: string): Promise<ResolvedDevice> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { provider: true },
  });
  if (!device) throw new NotFoundError('Device', deviceId);
  return { provider: resolveProvider(device.provider), serialNumber: device.serialNumber };
}

function unsupported<T = void>(methodName: string): BiometricResult<T> {
  return {
    ok: false,
    terminal: true,
    code: UNSUPPORTED_BY_PROVIDER_CODE,
    message: `The resolved biometric provider does not support ${methodName}.`,
  };
}

async function resolveBySerial(serialNumber: string): Promise<{ provider: BiometricProvider; deviceId: string }> {
  const resolved = await getProviderBySerialNumber(serialNumber);
  if (!resolved) throw new NotFoundError('Device', serialNumber);
  return resolved;
}

function aggregateVoidResults(results: BiometricResult<void>[]): BiometricResult<void> {
  const failures = results.filter(
    (r): r is Extract<BiometricResult<void>, { ok: false }> => !r.ok,
  );
  if (failures.length === 0) return { ok: true, data: undefined };
  // If every failing group failed terminally, the whole call is terminal;
  // if any group only hit a retryable/unreachable failure, the caller
  // (queue/worker.ts) should still retry the command as a whole — a single
  // SmartOfficeCommand row doesn't track partial per-device success today.
  return {
    ok: false,
    terminal: failures.every((f) => f.terminal),
    code: failures[0].code,
    message: failures.map((f) => f.message).join('; '),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider-scoped (no existing Device row to resolve against)
// ─────────────────────────────────────────────────────────────────────────────

export async function enrollEmployee(
  providerId: string,
  params: EnrollEmployeeParams,
): Promise<BiometricResult<void>> {
  const { provider } = await getProviderById(providerId);
  return provider.enrollEmployee(params);
}

export async function deleteEmployee(
  providerId: string,
  params: DeleteEmployeeParams,
): Promise<BiometricResult<void>> {
  const { provider } = await getProviderById(providerId);
  return provider.deleteEmployee(params);
}

export async function addDevice(
  providerId: string,
  params: AddDeviceParams,
): Promise<BiometricResult<void>> {
  const { provider } = await getProviderById(providerId);
  return provider.addDevice(params);
}

/**
 * Removes a device by explicit providerId rather than deviceId. Needed
 * because `deleteDeviceAction` deletes the Device row synchronously, in the
 * same transaction that enqueues DELETE_BIOMETRIC — by the time this async
 * command dispatches, there's no Device row left to resolve a provider from
 * (see queue/worker.ts). The caller (worker) captures providerId in the
 * command payload at enqueue time, while the row still exists.
 */
export async function removeDeviceForProvider(
  providerId: string,
  params: RemoveDeviceParams,
): Promise<BiometricResult<void>> {
  const { provider } = await getProviderById(providerId);
  return provider.removeDevice(params);
}

/**
 * Registers a device with its already-assigned provider, resolved by serial
 * number rather than deviceId — used by queue/worker.ts for ADD_BIOMETRIC,
 * where the payload carries SerialNumber/DeviceName in SmartOffice's own
 * wire format. Unlike DELETE_BIOMETRIC, the Device row still exists at
 * dispatch time here (addDeviceAction never deletes it), so serial-based
 * lookup works.
 */
export async function addDeviceBySerial(
  serialNumber: string,
  params: Omit<AddDeviceParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  return provider.addDevice({ ...params, serialNumber });
}

// ─────────────────────────────────────────────────────────────────────────────
// Device-scoped
// ─────────────────────────────────────────────────────────────────────────────

export async function removeDevice(deviceId: string): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.removeDevice({ serialNumber });
}

export async function uploadEmployeeToDevice(
  deviceId: string,
  params: Omit<UploadEmployeeToDeviceParams, 'serialNumbers'> & { serialNumbers?: string },
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.uploadEmployeeToDevice({
    ...params,
    serialNumbers: params.serialNumbers ?? serialNumber,
  });
}

export async function removeEmployeeFromDevice(
  deviceId: string,
  params: Omit<RemoveEmployeeFromDeviceParams, 'serialNumbers'> & { serialNumbers?: string },
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.removeEmployeeFromDevice({
    ...params,
    serialNumbers: params.serialNumbers ?? serialNumber,
  });
}

export async function blockEmployee(
  deviceId: string,
  params: Omit<BlockEmployeeParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.blockEmployee({ ...params, serialNumber });
}

export async function setEmployeeExpiration(
  deviceId: string,
  params: Omit<SetExpirationParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.setEmployeeExpiration({ ...params, serialNumber });
}

export async function getDeviceLogs(
  deviceId: string,
  params: Omit<GetDeviceLogsParams, 'serialNumber'>,
): Promise<BiometricResult<NormalizedLogRecord[]>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.getDeviceLogs({ ...params, serialNumber });
}

export async function getDeviceCommands(
  deviceId: string,
  params: GetDeviceCommandsParams,
): Promise<BiometricResult<NormalizedCommandRecord[]>> {
  const { provider } = await resolveDevice(deviceId);
  return provider.getDeviceCommands(params);
}

export async function fetchLiveUsers(deviceId: string): Promise<BiometricResult<NormalizedUserRecord[]>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.fetchLiveUsers({ serialNumber });
}

export async function clearAllLogs(deviceId: string): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  return provider.clearAllLogs({ serialNumber });
}

// ─────────────────────────────────────────────────────────────────────────────
// Optional-by-capability — checked here so a vendor that doesn't support one
// of these gets a normalized UNSUPPORTED_BY_PROVIDER result instead of a
// thrown "not a function" or a vendor-specific rejection leaking up.
// ─────────────────────────────────────────────────────────────────────────────

export async function uploadPhoto(
  deviceId: string,
  params: Omit<PhotoUploadParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  if (!provider.capabilities.photoUpload || !provider.uploadPhoto) return unsupported('uploadPhoto');
  return provider.uploadPhoto({ ...params, serialNumber });
}

export async function clearLogsByTime(
  deviceId: string,
  params: Omit<ClearLogsByTimeParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  if (!provider.capabilities.clearLogsByTime || !provider.clearLogsByTime) {
    return unsupported('clearLogsByTime');
  }
  return provider.clearLogsByTime({ ...params, serialNumber });
}

export async function triggerRemoteEnrollment(
  deviceId: string,
  params: Omit<TriggerEnrollmentParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider, serialNumber } = await resolveDevice(deviceId);
  if (!provider.capabilities.remoteEnrollment || !provider.triggerRemoteEnrollment) {
    return unsupported('triggerRemoteEnrollment');
  }
  return provider.triggerRemoteEnrollment({ ...params, serialNumber });
}

// ─────────────────────────────────────────────────────────────────────────────
// Serial-number-scoped — for queue/worker.ts, whose SmartOfficeCommand
// payloads carry SmartOffice's own SerialNumber field(s) rather than a
// deviceId. Single-serial functions mirror the deviceId-scoped ones above;
// the two *BySerials (plural) functions handle SmartOffice's
// comma-joined-multi-device convention (UploadUser/DeleteUser) by grouping
// per resolved provider — see registry.getProvidersForSerialNumbers.
// ─────────────────────────────────────────────────────────────────────────────

export async function blockEmployeeBySerial(
  serialNumber: string,
  params: Omit<BlockEmployeeParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  return provider.blockEmployee({ ...params, serialNumber });
}

export async function setEmployeeExpirationBySerial(
  serialNumber: string,
  params: Omit<SetExpirationParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  return provider.setEmployeeExpiration({ ...params, serialNumber });
}

export async function clearAllLogsBySerial(serialNumber: string): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  return provider.clearAllLogs({ serialNumber });
}

export async function clearLogsByTimeBySerial(
  serialNumber: string,
  params: Omit<ClearLogsByTimeParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  if (!provider.capabilities.clearLogsByTime || !provider.clearLogsByTime) {
    return unsupported('clearLogsByTime');
  }
  return provider.clearLogsByTime({ ...params, serialNumber });
}

export async function triggerRemoteEnrollmentBySerial(
  serialNumber: string,
  params: Omit<TriggerEnrollmentParams, 'serialNumber'>,
): Promise<BiometricResult<void>> {
  const { provider } = await resolveBySerial(serialNumber);
  if (!provider.capabilities.remoteEnrollment || !provider.triggerRemoteEnrollment) {
    return unsupported('triggerRemoteEnrollment');
  }
  return provider.triggerRemoteEnrollment({ ...params, serialNumber });
}

export async function uploadEmployeeToDeviceBySerials(
  serialNumbers: string,
  params: Omit<UploadEmployeeToDeviceParams, 'serialNumbers'>,
): Promise<BiometricResult<void>> {
  const serials = serialNumbers.split(',').map((s) => s.trim()).filter(Boolean);
  const groups = await getProvidersForSerialNumbers(serials);
  if (groups.size === 0) {
    return {
      ok: false,
      terminal: true,
      code: 'DEVICE_NOT_FOUND',
      message: `No device found for serial number(s): ${serialNumbers}`,
    };
  }
  const results = await Promise.all(
    Array.from(groups.values()).map(({ provider, serialNumbers: groupSerials }) =>
      provider.uploadEmployeeToDevice({ ...params, serialNumbers: groupSerials.join(',') }),
    ),
  );
  return aggregateVoidResults(results);
}

export async function removeEmployeeFromDeviceBySerials(
  serialNumbers: string,
  params: Omit<RemoveEmployeeFromDeviceParams, 'serialNumbers'>,
): Promise<BiometricResult<void>> {
  const serials = serialNumbers.split(',').map((s) => s.trim()).filter(Boolean);
  const groups = await getProvidersForSerialNumbers(serials);
  if (groups.size === 0) {
    return {
      ok: false,
      terminal: true,
      code: 'DEVICE_NOT_FOUND',
      message: `No device found for serial number(s): ${serialNumbers}`,
    };
  }
  const results = await Promise.all(
    Array.from(groups.values()).map(({ provider, serialNumbers: groupSerials }) =>
      provider.removeEmployeeFromDevice({ ...params, serialNumbers: groupSerials.join(',') }),
    ),
  );
  return aggregateVoidResults(results);
}
