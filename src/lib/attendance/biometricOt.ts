/**
 * Approximates a Biometric-mode employee's daily overtime from raw
 * AttendanceLog punches, purely so a Mode A ("daily OT") CSV upload can be
 * checked for a discrepancy against it (spec §5.4).
 *
 * IMPORTANT — this is a stated assumption, not a synced SmartOffice value:
 * SmartOffice/AttendanceLog has no OT field. This computes
 * (last punch − first punch) − STANDARD_SHIFT_HOURS for that employee+day,
 * floored at 0. If your actual shift/OT rules are more complex (breaks,
 * night-shift handling, per-store shift lengths), this needs adjusting
 * before the discrepancy flag can be trusted — treat it as a first pass,
 * not a payroll-grade OT engine.
 */

import { prisma } from '@/lib/prisma';
import { STANDARD_SHIFT_HOURS } from '@/lib/config';

/**
 * Returns the approximated OT hours for one employee on one calendar day,
 * or null if there isn't enough punch data (fewer than 2 punches) to compute
 * anything — callers should treat null as "can't compare, don't flag".
 */
export async function approximateBiometricOtHours(
  staffCode: string,
  date: Date,
): Promise<number | null> {
  const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

  const logs = await prisma.attendanceLog.findMany({
    where: { employeeCode: staffCode, logDate: { gte: dayStart, lte: dayEnd } },
    orderBy: { logDate: 'asc' },
    select: { logDate: true },
  });

  if (logs.length < 2) return null;

  const first = logs[0].logDate;
  const last = logs[logs.length - 1].logDate;
  const workedHours = (last.getTime() - first.getTime()) / (1000 * 60 * 60);

  return Math.max(0, Math.round((workedHours - STANDARD_SHIFT_HOURS) * 100) / 100);
}
