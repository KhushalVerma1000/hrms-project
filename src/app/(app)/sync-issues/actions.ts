'use server';

import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';
import { retryCommand } from '@/lib/queue/commands';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { CommandStatus } from '@prisma/client';

export async function getCommandsAction(statusFilter?: CommandStatus) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const where: any = {};
  if (statusFilter) {
    where.status = statusFilter;
  }

  return prisma.smartOfficeCommand.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function retryFailedCommandAction(commandId: string) {
  const session = await auth();
  if (!session?.user) throw new Error('Unauthorized');

  const user = session.user;
  if (user.role !== 'ADMIN' && user.role !== 'CLIENT') {
    return { ok: false, error: 'Only Admin or Client users can manually retry commands.' };
  }

  try {
    const updated = await retryCommand(commandId);

    await writeAuditLog({
      userId: user.id,
      action: 'COMMAND_RETRY',
      targetType: 'Command',
      targetId: commandId,
      metadata: { idempotencyKey: updated.idempotencyKey, commandType: updated.commandType },
    });

    return { ok: true, command: updated };
  } catch (err: any) {
    return { ok: false, error: err.message || 'Failed to reset command for retry.' };
  }
}
