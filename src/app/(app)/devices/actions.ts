'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { smartOfficeClient } from '@/lib/smartoffice/client';

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
    const device = await prisma.$transaction(async (tx) => {
      const dev = await tx.device.create({
        data: {
          serialNumber: data.serialNumber.trim(),
          name: data.name.trim(),
          storeId: data.storeId,
          model: data.model?.trim() || 'Standard Biometric',
        },
      });

      const addBioKey = deriveIdempotencyKey('ADD_BIOMETRIC', { targetId: dev.id, payload: { SerialNumber: dev.serialNumber } });
      await enqueueCommand({
        commandType: 'ADD_BIOMETRIC',
        payload: {
          SerialNumber: dev.serialNumber,
          DeviceName: dev.name,
          LocationName: store.name,
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
    // Attempt SmartOffice direct call to verify if logs exist on device
    const smRes = await smartOfficeClient.deleteBiometricDevice({ SerialNumber: device.serialNumber });
    if (!smRes.ok) {
      // Pass through SmartOffice's exact error message verbatim to the UI (Section 8)
      return { ok: false, error: smRes.message || 'Device Logs exists for this device, You can not delete' };
    }

    await prisma.device.delete({ where: { id: deviceId } });

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

export async function clearDeviceLogsAction(deviceId: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can perform clear logs maintenance actions.' };
  }

  const device = await prisma.device.findUnique({ where: { id: deviceId } });
  if (!device) return { ok: false, error: 'Device not found.' };

  try {
    const smRes = await smartOfficeClient.clearAllLogsFromDevice({ SerialNumber: device.serialNumber });
    if (!smRes.ok) {
      return { ok: false, error: smRes.message || 'Failed to clear device logs.' };
    }

    await writeAuditLog({
      userId: session.user.id,
      action: 'DEVICE_CLEAR_LOGS',
      targetType: 'Device',
      targetId: deviceId,
      metadata: { serialNumber: device.serialNumber },
    });

    return { ok: true, message: 'All logs cleared successfully from device.' };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Error clearing logs.' };
  }
}
