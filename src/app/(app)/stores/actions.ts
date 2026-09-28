'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { assignClientCode, assignWarehouseTypeCode, assignStoreCode } from '@/lib/ecode';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { parseGstin } from '@/lib/gstin';

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

  // Non-admins never need the numbering codes (they are the building blocks
  // of employee codes) — strip them here so they don't reach the browser at
  // all, rather than just hiding them in the UI.
  if (user.role !== 'ADMIN') {
    const noCode = <T extends { code?: unknown }>(o: T): Omit<T, 'code'> => {
      const { code: _code, ...rest } = o;
      return rest;
    };
    return {
      stores: stores.map((st) => ({
        ...noCode(st),
        client: noCode(st.client),
        warehouseType: noCode(st.warehouseType),
      })),
      clients: clients.map(noCode),
      warehouseTypes: warehouseTypes.map(noCode),
    };
  }

  return { stores, clients, warehouseTypes };
}

export async function createClientAction(
  name: string,
  shortName: string,
  email?: string,
  googleFormBaseUrl?: string,
  googleFormECodeFieldId?: string,
  location?: string,
  gstin?: string,
) {
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    return { ok: false, error: 'Only Admin users can create Client accounts.' };
  }

  if (!name.trim() || !shortName.trim()) {
    return { ok: false, error: 'Client name and short name are required.' };
  }

  const gst = parseGstin(gstin);
  if (!gst.ok) return { ok: false, error: gst.error };

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
          location: location?.trim() || null,
          gstin: gst.value,
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
  location?: string;
  gstin?: string;
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

  const gst = parseGstin(data.gstin);
  if (!gst.ok) return { ok: false, error: gst.error };

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
          location: data.location?.trim() || null,
          gstin: gst.value,
          geofenceRadius: data.geofenceRadius || 200,
          attendanceMode: data.attendanceMode || 'MANUAL',
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

    // Non-admins don't get the numbering code back (see getStoresDataAction).
    const { code: _code, ...storeWithoutCode } = store;
    return { ok: true, store: session.user.role === 'ADMIN' ? store : storeWithoutCode };
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

/**
 * Edits a Client's business details (location, GSTIN) after creation — these
 * are often not known at signup. Admin, or the Client user for their own account.
 * Pass only the fields being changed; an empty string clears a field.
 */
export async function updateClientDetailsAction(
  clientId: string,
  patch: { location?: string; gstin?: string },
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  if (!can(session, 'store:manage', { clientId })) {
    return { ok: false, error: 'Permission denied to edit this client.' };
  }

  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
  if (!client) return { ok: false, error: 'Client not found.' };

  const data: { location?: string | null; gstin?: string | null } = {};
  if (patch.location !== undefined) data.location = patch.location.trim() || null;
  if (patch.gstin !== undefined) {
    const gst = parseGstin(patch.gstin);
    if (!gst.ok) return { ok: false, error: gst.error };
    data.gstin = gst.value;
  }
  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.client.update({ where: { id: clientId }, data });
  await writeAuditLog({
    userId: session.user.id,
    action: 'CLIENT_DETAILS_UPDATE',
    targetType: 'Client',
    targetId: clientId,
    metadata: { name: client.name, changes: data },
  });
  return { ok: true };
}

/** Edits a Store's address, location and GSTIN after creation. Admin/Client only. */
export async function updateStoreDetailsAction(
  storeId: string,
  patch: { address?: string; location?: string; gstin?: string },
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const store = await prisma.store.findUnique({ where: { id: storeId }, select: { clientId: true, name: true } });
  if (!store) return { ok: false, error: 'Store not found.' };
  if (!can(session, 'store:manage', { clientId: store.clientId })) {
    return { ok: false, error: 'Permission denied to edit this store.' };
  }

  const data: { address?: string | null; location?: string | null; gstin?: string | null } = {};
  if (patch.address !== undefined) data.address = patch.address.trim() || null;
  if (patch.location !== undefined) data.location = patch.location.trim() || null;
  if (patch.gstin !== undefined) {
    const gst = parseGstin(patch.gstin);
    if (!gst.ok) return { ok: false, error: gst.error };
    data.gstin = gst.value;
  }
  if (Object.keys(data).length === 0) return { ok: true };

  await prisma.store.update({ where: { id: storeId }, data });
  await writeAuditLog({
    userId: session.user.id,
    action: 'STORE_DETAILS_UPDATE',
    targetType: 'Store',
    targetId: storeId,
    metadata: { name: store.name, changes: data },
  });
  return { ok: true };
}
