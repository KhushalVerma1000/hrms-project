'use server';

import { requireAuth, getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { AuthorizationError } from '@/lib/errors';
import type { ManualAttendanceStatus } from '@prisma/client';

/**
 * Fetches everything needed to render the manual attendance entry form for
 * a given store + date: the store's own mode (to confirm it's actually
 * MANUAL — a Biometric store has no business here), the roster, and any
 * entries already recorded for that day.
 */
export async function getManualAttendanceForDate(storeId: string, dateStr: string) {
  const session = await requireAuth('attendance:manualEntry', { storeId });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, attendanceMode: true, clientId: true },
  });

  if (!store) throw new Error('Store not found.');
  if (store.attendanceMode !== 'MANUAL') {
    throw new Error(
      `${store.name} uses biometric attendance — manual entry isn't available for this store. ` +
      'Use the main Attendance dashboard instead.',
    );
  }

  // Re-check scope now that we know the actual clientId (defense in depth —
  // requireAuth already checked storeId, this catches any edge case where a
  // Client user's clientId doesn't match the store they're trying to access).
  if (session.user.role === 'CLIENT' && session.user.clientId !== store.clientId) {
    throw new AuthorizationError();
  }

  const date = new Date(dateStr);

  const employees = await prisma.employee.findMany({
    where: { storeId, status: 'ACTIVE' },
    select: { id: true, name: true, staffCode: true, designation: true },
    orderBy: { name: 'asc' },
  });

  const entries = await prisma.manualAttendanceEntry.findMany({
    where: { employeeId: { in: employees.map((e) => e.id) }, date },
  });

  const entryByEmployeeId = new Map(entries.map((e) => [e.employeeId, e]));

  return {
    store: { id: store.id, name: store.name },
    date: dateStr,
    roster: employees.map((emp) => ({
      ...emp,
      existingEntry: entryByEmployeeId.get(emp.id) ?? null,
    })),
  };
}

export interface ManualAttendanceInput {
  employeeId: string;
  status: ManualAttendanceStatus;
  checkInTime?: string; // "HH:mm", optional
  checkOutTime?: string;
  notes?: string;
}

/**
 * Saves (upserts) a batch of manual attendance entries for one store/date.
 * One call per "Save" click in the UI, covering however many rows changed —
 * avoids N separate round trips for a store with a large roster.
 */
export async function saveManualAttendanceBatch(
  storeId: string,
  dateStr: string,
  entries: ManualAttendanceInput[],
): Promise<{ ok: boolean; error?: string; saved?: number }> {
  const session = await requireAuth('attendance:manualEntry', { storeId });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { attendanceMode: true, clientId: true, name: true },
  });

  if (!store) return { ok: false, error: 'Store not found.' };
  if (store.attendanceMode !== 'MANUAL') {
    return {
      ok: false,
      error: `${store.name} uses biometric attendance — manual entry isn't available for this store.`,
    };
  }
  if (session.user.role === 'CLIENT' && session.user.clientId !== store.clientId) {
    return { ok: false, error: 'Not authorized for this store.' };
  }

  // Confirm every employeeId in the batch actually belongs to this store —
  // prevents a tampered request from writing attendance for another store's staff.
  const validEmployeeIds = new Set(
    (
      await prisma.employee.findMany({
        where: { storeId },
        select: { id: true },
      })
    ).map((e) => e.id),
  );

  const date = new Date(dateStr);
  let saved = 0;

  for (const entry of entries) {
    if (!validEmployeeIds.has(entry.employeeId)) continue; // silently skip, don't fail the whole batch

    const checkInTime = entry.checkInTime ? combineDateAndTime(date, entry.checkInTime) : null;
    const checkOutTime = entry.checkOutTime ? combineDateAndTime(date, entry.checkOutTime) : null;

    await prisma.manualAttendanceEntry.upsert({
      where: { employeeId_date: { employeeId: entry.employeeId, date } },
      create: {
        employeeId: entry.employeeId,
        date,
        status: entry.status,
        checkInTime,
        checkOutTime,
        notes: entry.notes || null,
        enteredByUserId: session.user.id,
      },
      update: {
        status: entry.status,
        checkInTime,
        checkOutTime,
        notes: entry.notes || null,
        enteredByUserId: session.user.id, // last editor wins
      },
    });
    saved++;
  }

  await writeAuditLog({
    userId: session.user.id,
    action: 'MANUAL_ATTENDANCE_SAVED',
    targetType: 'Store',
    targetId: storeId,
    metadata: { date: dateStr, entriesSaved: saved },
  });

  return { ok: true, saved };
}

function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const combined = new Date(date);
  combined.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return combined;
}
