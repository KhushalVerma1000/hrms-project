'use server';

import { requireAuth, getAuthSession } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { AuthorizationError } from '@/lib/errors';
import { getOrCreatePeriod, writeBlockedReason } from '@/lib/attendance/period';
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
  const period = await getOrCreatePeriod(storeId, date.getFullYear(), date.getMonth() + 1);
  const blockedReason = writeBlockedReason(period.status);

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
    /// Non-null when the Daily Register should be shown read-only for this
    /// date's period (deadline passed / already closed) — see spec §7.
    /// ADMIN can still write; the UI should only lock the form for other roles.
    readOnlyReason: session.user.role === 'ADMIN' ? null : blockedReason,
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
  /// Optional per-day overtime hours entered directly in the Daily Register
  /// (same field CSV "daily OT" mode writes to — see spec §5, §7).
  otHours?: number;
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

  const date = new Date(dateStr);
  const period = await getOrCreatePeriod(storeId, date.getFullYear(), date.getMonth() + 1);

  // ADMIN can edit through a closed/missed period (matches spec §7 — Admin
  // retains edit rights after close); everyone else is gated by period status.
  if (session.user.role !== 'ADMIN') {
    const blockedReason = writeBlockedReason(period.status);
    if (blockedReason) return { ok: false, error: blockedReason };
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

  let saved = 0;
  const touchedEmployeeIds = new Set<string>();

  for (const entry of entries) {
    if (!validEmployeeIds.has(entry.employeeId)) continue; // silently skip, don't fail the whole batch

    const checkInTime = entry.checkInTime ? combineDateAndTime(date, entry.checkInTime) : null;
    const checkOutTime = entry.checkOutTime ? combineDateAndTime(date, entry.checkOutTime) : null;
    const otHours = entry.otHours ?? null;

    await prisma.manualAttendanceEntry.upsert({
      where: { employeeId_date: { employeeId: entry.employeeId, date } },
      create: {
        employeeId: entry.employeeId,
        date,
        status: entry.status,
        checkInTime,
        checkOutTime,
        notes: entry.notes || null,
        otHours,
        source: 'MANUAL_DAILY_EDIT',
        enteredByUserId: session.user.id,
      },
      update: {
        status: entry.status,
        checkInTime,
        checkOutTime,
        notes: entry.notes || null,
        otHours,
        // A direct Daily Register edit always takes precedence over a prior
        // CSV row for this same day — flip source and detach the old batch link.
        source: 'MANUAL_DAILY_EDIT',
        uploadBatchId: null,
        enteredByUserId: session.user.id, // last editor wins
      },
    });
    saved++;
    touchedEmployeeIds.add(entry.employeeId);
  }

  await recomputeMonthlyOvertimeForEmployees(period.id, period.periodYear, period.periodMonth, touchedEmployeeIds);

  await writeAuditLog({
    userId: session.user.id,
    action: 'MANUAL_ATTENDANCE_SAVED',
    targetType: 'Store',
    targetId: storeId,
    metadata: { date: dateStr, entriesSaved: saved },
  });

  return { ok: true, saved };
}

/**
 * Re-sums ManualAttendanceEntry.otHours across the whole period for each
 * touched employee and upserts EmployeeMonthlyOvertime as DAILY_SUM. Only
 * runs for employees that actually have at least one non-null otHours entry
 * this period — an employee with no daily OT entered at all is left alone,
 * so a previously-uploaded MANUAL_TOTAL figure for someone nobody has
 * touched in the Daily Register isn't clobbered by an empty sum.
 */
async function recomputeMonthlyOvertimeForEmployees(
  periodId: string,
  periodYear: number,
  periodMonth: number,
  employeeIds: Set<string>,
): Promise<void> {
  const monthStart = new Date(periodYear, periodMonth - 1, 1);
  const monthEnd = new Date(periodYear, periodMonth, 0, 23, 59, 59, 999);

  for (const employeeId of employeeIds) {
    const entries = await prisma.manualAttendanceEntry.findMany({
      where: { employeeId, date: { gte: monthStart, lte: monthEnd }, otHours: { not: null } },
      select: { otHours: true },
    });
    if (entries.length === 0) continue;

    const totalHours = entries.reduce((sum, e) => sum + Number(e.otHours), 0);
    await prisma.employeeMonthlyOvertime.upsert({
      where: { periodId_employeeId: { periodId, employeeId } },
      create: { periodId, employeeId, totalHours, source: 'DAILY_SUM' },
      update: { totalHours, source: 'DAILY_SUM' },
    });
  }
}

function combineDateAndTime(date: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const combined = new Date(date);
  combined.setHours(hours ?? 0, minutes ?? 0, 0, 0);
  return combined;
}
