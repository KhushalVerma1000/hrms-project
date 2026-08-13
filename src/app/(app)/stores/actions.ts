'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { assignClientCode, assignWarehouseTypeCode, assignStoreCode } from '@/lib/ecode';
import { writeAuditLog } from '@/lib/smartoffice/audit';

export async function getStoresDataAction() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;

  const where: any = {};
  if (user.role === 'CLIENT' && user.clientId) {
    where.clientId = user.clientId;
  } else if (user.storeId && (user.role === 'MANAGER' || user.role === 'PROCESS_ASSOCIATE' || user.role === 'SHIFT_INCHARGE')) {
    where.id = user.storeId;
  }

  const stores = await prisma.store.findMany({
    where,
    include: {
      client: true,
      warehouseType: true,
      devices: true,
      _count: { select: { employees: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  let clients: any[] = [];
  let warehouseTypes: any[] = [];

  if (user.role === 'ADMIN') {
    clients = await prisma.client.findMany({ orderBy: { name: 'asc' } });
    warehouseTypes = await prisma.warehouseType.findMany({ orderBy: { name: 'asc' } });
  } else if (user.role === 'CLIENT' && user.clientId) {
    clients = await prisma.client.findMany({ where: { id: user.clientId } });
    warehouseTypes = await prisma.warehouseType.findMany({ orderBy: { name: 'asc' } });
  }

  return { stores, clients, warehouseTypes };
}

export async function createClientAction(
  name: string,
  shortName: string,
  email?: string,
  googleFormBaseUrl?: string,
  googleFormECodeFieldId?: string,
) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can create Client accounts.' };
  }

  if (!name.trim() || !shortName.trim()) {
    return { ok: false, error: 'Client name and short name are required.' };
  }

  try {
    const client = await prisma.$transaction(async (tx) => {
      const code = await assignClientCode(tx);
      return tx.client.create({
        data: {
          code,
          name: name.trim(),
          shortName: shortName.trim().toUpperCase(),
          email: email?.trim() || null,
          googleFormBaseUrl: googleFormBaseUrl?.trim() || null,
          googleFormECodeFieldId: googleFormECodeFieldId?.trim() || null,
        },
      });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'CLIENT_CREATE',
      targetType: 'Client',
      targetId: client.id,
      metadata: { code: client.code, name: client.name },
    });

    return { ok: true, client };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to create client.' };
  }
}

/**
 * Updates a Client's Google Form onboarding link (Section 13.5). Split out
 * from createClientAction so an existing Client can have this added/changed
 * later without re-creating the whole record. Admin only.
 */
export async function updateClientGoogleFormAction(
  clientId: string,
  googleFormBaseUrl: string,
  googleFormECodeFieldId: string,
) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can edit Client Google Form settings.' };
  }

  if (googleFormBaseUrl.trim()) {
    try {
      // eslint-disable-next-line no-new
      new URL(googleFormBaseUrl.trim());
    } catch {
      return { ok: false, error: 'Google Form Base URL is not a valid URL.' };
    }
  }

  try {
    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        googleFormBaseUrl: googleFormBaseUrl.trim() || null,
        googleFormECodeFieldId: googleFormECodeFieldId.trim() || null,
      },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'CLIENT_GOOGLE_FORM_UPDATE',
      targetType: 'Client',
      targetId: client.id,
      metadata: {
        googleFormBaseUrl: client.googleFormBaseUrl,
        googleFormECodeFieldId: client.googleFormECodeFieldId,
      },
    });

    return { ok: true, client };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to update client Google Form settings.' };
  }
}

export async function createWarehouseTypeAction(name: string) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can create Warehouse Types (Brands).' };
  }

  if (!name.trim()) return { ok: false, error: 'Warehouse brand name is required.' };

  try {
    const wt = await prisma.$transaction(async (tx) => {
      const code = await assignWarehouseTypeCode(tx);
      return tx.warehouseType.create({
        data: {
          code,
          name: name.trim(),
        },
      });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'WAREHOUSE_TYPE_CREATE',
      targetType: 'WarehouseType',
      targetId: wt.id,
      metadata: { code: wt.code, name: wt.name },
    });

    return { ok: true, warehouseType: wt };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to create warehouse brand.' };
  }
}

export async function createStoreAction(data: {
  name: string;
  clientId: string;
  warehouseTypeId: string;
  externalStoreCode?: string;
  address?: string;
  geofenceRadius?: number;
  attendanceMode?: 'BIOMETRIC' | 'MANUAL';
}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  if (!can(session, 'store:manage', { clientId: data.clientId })) {
    return { ok: false, error: 'Permission denied to create stores for this client.' };
  }

  if (!data.name.trim() || !data.clientId || !data.warehouseTypeId) {
    return { ok: false, error: 'Store name, client, and warehouse brand are required.' };
  }

  try {
    const store = await prisma.$transaction(async (tx) => {
      const code = await assignStoreCode(tx, data.clientId);
      return tx.store.create({
        data: {
          code,
          name: data.name.trim(),
          clientId: data.clientId,
          warehouseTypeId: data.warehouseTypeId,
          externalStoreCode: data.externalStoreCode?.trim() || null,
          address: data.address?.trim() || null,
          geofenceRadius: data.geofenceRadius || 200,
          attendanceMode: data.attendanceMode || 'BIOMETRIC',
        },
      });
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'STORE_CREATE',
      targetType: 'Store',
      targetId: store.id,
      metadata: { code: store.code, name: store.name, clientId: store.clientId, attendanceMode: store.attendanceMode },
    });

    return { ok: true, store };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to create store.' };
  }
}

/**
 * Updates a Store's attendance mode after creation (e.g. a biometric device
 * gets installed later, or breaks and the store needs to fall back to manual
 * entry temporarily). Admin/Client only.
 */
export async function updateStoreAttendanceModeAction(
  storeId: string,
  attendanceMode: 'BIOMETRIC' | 'MANUAL',
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { clientId: true, name: true } });
  if (!store) return { ok: false, error: 'Store not found.' };

  if (!can(session, 'store:manage', { clientId: store.clientId })) {
    return { ok: false, error: 'Permission denied to edit this store.' };
  }

  const updated = await prisma.store.update({
    where: { id: storeId },
    data: { attendanceMode },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'STORE_ATTENDANCE_MODE_CHANGED',
    targetType: 'Store',
    targetId: storeId,
    metadata: { name: store.name, newMode: attendanceMode },
  });

  return { ok: true, store: updated };
}
