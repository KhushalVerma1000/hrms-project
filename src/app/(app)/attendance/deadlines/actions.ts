'use server';

/**
 * Admin-only: deadline policy (client default / store override) and
 * late-upload-access request approval. See spec §4 and §6.
 */

import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';

// ─── Deadline policy ────────────────────────────────────────────────────

export async function listStoresForClient(clientId: string) {
  await requireAuth('attendance:deadlinePolicy:manage');
  return prisma.store.findMany({
    where: { clientId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}

export async function getDeadlinePolicyForClient(clientId: string) {
  await requireAuth('attendance:deadlinePolicy:manage');

  const [clientDefault, storeOverrides] = await Promise.all([
    prisma.attendanceDeadlinePolicy.findUnique({ where: { clientId } }),
    prisma.attendanceDeadlinePolicy.findMany({
      where: { storeId: { not: null }, store: { clientId } },
      include: { store: { select: { id: true, name: true } } },
    }),
  ]);

  return { clientDefault, storeOverrides };
}

export async function setClientDeadlineDefault(
  clientId: string,
  deadlineDay: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAuth('attendance:deadlinePolicy:manage');

  if (!Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > 28) {
    return { ok: false, error: 'Deadline day must be an integer between 1 and 28 (to stay valid across every month).' };
  }

  await prisma.attendanceDeadlinePolicy.upsert({
    where: { clientId },
    create: { scope: 'CLIENT', clientId, deadlineDay, createdByUserId: session.user.id },
    update: { deadlineDay },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_DEADLINE_CLIENT_DEFAULT_SET',
    targetType: 'Client',
    targetId: clientId,
    metadata: { deadlineDay },
  });

  return { ok: true };
}

export async function setStoreDeadlineOverride(
  storeId: string,
  deadlineDay: number,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAuth('attendance:deadlinePolicy:manage');

  if (!Number.isInteger(deadlineDay) || deadlineDay < 1 || deadlineDay > 28) {
    return { ok: false, error: 'Deadline day must be an integer between 1 and 28 (to stay valid across every month).' };
  }

  await prisma.attendanceDeadlinePolicy.upsert({
    where: { storeId },
    create: { scope: 'STORE', storeId, deadlineDay, createdByUserId: session.user.id },
    update: { deadlineDay },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_DEADLINE_STORE_OVERRIDE_SET',
    targetType: 'Store',
    targetId: storeId,
    metadata: { deadlineDay },
  });

  return { ok: true };
}

export async function clearStoreDeadlineOverride(storeId: string): Promise<{ ok: boolean }> {
  const session = await requireAuth('attendance:deadlinePolicy:manage');

  await prisma.attendanceDeadlinePolicy.deleteMany({ where: { storeId } });

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_DEADLINE_STORE_OVERRIDE_CLEARED',
    targetType: 'Store',
    targetId: storeId,
  });

  return { ok: true };
}

// ─── Late-access request approval ──────────────────────────────────────

export async function listPendingLateAccessRequests() {
  await requireAuth('attendance:lateAccess:approve');

  return prisma.lateUploadRequest.findMany({
    where: { status: 'PENDING' },
    include: {
      period: { include: { store: { select: { id: true, name: true, clientId: true } } } },
      requestedByUser: { select: { id: true, name: true, email: true } },
    },
    orderBy: { requestedAt: 'asc' },
  });
}

export async function approveLateAccess(
  requestId: string,
  grantedUntil: Date,
  adminNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAuth('attendance:lateAccess:approve');

  const request = await prisma.lateUploadRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: 'Request not found.' };
  if (request.status !== 'PENDING') return { ok: false, error: 'This request has already been resolved.' };
  if (grantedUntil <= new Date()) return { ok: false, error: 'Grant window must be in the future.' };

  await prisma.$transaction([
    prisma.lateUploadRequest.update({
      where: { id: requestId },
      data: { status: 'APPROVED', resolvedByUserId: session.user.id, resolvedAt: new Date(), grantedUntil, adminNote },
    }),
    prisma.attendancePeriod.update({
      where: { id: request.periodId },
      data: { status: 'LATE_GRANTED' },
    }),
  ]);

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_LATE_ACCESS_APPROVED',
    targetType: 'AttendancePeriod',
    targetId: request.periodId,
    metadata: { requestId, grantedUntil: grantedUntil.toISOString(), adminNote },
  });

  return { ok: true };
}

export async function denyLateAccess(
  requestId: string,
  adminNote?: string,
): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAuth('attendance:lateAccess:approve');

  const request = await prisma.lateUploadRequest.findUnique({ where: { id: requestId } });
  if (!request) return { ok: false, error: 'Request not found.' };
  if (request.status !== 'PENDING') return { ok: false, error: 'This request has already been resolved.' };

  await prisma.$transaction([
    prisma.lateUploadRequest.update({
      where: { id: requestId },
      data: { status: 'DENIED', resolvedByUserId: session.user.id, resolvedAt: new Date(), adminNote },
    }),
    prisma.attendancePeriod.update({
      where: { id: request.periodId },
      data: { status: 'LATE_DENIED' },
    }),
  ]);

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_LATE_ACCESS_DENIED',
    targetType: 'AttendancePeriod',
    targetId: request.periodId,
    metadata: { requestId, adminNote },
  });

  return { ok: true };
}

// ─── OT reconciliation (spec §5.4) ──────────────────────────────────────

export async function listOvertimeDiscrepancies(storeId?: string) {
  await requireAuth('attendance:lateAccess:approve'); // Admin-only, same gate as other reconciliation actions

  return prisma.employeeMonthlyOvertime.findMany({
    where: { hasDiscrepancy: true, ...(storeId ? { period: { storeId } } : {}) },
    include: {
      employee: { select: { id: true, name: true, staffCode: true, storeId: true } },
      period: { select: { id: true, periodYear: true, periodMonth: true, storeId: true } },
    },
  });
}

export async function clearOvertimeDiscrepancy(
  employeeMonthlyOvertimeId: string,
): Promise<{ ok: boolean }> {
  const session = await requireAuth('attendance:lateAccess:approve');

  await prisma.employeeMonthlyOvertime.update({
    where: { id: employeeMonthlyOvertimeId },
    data: { hasDiscrepancy: false },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_OT_DISCREPANCY_CLEARED',
    targetType: 'EmployeeMonthlyOvertime',
    targetId: employeeMonthlyOvertimeId,
  });

  return { ok: true };
}
