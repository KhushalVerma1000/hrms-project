'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { generateEmployeeCode } from '@/lib/ecode';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import bcrypt from 'bcryptjs';
import { Designation, EmployeeStatus } from '@prisma/client';
import { GOOGLE_FORM_BASE_URL, GOOGLE_FORM_ECODE_FIELD_ID } from '@/lib/config';

export interface OnboardingSubmitInput {
  name: string;
  gender?: string;
  dateOfBirth?: string;
  storeId: string;
  designation: Designation;
  grade?: string;
  team?: string;
  cardNumber?: string;

  // App login fields (only for PROCESS_ASSOCIATE and SHIFT_INCHARGE)
  createAppLogin?: boolean;
  email?: string;
  password?: string;

  // Enrollment mode
  enrollmentMode: 'DIRECT_UPLOAD' | 'REMOTE_LINK';
  deviceSerialNumber?: string;
}

export async function getStoresForOnboardingAction() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;
  if (!can(session, 'employee:create', { storeId: user.storeId ?? undefined, clientId: user.clientId ?? undefined })) {
    throw new Error('Permission denied');
  }

  if (user.role === 'ADMIN') {
    return prisma.store.findMany({
      include: { client: true, warehouseType: true },
      orderBy: { name: 'asc' },
    });
  }

  if (user.role === 'CLIENT' && user.clientId) {
    return prisma.store.findMany({
      where: { clientId: user.clientId },
      include: { client: true, warehouseType: true },
      orderBy: { name: 'asc' },
    });
  }

  if (user.storeId) {
    return prisma.store.findMany({
      where: { id: user.storeId },
      include: { client: true, warehouseType: true },
    });
  }

  return [];
}

export async function getStoreECodePreviewAction(storeId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    include: { client: true, warehouseType: true },
  });

  if (!store) throw new Error('Store not found');

  const serialPadded = String(store.nextEmployeeSerial).padStart(4, '0');
  const previewCode = `${store.client.code}${store.warehouseType.code}${store.code}${serialPadded}`;

  return { previewCode, clientName: store.client.name, storeName: store.name, warehouseType: store.warehouseType.name };
}

