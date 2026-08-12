'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { EmployeeStatus } from '@prisma/client';
import { subDays } from 'date-fns';

export interface EmployeeFilterOpts {
  storeId?: string;
  status?: EmployeeStatus;
  designation?: string;
  search?: string;
  isLegacy?: boolean;
}

export async function getEmployeesAction(opts: EmployeeFilterOpts = {}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;

  // Build Prisma query filter based on role scope
  const where: any = {};

  if (user.role === 'CLIENT' && user.clientId) {
    where.store = { clientId: user.clientId };
  } else if ((user.role === 'MANAGER' || user.role === 'PROCESS_ASSOCIATE' || user.role === 'SHIFT_INCHARGE') && user.storeId) {
    where.storeId = user.storeId;
  }

  if (opts.storeId && user.role === 'ADMIN') {
    where.storeId = opts.storeId;
  }

  if (opts.status) {
    where.status = opts.status;
  }

  if (opts.designation) {
    where.designation = opts.designation;
  }

  if (opts.isLegacy !== undefined) {
    where.isLegacyCode = opts.isLegacy;
  }

  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim();
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { staffCode: { contains: q, mode: 'insensitive' } },
      { cardNumber: { contains: q, mode: 'insensitive' } },
    ];
  }

  return prisma.employee.findMany({
    where,
    include: {
      store: {
        include: {
          client: true,
          warehouseType: true,
        },
      },
      linkedUser: {
        select: { id: true, email: true, role: true },
      },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateEmployeeAction(
  employeeId: string,
  data: {
    name?: string;
    gender?: string;
    cardNumber?: string;
    grade?: string;
    team?: string;
  },
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { ok: false, error: 'Employee not found' };

  if (!can(session, 'employee:create', { storeId: employee.storeId })) {
    return { ok: false, error: 'Permission denied to edit this employee.' };
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: {
      name: data.name?.trim(),
      gender: data.gender,
      cardNumber: data.cardNumber?.trim() || null,
      grade: data.grade?.trim() || null,
      team: data.team?.trim() || null,
    },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'EMPLOYEE_UPDATE',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: { staffCode: employee.staffCode, changes: data },
  });

  return { ok: true, employee: updated };
}

export async function softDeleteEmployeeAction(employeeId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { ok: false, error: 'Employee not found' };

  if (!can(session, 'employee:softDelete', { storeId: employee.storeId })) {
    return { ok: false, error: 'Permission denied to deactivate this employee.' };
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: { status: EmployeeStatus.OFFBOARDED },
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'EMPLOYEE_SOFT_DELETE',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: { staffCode: employee.staffCode },
  });

  return { ok: true, employee: updated };
}

/**
 * HARD DELETE EMPLOYEE — WITH 30-DAY ATTENDANCE GUARD (Section 2 of Spec)
 *
 * Rules:
 * - Admin & Client: can hard-delete regardless of attendance history.
 * - Manager: can hard-delete ONLY IF no attendance record in the last 30 days
 *   (MAX(AttendanceLog.logDate) is null or older than 30 days).
 * - Process Associate / Shift Incharge: NEVER allowed.
 */
export async function hardDeleteEmployeeAction(employeeId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { store: true, linkedUser: true },
  });
  if (!employee) return { ok: false, error: 'Employee not found' };

  // 1. Permission check
  if (!can(session, 'employee:hardDelete', { storeId: employee.storeId, clientId: employee.store.clientId })) {
    return { ok: false, error: 'Permission denied to hard-delete employees.' };
  }

  // 2. 30-Day Attendance Lookback Guard (critical business rule for Manager role)
  if (user.role === 'MANAGER') {
    const thirtyDaysAgo = subDays(new Date(), 30);

    const latestPunch = await prisma.attendanceLog.findFirst({
      where: { employeeCode: employee.staffCode },
      orderBy: { logDate: 'desc' },
      select: { logDate: true },
    });

    if (latestPunch && latestPunch.logDate >= thirtyDaysAgo) {
      return {
        ok: false,
        error: `This employee has attendance recorded within the last 30 days (${latestPunch.logDate.toLocaleDateString()}). Only Admin or Client users can remove them.`,
      };
    }
  }

  // 3. Execute delete transaction & enqueue SmartOffice commands
  try {
    await prisma.$transaction(async (tx) => {
      // Enqueue DELETE_USER / DELETE_EMPLOYEE command first
      const delUserKey = deriveIdempotencyKey('DELETE_USER', { employeeId: employee.id });
      await enqueueCommand({
        commandType: 'DELETE_USER',
        payload: { EmployeeCode: employee.staffCode },
        idempotencyKey: delUserKey,
        relatedType: 'Employee',
        relatedId: employee.id,
        createdBy: user.id,
        tx,
      });

      // If linked user account exists, delete linked user row
      if (employee.linkedUser) {
        await tx.user.delete({ where: { id: employee.linkedUser.id } });
      }

      // Hard delete the employee row
      await tx.employee.delete({ where: { id: employeeId } });
    });

    // Write audit log
    await writeAuditLog({
      userId: user.id,
      action: 'EMPLOYEE_HARD_DELETE',
      targetType: 'Employee',
      targetId: employeeId,
      metadata: { staffCode: employee.staffCode, name: employee.name, storeId: employee.storeId },
    });

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to hard-delete employee.' };
  }
}
