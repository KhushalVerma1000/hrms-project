'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { testSmartOfficeConnection } from '@/lib/smartoffice/test-connection';
import { getDefaultProvider } from '@/lib/biometric/registry';

/**
 * Diagnostic: checks SmartOffice reachability + API key validity separately,
 * so a failure tells you WHICH of the two is broken rather than a generic
 * "something went wrong." Admin only — surfaces raw connection details.
 */
export async function testSmartOfficeConnectionAction() {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, message: 'Only Admin users can run this diagnostic.' } as const;
  }
  return testSmartOfficeConnection();
}

export async function getDevicesAction() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;
  const where: any = {};

  if (user.role === 'CLIENT' && user.clientId) {
    where.store = { clientId: user.clientId };
  } else if (user.storeId && (user.role === 'MANAGER' || user.role === 'PROCESS_ASSOCIATE' || user.role === 'SHIFT_INCHARGE')) {
    where.storeId = user.storeId;
  }

  return prisma.device.findMany({
    where,
    include: {
      store: {
        include: {
          client: true,
          warehouseType: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function addDeviceAction(data: {
  serialNumber: string;
  name: string;
  storeId: string;
  model?: string;
  /**
   * Which biometric backend this device is wired to. Defaults to the
   * isDefault BiometricProviderConfig (effectively always SmartOffice
   * today) so existing callers/forms that don't pass this yet keep working
   * unchanged — a "Provider" select can populate it explicitly once a
   * second provider config actually exists (spec Section 6).
   */
  providerId?: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const store = await prisma.store.findUnique({ where: { id: data.storeId } });
  if (!store) return { ok: false, error: 'Store not found.' };

  if (!can(session, 'device:manage', { storeId: data.storeId, clientId: store.clientId })) {
    return { ok: false, error: 'Permission denied to add biometric devices for this store.' };
  }

  if (!data.serialNumber.trim() || !data.name.trim()) {
    return { ok: false, error: 'Device serial number and device name are required.' };
  }

  try {
    const providerId = data.providerId ?? (await getDefaultProvider()).config.id;

    const device = await prisma.$transaction(async (tx) => {
      const dev = await tx.device.create({
        data: {
          serialNumber: data.serialNumber.trim(),
          name: data.name.trim(),
          storeId: data.storeId,
          model: data.model?.trim() || 'Standard Biometric',
          providerId,
        },
      });

      // AddBiometric only accepts DeviceName + SerialNumber per SmartOffice's
      // docs — there's no Location field on this endpoint. The device gets
      // associated with a location on SmartOffice's side implicitly, via
      // whichever Location the physical unit is configured to report to.
      const addBioKey = deriveIdempotencyKey('ADD_BIOMETRIC', { targetId: dev.id, payload: { SerialNumber: dev.serialNumber } });
      await enqueueCommand({
        commandType: 'ADD_BIOMETRIC',
        payload: {
          SerialNumber: dev.serialNumber,
          DeviceName: dev.name,
        },
        idempotencyKey: addBioKey,
        relatedType: 'Device',
        relatedId: dev.id,
        createdBy: session.user.id,
        tx,
      });

      return dev;
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'DEVICE_ADD',
      targetType: 'Device',
      targetId: device.id,
      metadata: { serialNumber: device.serialNumber, storeId: device.storeId },
    });

    return { ok: true, device };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to add biometric device.' };
  }
}

/**
 * Deletes a device. Goes through the SmartOfficeCommand queue like every other
 * write (previously this called SmartOffice directly and inline, which meant
 * a SmartOffice outage failed the request synchronously instead of retrying
 * in the background like ADD_BIOMETRIC does).
 *
 * SmartOffice rejects deletion if punch logs still exist for the device —
 * that's a terminal business-rule rejection (see isTerminalError), so it will
 * show up on the Sync Issues screen rather than retrying forever.
 */
export async function deleteDeviceAction(deviceId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { store: true },
  });
  if (!device) return { ok: false, error: 'Device not found.' };

  if (!can(session, 'device:manage', { storeId: device.storeId, clientId: device.store.clientId })) {
    return { ok: false, error: 'Permission denied to delete this biometric device.' };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const delBioKey = deriveIdempotencyKey('DELETE_BIOMETRIC', {
        targetId: device.id,
        payload: { SerialNumber: device.serialNumber },
      });
      await enqueueCommand({
        commandType: 'DELETE_BIOMETRIC',
        // providerId is captured here, while the Device row still exists —
        // the row is deleted below in the same transaction, so by the time
        // the worker dispatches this command asynchronously there's no
        // Device row left to resolve a provider from (see queue/worker.ts).
        payload: { SerialNumber: device.serialNumber, providerId: device.providerId },
        idempotencyKey: delBioKey,
        relatedType: 'Device',
        relatedId: device.id,
        createdBy: session.user.id,
        tx,
      });

      await tx.device.delete({ where: { id: deviceId } });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'DEVICE_DELETE',
      targetType: 'Device',
      targetId: deviceId,
      metadata: { serialNumber: device.serialNumber },
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to delete device.' };
  }
}

/**
 * Clears all attendance logs from a device. Goes through the command queue
 * (see deleteDeviceAction comment for why this matters).
 */
export async function clearDeviceLogsAction(deviceId: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can perform clear logs maintenance actions.' };
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return { ok: false, error: 'Device not found.' };

  try {
    const clearKey = deriveIdempotencyKey('CLEAR_LOGS', {
      targetId: device.id,
      payload: { SerialNumber: device.serialNumber, requestedAt: new Date().toISOString() },
    });
    await enqueueCommand({
      commandType: 'CLEAR_LOGS',
      payload: { SerialNumber: device.serialNumber },
      idempotencyKey: clearKey,
      relatedType: 'Device',
      relatedId: device.id,
      createdBy: session.user.id,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'DEVICE_CLEAR_LOGS',
      targetType: 'Device',
      targetId: deviceId,
      metadata: { serialNumber: device.serialNumber },
    });

    return { ok: true, message: 'Clear-logs command queued — it will run shortly.' };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error queuing clear-logs command.' };
  }
}
