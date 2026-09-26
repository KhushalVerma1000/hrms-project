'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { writeAuditLog } from '@/lib/smartoffice/audit';

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

export async function changePasswordAction(data: { currentPassword: string; newPassword: string }) {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, error: 'Unauthorized' };
  }

  const parsed = changePasswordSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message || 'Invalid input.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, passwordHash: true },
  });
  if (!user) {
    return { ok: false, error: 'Account not found.' };
  }

  const currentValid = await bcrypt.compare(parsed.data.currentPassword, user.passwordHash);
  if (!currentValid) {
    return { ok: false, error: 'Current password is incorrect.' };
  }

  const samePassword = await bcrypt.compare(parsed.data.newPassword, user.passwordHash);
  if (samePassword) {
    return { ok: false, error: 'New password must be different from your current password.' };
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 10);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, mustChangePassword: false },
  });

  await writeAuditLog({
    userId: user.id,
    action: 'PASSWORD_CHANGE',
    targetType: 'User',
    targetId: user.id,
  });

  return { ok: true };
}