export async function submitOnboardingAction(input: OnboardingSubmitInput) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;

  // Permission check
  if (!can(session, 'employee:create', { storeId: input.storeId, clientId: user.clientId ?? undefined })) {
    return { ok: false, error: 'You do not have permission to add employees for this store.' };
  }

  // Input validation
  if (!input.name.trim()) return { ok: false, error: 'Employee name is required.' };
  if (!input.storeId) return { ok: false, error: 'Store selection is required.' };

  const isAppRoleDesignation =
    input.designation === Designation.PROCESS_ASSOCIATE ||
    input.designation === Designation.SHIFT_INCHARGE;

  if (isAppRoleDesignation && input.createAppLogin) {
    if (!input.email || !input.email.includes('@')) {
      return { ok: false, error: 'Valid email is required to create an app login.' };
    }
    const existingUser = await prisma.user.findUnique({ where: { email: input.email } });
    if (existingUser) {
      return { ok: false, error: 'A user with this email already exists.' };
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Generate atomic E-Code
      const staffCode = await generateEmployeeCode(tx, input.storeId);

      // 2. Create Employee
      const employee = await tx.employee.create({
        data: {
          staffCode,
          name: input.name.trim(),
          gender: input.gender,
          dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          storeId: input.storeId,
          designation: input.designation,
          grade: input.grade,
          team: input.team,
          cardNumber: input.cardNumber,
          status: EmployeeStatus.ACTIVE,
          onboardingStep: 'COMPLETED',
        },
      });

      // 3. Create linked User if designation grants app access and login requested
      let createdUser = null;
      if (isAppRoleDesignation && input.createAppLogin && input.email) {
        const rawPassword = input.password || Math.random().toString(36).slice(-8) + 'A1!';
        const passwordHash = await bcrypt.hash(rawPassword, 10);

        const store = await tx.store.findUnique({ where: { id: input.storeId } });

        createdUser = await tx.user.create({
          data: {
            email: input.email.trim(),
            passwordHash,
            name: input.name.trim(),
            role: input.designation === Designation.PROCESS_ASSOCIATE ? 'PROCESS_ASSOCIATE' : 'SHIFT_INCHARGE',
            clientId: store?.clientId,
            storeId: input.storeId,
            employeeId: employee.id,
            mustChangePassword: true,
          },
        });
      }

      // 4. Enqueue ADD_EMPLOYEE command
      const addEmpKey = deriveIdempotencyKey('ADD_EMPLOYEE', { employeeId: employee.id });
      const addEmpCmd = await enqueueCommand({
        commandType: 'ADD_EMPLOYEE',
        payload: {
          EmployeeCode: staffCode,
          EmployeeName: employee.name,
          Gender: employee.gender || '',
          DOB: input.dateOfBirth || '',
          Designation: employee.designation,
          CardNumber: employee.cardNumber || '',
        },
        idempotencyKey: addEmpKey,
        relatedType: 'Employee',
        relatedId: employee.id,
        createdBy: user.id,
        tx,
      });

      // 5. Enqueue UPLOAD_USER or TRIGGER_ENROLLMENT command
      let uploadCmd = null;
      if (input.enrollmentMode === 'DIRECT_UPLOAD') {
        const uploadKey = deriveIdempotencyKey('UPLOAD_USER', { employeeId: employee.id });
        uploadCmd = await enqueueCommand({
          commandType: 'UPLOAD_USER',
          payload: {
            EmployeeCode: staffCode,
            EmployeeName: employee.name,
            SerialNumber: input.deviceSerialNumber || '',
            CardNumber: employee.cardNumber || '',
          },
          idempotencyKey: uploadKey,
          relatedType: 'Employee',
          relatedId: employee.id,
          createdBy: user.id,
          tx,
        });
      } else {
        const triggerKey = deriveIdempotencyKey('TRIGGER_ENROLLMENT', { employeeId: employee.id, enrollmentRound: 1 });
        uploadCmd = await enqueueCommand({
          commandType: 'TRIGGER_ENROLLMENT',
          payload: {
            EmployeeCode: staffCode,
            EmployeeName: employee.name,
          },
          idempotencyKey: triggerKey,
          relatedType: 'Employee',
          relatedId: employee.id,
          createdBy: user.id,
          tx,
        });
      }

      return { employee, createdUser, addEmpCmd, uploadCmd, staffCode };
    });

    // Write audit log
    await writeAuditLog({
      userId: user.id,
      action: 'EMPLOYEE_ONBOARD',
      targetType: 'Employee',
      targetId: result.employee.id,
      metadata: { staffCode: result.staffCode, designation: input.designation, storeId: input.storeId },
    });

    // Build pre-filled Google Form link
    let googleFormUrl = GOOGLE_FORM_BASE_URL;
    if (GOOGLE_FORM_ECODE_FIELD_ID && GOOGLE_FORM_BASE_URL) {
      const sep = GOOGLE_FORM_BASE_URL.includes('?') ? '&' : '?';
      googleFormUrl = `${GOOGLE_FORM_BASE_URL}${sep}${GOOGLE_FORM_ECODE_FIELD_ID}=${encodeURIComponent(result.staffCode)}`;
    }

    return {
      ok: true,
      employeeId: result.employee.id,
      staffCode: result.staffCode,
      googleFormUrl,
      commandId: result.addEmpCmd.id,
    };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to complete onboarding transaction.' };
  }
}

export async function getCommandStatusAction(commandId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const cmd = await prisma.smartOfficeCommand.findUnique({
    where: { id: commandId },
  });

  if (!cmd) return null;
  return {
    id: cmd.id,
    status: cmd.status,
    attempts: cmd.attempts,
    lastError: cmd.lastError,
    resolvedAt: cmd.resolvedAt,
  };
}
