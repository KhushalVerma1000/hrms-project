'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import { generateEmployeeCode, previewEmployeeCode } from '@/lib/ecode';
import { enqueueCommand, deriveIdempotencyKey } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import bcrypt from 'bcryptjs';
import { Designation, EmployeeStatus } from '@prisma/client';
import { generatePrefilledFormUrl, ONBOARDING_FORM_STORE_SELECT } from '@/lib/config';
import { normalizeMobile, whatsAppFormLink } from '@/lib/whatsapp';

export interface OnboardingSubmitInput {
  name: string;
  gender?: string;
  dateOfBirth?: string;
  storeId: string;
  designation: Designation;
  grade?: string;
  team?: string;
  cardNumber?: string;
  /** Candidate's mobile number (any common format; normalised server-side). */
  mobileNumber?: string;

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

  const { code: previewCode, slotsRemaining, nearCapacity } = previewEmployeeCode(store);

  return {
    previewCode,
    clientName: store.client.name,
    storeName: store.name,
    warehouseType: store.warehouseType.name,
    slotsRemaining,
    nearCapacity,
  };
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
  const mobileNumber = normalizeMobile(input.mobileNumber);
  if (!mobileNumber) {
    return { ok: false, error: 'A valid mobile number is required (10 digits, or with country code).' };
  }

  const isAppRoleDesignation =
    input.designation === Designation.PROCESS_ASSOCIATE ||
    input.designation === Designation.SHIFT_INCHARGE ||
    input.designation === Designation.STORE_MANAGER;

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

      // Store + WarehouseType are required for the ADD_EMPLOYEE payload below —
      // SmartOffice identifies the branch/location by name (CompanySName/Location),
      // not by our internal storeId.
      const storeForEmployee = await tx.store.findUniqueOrThrow({
        where: { id: input.storeId },
        include: { warehouseType: true },
      });

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
          mobileNumber,
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
            role:
              input.designation === Designation.STORE_MANAGER
                ? 'MANAGER'
                : input.designation === Designation.PROCESS_ASSOCIATE
                  ? 'PROCESS_ASSOCIATE'
                  : 'SHIFT_INCHARGE',
            clientId: store?.clientId,
            storeId: input.storeId,
            employeeId: employee.id,
            mustChangePassword: true,
          },
        });
      }

      // 4 & 5. Enqueue biometric enrollment commands — MANUAL-mode stores have
      // no device to enroll on and no worker expected to ever process these,
      // so skip enqueueing entirely rather than let stale commands pile up
      // and fire unexpectedly whenever biometric sync is turned on for this
      // store later. Field names below must match SmartOffice's AddEmployee
      // contract exactly (see SmartOfficeAPIDocumentation.pdf) — they
      // intentionally do NOT mirror our internal Prisma field names.
      let addEmpCmd: { id: string } | null = null;
      let uploadCmd: { id: string } | null = null;

      if (storeForEmployee.attendanceMode === 'BIOMETRIC') {
        const addEmpKey = deriveIdempotencyKey('ADD_EMPLOYEE', { employeeId: employee.id });
        addEmpCmd = await enqueueCommand({
          commandType: 'ADD_EMPLOYEE',
          payload: {
            StaffCode: staffCode,
            StaffName: employee.name,
            Gender: employee.gender || undefined,
            Status: 'Working',
            CompanySName: storeForEmployee.warehouseType.name,
            Location: storeForEmployee.name,
            Designation: employee.designation,
            Grade: employee.grade || undefined,
            Team: employee.team || undefined,
            DOJ: employee.dateOfJoining
              ? employee.dateOfJoining.toISOString().split('T')[0]
              : new Date().toISOString().split('T')[0],
            DOB: input.dateOfBirth || undefined,
          },
          idempotencyKey: addEmpKey,
          relatedType: 'Employee',
          relatedId: employee.id,
          createdBy: user.id,
          tx,
        });

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
          // NOTE: TriggerUserOnlineEnrollment requires SerialNumber per SmartOffice's
          // docs, but REMOTE_LINK mode doesn't collect a target device up front
          // (the whole point is the employee enrolls remotely without staff
          // picking a device). If SmartOffice rejects a blank SerialNumber in
          // practice, this needs a product decision — e.g. defaulting to the
          // store's primary device, or collecting one at form-submission time.
          const triggerKey = deriveIdempotencyKey('TRIGGER_ENROLLMENT', { employeeId: employee.id, enrollmentRound: 1 });
          uploadCmd = await enqueueCommand({
            commandType: 'TRIGGER_ENROLLMENT',
            payload: {
              SerialNumber: input.deviceSerialNumber || '',
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

    // Build pre-filled Google Form link — the store's own form if set, else the
    // client's default, else the global GOOGLE_FORM_BASE_URL/FIELD_ID env vars.
    const store = await prisma.store.findUnique({
      where: { id: input.storeId },
      select: ONBOARDING_FORM_STORE_SELECT,
    });
    const googleFormUrl = generatePrefilledFormUrl(result.staffCode, store);
    const whatsappUrl = whatsAppFormLink({
      mobile: mobileNumber,
      name: input.name,
      clientName: store?.client.name,
      formUrl: googleFormUrl,
    });

    return {
      ok: true,
      employeeId: result.employee.id,
      staffCode: result.staffCode,
      googleFormUrl,
      whatsappUrl,
      // null for MANUAL-mode stores — no biometric command was enqueued, so
      // there's nothing for getCommandStatusAction to poll. Callers should
      // treat a null commandId as "onboarding complete, no sync needed"
      // rather than an error or a stuck sync.
      commandId: result.addEmpCmd?.id ?? null,
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
