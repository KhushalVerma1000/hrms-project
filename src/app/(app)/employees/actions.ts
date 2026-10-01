'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { EmployeeStatus } from '@prisma/client';
import { subDays } from 'date-fns';
import { normalizeMobile } from '@/lib/whatsapp';

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

export interface EmployeePageOpts {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: EmployeeStatus;
  designation?: string;
  clientId?: string;
  storeId?: string;
  formStatus?: 'NOT_SENT' | 'PENDING' | 'SUBMITTED';
}

const PAGE_SIZES = [10, 25, 50, 100];

/**
 * Server-side paginated + filtered employee list for the directory, plus the
 * client/store options the current user may filter by. Role scope is always
 * enforced here; the filters can only narrow it further.
 */
export async function getEmployeesPageAction(opts: EmployeePageOpts = {}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');
  const user = session.user;

  const pageSize = PAGE_SIZES.includes(opts.pageSize ?? 0) ? opts.pageSize! : 25;

  // Role scope — never widened by the filters below.
  const scope: any = {};
  if (user.role === 'CLIENT' && user.clientId) {
    scope.store = { clientId: user.clientId };
  } else if (
    (user.role === 'MANAGER' || user.role === 'PROCESS_ASSOCIATE' || user.role === 'SHIFT_INCHARGE') &&
    user.storeId
  ) {
    scope.storeId = user.storeId;
  }

  const and: any[] = [scope];
  if (opts.clientId && user.role === 'ADMIN') and.push({ store: { clientId: opts.clientId } });
  if (opts.storeId) and.push({ storeId: opts.storeId });
  if (opts.status) and.push({ status: opts.status });
  if (opts.designation) and.push({ designation: opts.designation });
  if (opts.formStatus) and.push({ onboardingFormStatus: opts.formStatus });

  const q = opts.search?.trim();
  if (q) {
    const digits = q.replace(/\D/g, '');
    and.push({
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { staffCode: { contains: q, mode: 'insensitive' } },
        { cardNumber: { contains: q, mode: 'insensitive' } },
        ...(digits.length >= 4 ? [{ mobileNumber: { contains: digits } }] : []),
      ],
    });
  }
  const where = { AND: and };

  const total = await prisma.employee.count({ where });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), totalPages);

  const rows = await prisma.employee.findMany({
    where,
    select: {
      id: true,
      staffCode: true,
      isLegacyCode: true,
      name: true,
      gender: true,
      status: true,
      designation: true,
      grade: true,
      team: true,
      cardNumber: true,
      mobileNumber: true,
      onboardingFormStatus: true,
      createdAt: true,
      storeId: true,
      store: {
        select: {
          name: true,
          clientId: true,
          client: { select: { shortName: true, name: true } },
          warehouseType: { select: { name: true } },
        },
      },
      linkedUser: { select: { id: true, email: true, role: true } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });

  // Contact numbers are only shown to people who may edit that employee.
  const employees = rows.map((r) => {
    const canEdit = can(session, 'employee:edit', { storeId: r.storeId, clientId: r.store.clientId });
    return { ...r, mobileNumber: canEdit ? r.mobileNumber : null, canEdit };
  });

  // Filter options (scoped to what this user can see).
  const storeWhere: any = {};
  if (user.role === 'CLIENT' && user.clientId) storeWhere.clientId = user.clientId;
  else if (scope.storeId) storeWhere.id = scope.storeId;
  const stores = await prisma.store.findMany({
    where: storeWhere,
    select: { id: true, name: true, clientId: true, client: { select: { shortName: true } } },
    orderBy: { name: 'asc' },
  });
  const clients =
    user.role === 'ADMIN'
      ? await prisma.client.findMany({ select: { id: true, name: true, shortName: true }, orderBy: { name: 'asc' } })
      : [];

  return { employees, total, page, pageSize, totalPages, stores, clients };
}

/**
 * Sets or clears one employee's mobile number (used by the directory and the
 * pending-forms screen). Empty string clears it.
 */
export async function updateEmployeeMobileAction(employeeId: string, mobile: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { staffCode: true, storeId: true, store: { select: { clientId: true } } },
  });
  if (!employee) return { ok: false, error: 'Employee not found' };

  const ctx = { storeId: employee.storeId, clientId: employee.store.clientId };
  if (!can(session, 'employee:edit', ctx) && !can(session, 'formTracking:remind', ctx)) {
    return { ok: false, error: 'Permission denied to edit this employee.' };
  }

  const normalized = mobile.trim() ? normalizeMobile(mobile) : null;
  if (mobile.trim() && !normalized) {
    return { ok: false, error: 'Enter a valid mobile number (10 digits, or with country code).' };
  }

  await prisma.employee.update({ where: { id: employeeId }, data: { mobileNumber: normalized } });
  await writeAuditLog({
    userId: session.user.id,
    action: 'EMPLOYEE_UPDATE',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: { staffCode: employee.staffCode, changes: { mobileNumber: normalized ? 'updated' : 'cleared' } },
  });
  return { ok: true, mobileNumber: normalized };
}

export async function updateEmployeeAction(
  employeeId: string,
  data: {
    name?: string;
    gender?: string;
    cardNumber?: string;
    grade?: string;
    team?: string;
    mobileNumber?: string;
  },
) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return { ok: false, error: 'Employee not found' };

  if (!can(session, 'employee:create', { storeId: employee.storeId })) {
    return { ok: false, error: 'Permission denied to edit this employee.' };
  }

  // undefined = leave unchanged; '' = clear; otherwise must be a valid number.
  let mobileNumber: string | null | undefined;
  if (data.mobileNumber !== undefined) {
    mobileNumber = data.mobileNumber.trim() ? normalizeMobile(data.mobileNumber) : null;
    if (data.mobileNumber.trim() && !mobileNumber) {
      return { ok: false, error: 'Enter a valid mobile number (10 digits, or with country code).' };
    }
  }

  const updated = await prisma.employee.update({
    where: { id: employeeId },
    data: {
      ...(mobileNumber !== undefined ? { mobileNumber } : {}),
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
    // Mobile numbers are personal data — record that it changed, not the value.
    metadata: {
      staffCode: employee.staffCode,
      changes: { ...data, ...(data.mobileNumber !== undefined ? { mobileNumber: 'updated' } : {}) },
    },
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
      // Skip entirely for MANUAL-mode stores — there's no device to
      // un-enroll from and no SmartOffice employee record to remove, so
      // enqueueing here would just leave permanently-unprocessable commands
      // sitting in the queue. (DELETE_USER already self-gated via
      // serialNumberList being empty; DELETE_EMPLOYEE did not — gate both
      // explicitly and consistently on the store's actual mode.)
      if (employee.store.attendanceMode === 'BIOMETRIC') {
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
      }

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
