'use server';

/**
 * CSV attendance upload — validate (preview) then commit, two separate
 * server actions so nothing is written to ManualAttendanceEntry until the
 * manager has reviewed flagged rows and explicitly confirmed.
 *
 * See attendance-upload-and-daily-register-spec.md §5 for the full design.
 */

import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { getOrCreatePeriod, isPeriodWritable, writeBlockedReason } from '@/lib/attendance/period';
import { approximateBiometricOtHours } from '@/lib/attendance/biometricOt';
import { OT_DISCREPANCY_TOLERANCE_HOURS } from '@/lib/config';
import {
  parseAttendanceCsv,
  daysInMonth,
  STATUS_CODES,
  STATUS_CODE_TO_ENUM,
  type StatusCode,
  type OtTemplateMode,
} from '@/lib/attendance/csv';
import type { Prisma } from '@prisma/client';

interface ValidationIssue {
  rowIndex: number;
  staffCode?: string;
  day?: number;
  column: string;
  severity: 'error' | 'warning';
  message: string;
}

interface ValidateUploadResult {
  ok: boolean;
  error?: string;
  batchId?: string;
  otMode?: OtTemplateMode;
  rowCount?: number;
  errorCount?: number;
  warningCount?: number;
  issues?: ValidationIssue[];
  canCommit?: boolean;
}

/**
 * Phase 1: parse + validate the uploaded CSV. Creates an
 * AttendanceUploadBatch row (VALIDATED_PENDING_COMMIT or FAILED) with the
 * full issue list, but writes nothing to ManualAttendanceEntry yet.
 */
