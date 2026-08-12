import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/sync/status
 * Returns current sync status for the React Query polling badge.
 */
export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [pendingCommands, failedCommands, lastDevice] = await Promise.all([
    prisma.smartOfficeCommand.count({ where: { status: 'PENDING' } }),
    prisma.smartOfficeCommand.count({ where: { status: 'FAILED' } }),
    prisma.device.findFirst({
      where: { lastPing: { not: null } },
      orderBy: { lastPing: 'desc' },
      select: { lastPing: true },
    }),
  ]);

  return NextResponse.json({
    pendingCommands,
    failedCommands,
    lastSync: lastDevice?.lastPing ?? null,
  });
}
