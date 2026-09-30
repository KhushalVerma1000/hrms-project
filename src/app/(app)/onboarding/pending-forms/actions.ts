'use server';

import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { generatePrefilledFormUrl, ONBOARDING_FORM_STORE_SELECT } from '@/lib/config';
import { whatsAppFormLink } from '@/lib/whatsapp';
import { writeAuditLog } from '@/lib/smartoffice/audit';

/**
 * Marks a form as sent (NOT_SENT → PENDING) and logs the action.
 * Returns the prefilled form URL for sharing.
 */
export async function markFormSent(employeeId: string): Promise<{ ok: boolean; formLink?: string; whatsappUrl?: string }> {
  const session = await requireAuth('formTracking:remind');

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      staffCode: true,
      storeId: true,
      mobileNumber: true,
      name: true,
      store: { select: ONBOARDING_FORM_STORE_SELECT },
    },
  });

  if (!employee) return { ok: false };

  // Scope check: Manager/SI can only send for their own store
  if (
    (session.user.role === 'MANAGER' || session.user.role === 'SHIFT_INCHARGE') &&
    employee.storeId !== session.user.storeId
  ) {
    return { ok: false };
  }

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      onboardingFormStatus: 'PENDING',
      onboardingFormSentAt: new Date(),
    },
  });

  const formLink = generatePrefilledFormUrl(employee.staffCode, employee.store);
  const whatsappUrl = whatsAppFormLink({
    mobile: employee.mobileNumber,
    name: employee.name,
    clientName: employee.store.client.name,
    formUrl: formLink,
  });
  return { ok: true, formLink, whatsappUrl };
}

/**
 * Logs a reminder action and returns the form link for the Manager to share.
 * Does NOT auto-send an SMS/WhatsApp — that's a v2 feature.
 * See Section 13.4 of the spec.
 */
export async function sendFormReminder(
  employeeId: string,
): Promise<{ ok: boolean; formLink?: string; whatsappUrl?: string }> {
  const session = await requireAuth('formTracking:remind');

  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      staffCode: true,
      storeId: true,
      mobileNumber: true,
      name: true,
      store: { select: ONBOARDING_FORM_STORE_SELECT },
    },
  });

  if (!employee) return { ok: false };

  // Scope check
  if (
    (session.user.role === 'MANAGER' || session.user.role === 'SHIFT_INCHARGE') &&
    employee.storeId !== session.user.storeId
  ) {
    return { ok: false };
  }

  // Update reminder timestamp
  await prisma.employee.update({
    where: { id: employeeId },
    data: { onboardingFormLastRemindedAt: new Date() },
  });

  // Write audit log so there's a record of follow-up activity
  await writeAuditLog({
    userId: session.user.id,
    action: 'FORM_REMINDER_SENT',
    targetType: 'Employee',
    targetId: employeeId,
    metadata: {
      employeeName: employee.name,
      staffCode: employee.staffCode,
      method: 'manual_link',
    },
  });

  const formLink = generatePrefilledFormUrl(employee.staffCode, employee.store);
  const whatsappUrl = whatsAppFormLink({
    mobile: employee.mobileNumber,
    name: employee.name,
    clientName: employee.store.client.name,
    formUrl: formLink,
  });
  return { ok: true, formLink, whatsappUrl };
}