export async function validateUploadBatch(
  storeId: string,
  periodYear: number,
  periodMonth: number,
  fileName: string,
  csvText: string,
): Promise<ValidateUploadResult> {
  const session = await requireAuth('attendance:csvUpload', { storeId });

  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, clientId: true, attendanceMode: true },
  });
  if (!store) return { ok: false, error: 'Store not found.' };
  if (session.user.role === 'CLIENT' && session.user.clientId !== store.clientId) {
    return { ok: false, error: 'Not authorized for this store.' };
  }

  const period = await getOrCreatePeriod(storeId, periodYear, periodMonth);
  const blockedReason = writeBlockedReason(period.status);
  if (blockedReason) {
    return { ok: false, error: blockedReason };
  }

  let parsed;
  try {
    parsed = parseAttendanceCsv(csvText);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not parse CSV.' };
  }

  const issues: ValidationIssue[] = [];
  const expectedDays = daysInMonth(periodYear, periodMonth);
  const expectedDayList = Array.from({ length: expectedDays }, (_, i) => i + 1);

  // Batch-level: date columns must exactly match the target period's month.
  const daysMatch =
    parsed.days.length === expectedDayList.length &&
    parsed.days.every((d, i) => d === expectedDayList[i]);
  if (!daysMatch) {
    issues.push({
      rowIndex: 1,
      column: 'header',
      severity: 'error',
      message:
        `Date columns in this file (${parsed.days.length} days) don't match ` +
        `${periodYear}-${String(periodMonth).padStart(2, '0')} (${expectedDays} days). ` +
        'This looks like a template downloaded for a different month — re-download the current one.',
    });
  }

  const roster = await prisma.employee.findMany({
    where: { storeId, status: 'ACTIVE' },
    select: { id: true, staffCode: true, name: true },
  });
  const rosterByCode = new Map(roster.map((e) => [e.staffCode, e]));
  const seenCodes = new Set<string>();

  for (const row of parsed.rows) {
    if (!row.staffCode) continue; // fully blank row — skip silently, not an error

    seenCodes.add(row.staffCode);
    const employee = rosterByCode.get(row.staffCode);

    if (!employee) {
      issues.push({
        rowIndex: row.rowIndex,
        staffCode: row.staffCode,
        column: 'ECode',
        severity: 'error',
        message: `ECode "${row.staffCode}" not found or not active at ${store.name}.`,
      });
      continue; // can't validate the rest of this row without a real employee
    }

    if (employee.name.trim().toLowerCase() !== row.name.trim().toLowerCase()) {
      issues.push({
        rowIndex: row.rowIndex,
        staffCode: row.staffCode,
        column: 'Name',
        severity: 'error',
        message: `Name "${row.name}" doesn't match the name on record for ${row.staffCode} ("${employee.name}"). Check for a misaligned or reordered row.`,
      });
    }

    let anyStatusMarked = false;
    for (const [day, rawStatus] of row.statusByDay) {
      if (rawStatus === '') continue;
      anyStatusMarked = true;
      if (!STATUS_CODES.includes(rawStatus as StatusCode)) {
        issues.push({
          rowIndex: row.rowIndex,
          staffCode: row.staffCode,
          day,
          column: `${day}`,
          severity: 'error',
          message: `Invalid status "${rawStatus}" on day ${day} — expected one of ${STATUS_CODES.join('/')} or blank.`,
        });
      }
    }
    if (!anyStatusMarked) {
      issues.push({
        rowIndex: row.rowIndex,
        staffCode: row.staffCode,
        column: 'status',
        severity: 'warning',
        message: `${employee.name} (${row.staffCode}) has no status marked for the whole month.`,
      });
    }

    // OT validation + (Mode A, Biometric store) discrepancy check.
    if (parsed.otMode === 'daily') {
      for (const [day, rawOt] of row.otByDay ?? []) {
        if (rawOt === '') continue;
        const otValue = Number(rawOt);
        if (!Number.isFinite(otValue) || otValue < 0) {
          issues.push({
            rowIndex: row.rowIndex,
            staffCode: row.staffCode,
            day,
            column: `${day}_OT`,
            severity: 'error',
            message: `Invalid OT hours "${rawOt}" on day ${day} — must be a non-negative number.`,
          });
          continue;
        }
        if (store.attendanceMode === 'BIOMETRIC') {
          const approxBiometricOt = await approximateBiometricOtHours(
            row.staffCode,
            new Date(periodYear, periodMonth - 1, day),
          );
          if (
            approxBiometricOt !== null &&
            Math.abs(approxBiometricOt - otValue) > OT_DISCREPANCY_TOLERANCE_HOURS
          ) {
            issues.push({
              rowIndex: row.rowIndex,
              staffCode: row.staffCode,
              day,
              column: `${day}_OT`,
              severity: 'warning',
              message:
                `Uploaded OT (${otValue}h) differs from device-calculated OT (~${approxBiometricOt}h) ` +
                `on day ${day}. Both will be kept for Admin reconciliation.`,
            });
          }
        }
      }
    } else if (row.otTotal) {
      const otValue = Number(row.otTotal);
      if (!Number.isFinite(otValue) || otValue < 0) {
        issues.push({
          rowIndex: row.rowIndex,
          staffCode: row.staffCode,
          column: 'OT_Hours',
          severity: 'error',
          message: `Invalid OT_Hours "${row.otTotal}" — must be a non-negative number.`,
        });
      }
    }
  }

  // Warning: active employees missing from the file entirely.
  for (const emp of roster) {
    if (!seenCodes.has(emp.staffCode)) {
      issues.push({
        rowIndex: 1,
        staffCode: emp.staffCode,
        column: 'ECode',
        severity: 'warning',
        message: `${emp.name} (${emp.staffCode}) is active at this store but missing from the file.`,
      });
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'error').length;
  const warningCount = issues.filter((i) => i.severity === 'warning').length;
  const canCommit = errorCount === 0;

  const batch = await prisma.attendanceUploadBatch.create({
    data: {
      periodId: period.id,
      storeId,
      uploadedByUserId: session.user.id,
      fileName,
      otMode: parsed.otMode === 'daily' ? 'DAILY_SUM' : 'MANUAL_TOTAL',
      status: canCommit ? 'VALIDATED_PENDING_COMMIT' : 'FAILED',
      rowCount: parsed.rows.length,
      errorCount,
      warningCount,
      isLate: period.status === 'LATE_GRANTED',
      parsedSnapshot: serializeParsed(parsed) as unknown as Prisma.InputJsonValue,
      errorReport: issues as unknown as Prisma.InputJsonValue,
    },
  });

  return {
    ok: true,
    batchId: batch.id,
    otMode: parsed.otMode,
    rowCount: parsed.rows.length,
    errorCount,
    warningCount,
    issues,
    canCommit,
  };
}

