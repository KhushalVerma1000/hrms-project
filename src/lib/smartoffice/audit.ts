import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

interface WriteAuditLogParams {
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}

/**
 * Writes an AuditLog row for every write command, regardless of SmartOffice response.
 * Call this before or after enqueueing a command — not after SmartOffice responds,
 * since the queue is async and the audit trail must exist immediately.
 */
export async function writeAuditLog(params: WriteAuditLogParams): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: (params.metadata ?? {}) as unknown as Prisma.InputJsonObject,
    },
  });
}
