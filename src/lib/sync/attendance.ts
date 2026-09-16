/**
 * Attendance sync job.
 *
 * Pulls device logs via the biometric provider facade (Patch C of the
 * biometric provider modularization spec) and upserts into AttendanceLog.
 * Device-specific provider resolution (SmartOffice today) happens inside
 * the facade — this file no longer knows or cares which vendor a given
 * device is wired to.
 *
 * SmartOffice timestamps are interpreted in SMARTOFFICE_TIMEZONE (default: Asia/Kolkata).
 * See src/lib/config.ts for the configurable timezone constant. (Once a
 * second vendor exists, per-device timezone may need to move onto
 * BiometricProviderConfig — flagged here, not solved.)
 */

import { prisma } from '@/lib/prisma';
import * as facade from '@/lib/biometric/facade';
// Pure date-formatting utility (not a vendor API call), reused as-is per
// spec Section 2.4 — smartoffice/client.ts is untouched by this migration.
import { formatSmartOfficeDate } from '@/lib/smartoffice/client';
import { SMARTOFFICE_TIMEZONE, ATTENDANCE_SYNC_DEFAULT_LOOKBACK_DAYS } from '@/lib/config';
import { fromZonedTime } from 'date-fns-tz';

export interface AttendanceSyncResult {
  devicesProcessed: number;
  logsUpserted: number;
  errors: Array<{ serialNumber: string; error: string }>;
}

/**
 * Parses a SmartOffice date string (naive, no timezone info — e.g.
 * "2019-09-16 13:45:29") into a correct UTC Date, treating it as wall-clock
 * time in the configured timezone (SMARTOFFICE_TIMEZONE, default:
 * Asia/Kolkata / IST).
 *
 * Uses date-fns-tz's `fromZonedTime`, which does this conversion correctly
 * regardless of what timezone the server process itself is running in.
 * (The previous implementation round-tripped through `toLocaleString` +
 * `new Date(...)`, which re-parses a formatted string using the *server's*
 * local timezone rather than the configured SmartOffice one — silently wrong
 * on any server not already running in SMARTOFFICE_TIMEZONE.)
 *
 * ⚠️ Verification note: Before relying on this in production, punch a device at
 * a known wall-clock time, pull via GetDeviceLogs, and compare. If the timestamp
 * is off by ~5h30m, switch SMARTOFFICE_TIMEZONE to 'UTC' in .env.local.
 */
function parseSmartOfficeDate(dateStr: string): Date {
  if (!dateStr) return new Date();

  try {
    const normalized = dateStr.replace('T', ' ').trim();
    const withTime = normalized.includes(':') ? normalized : `${normalized} 00:00:00`;

    const utcDate = fromZonedTime(withTime, SMARTOFFICE_TIMEZONE);

    if (isNaN(utcDate.getTime())) {
      console.warn(`[Sync] Could not parse date: ${dateStr}, using current time`);
      return new Date();
    }
    return utcDate;
  } catch {
    return new Date(dateStr); // fallback
  }
}

export async function runAttendanceSync(): Promise<AttendanceSyncResult> {
  const result: AttendanceSyncResult = {
    devicesProcessed: 0,
    logsUpserted: 0,
    errors: [],
  };

  const devices = await prisma.device.findMany({
    where: {
      store: { employees: { some: { status: 'ACTIVE' } } },
    },
    select: {
      id: true,
      serialNumber: true,
      lastPing: true,
    },
  });

  console.log(`[Sync] Starting attendance sync for ${devices.length} devices`);

  for (const device of devices) {
    try {
      const fromDate = device.lastPing
        ? new Date(device.lastPing.getTime() - 24 * 60 * 60 * 1000)
        : new Date(Date.now() - ATTENDANCE_SYNC_DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

      const toDate = new Date();

      const bioResult = await facade.getDeviceLogs(device.id, {
        fromDate: formatSmartOfficeDate(fromDate),
        toDate: formatSmartOfficeDate(toDate),
      });

      if (!bioResult.ok) {
        result.errors.push({ serialNumber: device.serialNumber, error: bioResult.message });
        continue;
      }

      const logs = bioResult.data;

      for (const log of logs) {
        await prisma.attendanceLog.upsert({
          where: {
            employeeCode_logDate_serialNumber: {
              employeeCode: log.employeeCode,
              logDate: parseSmartOfficeDate(log.logDate),
              serialNumber: log.serialNumber,
            },
          },
          update: {
            punchDirection: log.punchDirection,
            temperature: log.temperature,
            syncedAt: new Date(),
          },
          create: {
            employeeCode: log.employeeCode,
            logDate: parseSmartOfficeDate(log.logDate),
            serialNumber: log.serialNumber,
            punchDirection: log.punchDirection,
            temperature: log.temperature,
          },
        });
        result.logsUpserted++;
      }

      await prisma.device.update({
        where: { id: device.id },
        data: {
          lastPing: new Date(),
          isOnline: true,
          attLogsCount: { increment: logs.length },
        },
      });

      result.devicesProcessed++;
      console.log(`[Sync] Device ${device.serialNumber}: synced ${logs.length} logs`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[Sync] Device ${device.serialNumber} error: ${errorMsg}`);
      result.errors.push({ serialNumber: device.serialNumber, error: errorMsg });

      await prisma.device.update({
        where: { id: device.id },
        data: { isOnline: false },
      }).catch(() => { /* ignore update failure */ });
    }
  }

  console.log(
    `[Sync] Complete. Devices: ${result.devicesProcessed}/${devices.length}, ` +
    `Logs: ${result.logsUpserted}, Errors: ${result.errors.length}`,
  );

  return result;
}