/**
 * Phase 2: manager confirms after reviewing the preview. Re-checks the
 * period is still writable (it may have gone MISSED between validate and
 * commit if the deadline was mid-flight), then upserts every valid row.
 */
export async function commitUploadBatch(
  batchId: string,
): Promise<{ ok: boolean; error?: string; saved?: number }> {
  const batch = await prisma.attendanceUploadBatch.findUnique({
    where: { id: batchId },
    include: { period: true },
  });
  if (!batch) return { ok: false, error: 'Upload batch not found.' };

  const session = await requireAuth('attendance:csvUpload', { storeId: batch.storeId });

  if (batch.status !== 'VALIDATED_PENDING_COMMIT') {
    return { ok: false, error: 'This batch has errors that must be fixed before it can be committed, or was already committed.' };
  }

  // Re-check period is still writable — deadline may have passed since validate.
  const currentPeriod = await prisma.attendancePeriod.findUniqueOrThrow({ where: { id: batch.periodId } });
  const blockedReason = writeBlockedReason(currentPeriod.status);
  if (blockedReason) {
    await prisma.attendanceUploadBatch.update({ where: { id: batchId }, data: { status: 'FAILED' } });
    return { ok: false, error: blockedReason };
  }

  const parsed = deserializeParsed(batch.parsedSnapshot as unknown as SerializedParsed);
  const roster = await prisma.employee.findMany({
    where: { storeId: batch.storeId, status: 'ACTIVE' },
    select: { id: true, staffCode: true },
  });
  const employeeIdByCode = new Map(roster.map((e) => [e.staffCode, e.id]));

  let saved = 0;
  const otTotalsByEmployeeId = new Map<string, number>();

  for (const row of parsed.rows) {
    const employeeId = employeeIdByCode.get(row.staffCode);
    if (!employeeId) continue; // shouldn't happen post-validation, but don't crash the batch

    for (const [day, rawStatus] of row.statusByDay) {
      if (rawStatus === '') continue;
      const statusCode = rawStatus as StatusCode;
      const status = STATUS_CODE_TO_ENUM[statusCode];
      const date = new Date(currentPeriod.periodYear, currentPeriod.periodMonth - 1, day);
      const otHours =
        parsed.otMode === 'daily' ? numOrNull(row.otByDay?.get(day)) : null;

      await prisma.manualAttendanceEntry.upsert({
        where: { employeeId_date: { employeeId, date } },
        create: {
          employeeId, date, status, otHours,
          source: 'MANUAL_CSV', uploadBatchId: batchId,
          enteredByUserId: session.user.id,
        },
        update: {
          status, otHours,
          source: 'MANUAL_CSV', uploadBatchId: batchId,
          enteredByUserId: session.user.id,
        },
      });
      saved++;

      if (otHours !== null) {
        otTotalsByEmployeeId.set(employeeId, (otTotalsByEmployeeId.get(employeeId) ?? 0) + otHours);
      }
    }

    if (parsed.otMode === 'total' && row.otTotal) {
      const total = numOrNull(row.otTotal);
      if (total !== null) {
        await prisma.employeeMonthlyOvertime.upsert({
          where: { periodId_employeeId: { periodId: currentPeriod.id, employeeId } },
          create: { periodId: currentPeriod.id, employeeId, totalHours: total, source: 'MANUAL_TOTAL' },
          update: { totalHours: total, source: 'MANUAL_TOTAL' },
        });
      }
    }
  }

  if (parsed.otMode === 'daily') {
    for (const [employeeId, totalHours] of otTotalsByEmployeeId) {
      await prisma.employeeMonthlyOvertime.upsert({
        where: { periodId_employeeId: { periodId: currentPeriod.id, employeeId } },
        create: { periodId: currentPeriod.id, employeeId, totalHours, source: 'DAILY_SUM' },
        update: { totalHours, source: 'DAILY_SUM' },
      });
    }
  }

  const isLate = currentPeriod.status === 'LATE_GRANTED';
  await prisma.$transaction([
    prisma.attendanceUploadBatch.update({ where: { id: batchId }, data: { status: 'COMMITTED', isLate } }),
    prisma.attendancePeriod.update({
      where: { id: currentPeriod.id },
      data: isLate
        ? { status: 'CLOSED_LATE', isLate: true, closedAt: new Date() }
        : { status: 'CLOSED', submittedAt: new Date(), closedAt: new Date() },
    }),
  ]);

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_CSV_COMMITTED',
    targetType: 'Store',
    targetId: batch.storeId,
    metadata: { batchId, periodYear: currentPeriod.periodYear, periodMonth: currentPeriod.periodMonth, saved, isLate },
  });

  return { ok: true, saved };
}

