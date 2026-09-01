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

  // Soft-delete previously only flipped the local status — the employee stayed
  // fully live and able to punch on the physical device. Block them on every
  // device at their store so the app-side status and the device's actual state
  // agree. (Only a subset of device models support this command; commands for
  // unsupported models will fail terminally and surface on the Sync Issues
  // screen rather than silently succeeding.)
  const storeDevices = await prisma.device.findMany({
    where: { storeId: employee.storeId },
    select: { id: true, serialNumber: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.OFFBOARDED },
    });

    for (const device of storeDevices) {
      const blockKey = deriveIdempotencyKey('BLOCK_USER', {
        targetId: `${employee.id}:${device.id}`,
        payload: { BlockUser: 0 },
      });
      await enqueueCommand({
        commandType: 'BLOCK_USER',
        payload: { EmployeeCode: employee.staffCode, SerialNumber: device.serialNumber, BlockUser: 0 },
        idempotencyKey: blockKey,
        relatedType: 'Employee',
        relatedId: employee.id,
        createdBy: session.user.id,
        tx,
      });
    }

    return emp;
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'EMPLOYEE_SOFT_DELETE',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: { staffCode: employee.staffCode, devicesBlocked: storeDevices.length },
  });

  return { ok: true, employee: updated };
}

/**
 * Reactivates a previously soft-deleted (OFFBOARDED) employee: restores
 * ACTIVE status locally and unblocks them on every device at their store.
 * Uses the same permission scope as softDeleteEmployeeAction.
 */
export async function reactivateEmployeeAction(employeeId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { ok: false, error: 'Employee not found' };

  if (!can(session, 'employee:softDelete', { storeId: employee.storeId })) {
    return { ok: false, error: 'Permission denied to reactivate this employee.' };
  }

  if (employee.status === EmployeeStatus.ACTIVE) {
    return { ok: false, error: 'Employee is already active.' };
  }

  const storeDevices = await prisma.device.findMany({
    where: { storeId: employee.storeId },
    select: { id: true, serialNumber: true },
  });

  const updated = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.update({
      where: { id: employeeId },
      data: { status: EmployeeStatus.ACTIVE },
    });

    for (const device of storeDevices) {
      const unblockKey = deriveIdempotencyKey('UNBLOCK_USER', {
        targetId: `${employee.id}:${device.id}`,
        payload: { BlockUser: 1 },
      });
      await enqueueCommand({
        commandType: 'UNBLOCK_USER',
        payload: { EmployeeCode: employee.staffCode, SerialNumber: device.serialNumber, BlockUser: 1 },
        idempotencyKey: unblockKey,
        relatedType: 'Employee',
        relatedId: employee.id,
        createdBy: session.user.id,
        tx,
      });
    }

    return emp;
  });

  await writeAuditLog({
    userId: session.user.id,
    action: 'EMPLOYEE_REACTIVATE',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: { staffCode: employee.staffCode, devicesUnblocked: storeDevices.length },
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
    const storeDevices = await prisma.device.findMany({
      where: { storeId: employee.storeId },
      select: { serialNumber: true },
    });
    // DeleteUser accepts a comma-separated SerialNumber list to remove the
    // user from every device at this store in one command.
    const serialNumberList = storeDevices.map((d) => d.serialNumber).join(',');

    await prisma.$transaction(async (tx) => {
      // Enqueue DELETE_USER (un-enrolls from the physical device(s))...
      if (serialNumberList) {
        const delUserKey = deriveIdempotencyKey('DELETE_USER', { employeeId: employee.id });
        await enqueueCommand({
          commandType: 'DELETE_USER',
          payload: { EmployeeCode: employee.staffCode, SerialNumber: serialNumberList },
          idempotencyKey: delUserKey,
          relatedType: 'Employee',
          relatedId: employee.id,
          createdBy: user.id,
          tx,
        });
      }

      // ...and DELETE_EMPLOYEE (removes the employee record from SmartOffice itself).
      const delEmpKey = deriveIdempotencyKey('DELETE_EMPLOYEE', { employeeId: employee.id });
      await enqueueCommand({
        commandType: 'DELETE_EMPLOYEE',
        payload: { EmployeeCode: employee.staffCode },
        idempotencyKey: delEmpKey,
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
