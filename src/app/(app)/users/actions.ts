'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { can } from '@/lib/auth/can';
import bcrypt from 'bcryptjs';
import { Role } from '@prisma/client';
import { writeAuditLog } from '@/lib/smartoffice/audit';

export async function getUsersAction() {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;
  const where: any = {};

  if (user.role === 'CLIENT' && user.clientId) {
    where.clientId = user.clientId;
  } else if (user.storeId && (user.role === 'MANAGER' || user.role === 'PROCESS_ASSOCIATE' || user.role === 'SHIFT_INCHARGE')) {
    where.storeId = user.storeId;
  }

  return prisma.user.findMany({
    where,
    include: {
      client: true,
      store: {
        include: { warehouseType: true },
      },
      employee: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function createUserAction(data: {
  email: string;
  name: string;
  role: Role;
  clientId?: string;
  storeId?: string;
  password?: string;
}) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const currentUser = session.user;

  // Role hierarchy permission enforcement
  if (currentUser.role === 'CLIENT') {
    if (data.role !== 'MANAGER') {
      return { ok: false, error: 'Client users can only create Store Manager accounts.' };
    }
    data.clientId = currentUser.clientId ?? undefined;
  } else if (currentUser.role === 'MANAGER') {
    if (data.role !== 'PROCESS_ASSOCIATE' && data.role !== 'SHIFT_INCHARGE') {
      return { ok: false, error: 'Managers can only create Process Associate or Shift Incharge accounts.' };
    }
    data.storeId = currentUser.storeId ?? undefined;
  } else if (currentUser.role !== 'ADMIN') {
    return { ok: false, error: 'Permission denied to create user accounts.' };
  }

  if (!data.email.trim() || !data.email.includes('@')) {
    return { ok: false, error: 'Valid email is required.' };
  }

  const existing = await prisma.user.findUnique({ where: { email: data.email.trim() } });
  if (existing) {
    return { ok: false, error: 'A user account with this email already exists.' };
  }

  const rawPassword = data.password?.trim() || Math.random().toString(36).slice(-8) + 'A1!';
  const passwordHash = await bcrypt.hash(rawPassword, 10);

  try {
    const newUser = await prisma.user.create({
      data: {
        email: data.email.trim(),
        name: data.name.trim(),
        role: data.role,
        passwordHash,
        clientId: data.clientId || null,
        storeId: data.storeId || null,
        mustChangePassword: true,
      },
    });

    await writeAuditLog({
      userId: currentUser.id,
      action: 'USER_CREATE',
      targetType: 'User',
      targetId: newUser.id,
      metadata: { email: newUser.email, role: newUser.role },
    });

    return { ok: true, user: newUser, tempPassword: rawPassword };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to create user account.' };
  }
}