/** Manager files a request to unlock uploads on a MISSED period. */
export async function requestLateAccess(
  periodId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const period = await prisma.attendancePeriod.findUnique({ where: { id: periodId } });
  if (!period) return { ok: false, error: 'Period not found.' };

  const session = await requireAuth('attendance:lateAccess:request', { storeId: period.storeId });

  if (period.status !== 'MISSED' && period.status !== 'LATE_DENIED') {
    return { ok: false, error: 'Late-access requests can only be filed for a missed period.' };
  }

  await prisma.$transaction([
    prisma.lateUploadRequest.create({
      data: { periodId, requestedByUserId: session.user.id, reason: reason || null },
    }),
    prisma.attendancePeriod.update({ where: { id: periodId }, data: { status: 'LATE_REQUESTED' } }),
  ]);

  await writeAuditLog({
    userId: session.user.id,
    action: 'ATTENDANCE_LATE_ACCESS_REQUESTED',
    targetType: 'Store',
    targetId: period.storeId,
    metadata: { periodId, reason },
  });

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────
// Snapshot (de)serialization — parsedSnapshot stores Maps as plain objects
// since JSON has no Map type.
// ─────────────────────────────────────────────────────────────────────────

interface SerializedRow {
  rowIndex: number;
  staffCode: string;
  name: string;
  statusByDay: Record<string, string>;
  otByDay?: Record<string, string>;
  otTotal?: string;
}
interface SerializedParsed {
  otMode: OtTemplateMode;
  days: number[];
  rows: SerializedRow[];
}

function serializeParsed(parsed: ReturnType<typeof parseAttendanceCsv>): SerializedParsed {
  return {
    otMode: parsed.otMode,
    days: parsed.days,
    rows: parsed.rows.map((r) => ({
      rowIndex: r.rowIndex,
      staffCode: r.staffCode,
      name: r.name,
      statusByDay: Object.fromEntries(r.statusByDay),
      otByDay: r.otByDay ? Object.fromEntries(r.otByDay) : undefined,
      otTotal: r.otTotal,
    })),
  };
}

function deserializeParsed(serialized: SerializedParsed) {
  return {
    otMode: serialized.otMode,
    days: serialized.days,
    rows: serialized.rows.map((r) => ({
      rowIndex: r.rowIndex,
      staffCode: r.staffCode,
      name: r.name,
      statusByDay: new Map(Object.entries(r.statusByDay).map(([k, v]) => [Number(k), v])),
      otByDay: r.otByDay ? new Map(Object.entries(r.otByDay).map(([k, v]) => [Number(k), v])) : undefined,
      otTotal: r.otTotal,
    })),
  };
}

function numOrNull(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
