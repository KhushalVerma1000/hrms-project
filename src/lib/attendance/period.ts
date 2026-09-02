/**
 * Monthly attendance period + deadline resolution.
 *
 * See attendance-upload-and-daily-register-spec.md (Sections 3-4) for the
 * full state machine and design rationale. Short version:
 *
 *   - Every store has one AttendancePeriod row per calendar month it has
 *     ever been "open" for. Created lazily — first time something touches
 *     that store+month (or a daily cron opening the current month, see
 *     ensureCurrentPeriodsExist below).
 *   - deadlineAt is snapshotted from AttendanceDeadlinePolicy at CREATION
 *     time. Editing the policy later does not retroactively move an
 *     already-open period's deadline — see resolveDeadlineDay's docstring.
 */

import { prisma } from '@/lib/prisma';
import { SYSTEM_DEFAULT_DEADLINE_DAY } from '@/lib/config';
import type { AttendancePeriod, PeriodStatus } from '@prisma/client';

/**
 * Resolves the deadline day-of-month for a store, in priority order:
 * store override > client default > SYSTEM_DEFAULT_DEADLINE_DAY.
 *
 * This is only ever called at period-creation time (see getOrCreatePeriod
 * below) — it is NOT re-run against already-created periods, by design.
 * If you want a policy change to retroactively shift open periods too,
 * that's a one-line change (call this instead of reading period.deadlineAt),
 * but the default here treats deadlineAt as a snapshot.
 */
export async function resolveDeadlineDay(storeId: string, clientId: string): Promise<number> {
  const storeOverride = await prisma.attendanceDeadlinePolicy.findUnique({
    where: { storeId },
  });
  if (storeOverride) return storeOverride.deadlineDay;

  const clientDefault = await prisma.attendanceDeadlinePolicy.findUnique({
    where: { clientId },
  });
  if (clientDefault) return clientDefault.deadlineDay;

  return SYSTEM_DEFAULT_DEADLINE_DAY;
}

/**
 * Computes the deadline instant for a given period: 23:59:59 on
 * `deadlineDay` of the month AFTER periodMonth/periodYear, rolling the
 * year forward for December. Kept naive (server-local time) to match the
 * rest of the codebase's Date handling — if you want this pinned to IST
 * specifically regardless of server timezone, use date-fns-tz's
 * `fromZonedTime` the same way src/lib/sync/attendance.ts does for
 * SmartOffice timestamps.
 */
export function computeDeadlineAt(periodYear: number, periodMonth: number, deadlineDay: number): Date {
  const deadlineMonth = periodMonth === 12 ? 1 : periodMonth + 1;
  const deadlineYear = periodMonth === 12 ? periodYear + 1 : periodYear;
  return new Date(deadlineYear, deadlineMonth - 1, deadlineDay, 23, 59, 59, 999);
}

/**
 * Gets the AttendancePeriod for a store+month, creating it (with a freshly
 * resolved deadline snapshot) if it doesn't exist yet. Also flips an
 * existing OPEN period to MISSED if its deadline has since passed — this
 * lazy transition means you don't strictly need a cron for correctness,
 * though a daily cron calling this for every store is still worth having
 * so Admin's "missed periods" dashboard doesn't only update on next access.
 */
export async function getOrCreatePeriod(
  storeId: string,
  periodYear: number,
  periodMonth: number,
): Promise<AttendancePeriod> {
  const existing = await prisma.attendancePeriod.findUnique({
    where: { storeId_periodYear_periodMonth: { storeId, periodYear, periodMonth } },
  });

  if (existing) {
    return maybeExpireToMissed(existing);
  }

  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
    select: { clientId: true },
  });

  const deadlineDay = await resolveDeadlineDay(storeId, store.clientId);
  const deadlineAt = computeDeadlineAt(periodYear, periodMonth, deadlineDay);

  const created = await prisma.attendancePeriod.create({
    data: { storeId, periodYear, periodMonth, deadlineAt, status: 'OPEN' },
  });

  return maybeExpireToMissed(created);
}

/**
 * OPEN → MISSED once deadlineAt has passed with nothing submitted.
 * LATE_GRANTED → MISSED once grantedUntil (on the most recent approved
 * LateUploadRequest) has passed with nothing submitted.
 * All other statuses are left alone (CLOSED/CLOSED_LATE are terminal;
 * LATE_REQUESTED/LATE_DENIED are waiting on/reflect an Admin decision, not
 * a clock).
 */
async function maybeExpireToMissed(period: AttendancePeriod): Promise<AttendancePeriod> {
  const now = new Date();

  if (period.status === 'OPEN' && period.deadlineAt < now) {
    return prisma.attendancePeriod.update({
      where: { id: period.id },
      data: { status: 'MISSED' },
    });
  }

  if (period.status === 'LATE_GRANTED') {
    const latestGrant = await prisma.lateUploadRequest.findFirst({
      where: { periodId: period.id, status: 'APPROVED' },
      orderBy: { resolvedAt: 'desc' },
    });
    if (latestGrant?.grantedUntil && latestGrant.grantedUntil < now) {
      return prisma.attendancePeriod.update({
        where: { id: period.id },
        data: { status: 'MISSED' },
      });
    }
  }

  return period;
}

/** Whether uploads/edits are currently allowed for this period. */
export function isPeriodWritable(status: PeriodStatus): boolean {
  return status === 'OPEN' || status === 'LATE_GRANTED';
}

const STATUS_MESSAGES: Partial<Record<PeriodStatus, string>> = {
  MISSED: 'The deadline for this period has passed. Request late upload access to continue.',
  LATE_REQUESTED: 'A late-access request is pending Admin approval for this period.',
  LATE_DENIED: 'Your late-access request for this period was denied. You may file a new request.',
  CLOSED: 'This period has already been submitted and closed.',
  CLOSED_LATE: 'This period has already been submitted (late) and closed.',
};

/** Human-readable reason uploads/edits are blocked, or null if they're allowed. */
export function writeBlockedReason(status: PeriodStatus): string | null {
  if (isPeriodWritable(status)) return null;
  return STATUS_MESSAGES[status] ?? 'This period is not currently open for edits.';
}

/**
 * Opens (or expires-to-MISSED) the AttendancePeriod for every active store
 * for the current calendar month. Intended to be called once daily from a
 * cron route (mirroring the existing pattern in src/app/api/sync/attendance
 * — see src/app/api/attendance/periods/tick/route.ts).
 */
export async function ensureCurrentPeriodsExist(): Promise<{ storesProcessed: number }> {
  const stores = await prisma.store.findMany({ select: { id: true } });
  const now = new Date();
  const periodYear = now.getFullYear();
  const periodMonth = now.getMonth() + 1;

  for (const store of stores) {
    await getOrCreatePeriod(store.id, periodYear, periodMonth);
  }

  return { storesProcessed: stores.length };
}
