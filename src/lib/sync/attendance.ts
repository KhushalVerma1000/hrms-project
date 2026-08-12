/**
 * Attendance sync job.
 *
 * Pulls device logs from SmartOffice and upserts into AttendanceLog.
 * SmartOffice timestamps are interpreted in SMARTOFFICE_TIMEZONE (default: Asia/Kolkata).
 * See src/lib/config.ts for the configurable timezone constant.
 */

import { prisma } from '@/lib/prisma';
import { getDeviceLogs, formatSmartOfficeDate } from '@/lib/smartoffice/client';
import { SMARTOFFICE_TIMEZONE, ATTENDANCE_SYNC_DEFAULT_LOOKBACK_DAYS } from '@/lib/config';
import type { DeviceLogRecord } from '@/lib/smartoffice/types';

export interface AttendanceSyncResult {
  devicesProcessed: number;
  logsUpserted: number;
  errors: Array<{ serialNumber: string; error: string }>;
}

/**
 * Parses a SmartOffice date string into a UTC Date, accounting for the
 * configured timezone (SMARTOFFICE_TIMEZONE, default: Asia/Kolkata / IST).
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

    // Parse as if in the configured timezone using Intl
    const tzDate = new Date(
      new Date(withTime + ' GMT').toLocaleString('en-US', { timeZone: SMARTOFFICE_TIMEZONE })
    );

    if (isNaN(tzDate.getTime())) {
      console.warn(`[Sync] Could not parse date: ${dateStr}, using current time`);
      return new Date();
    }
    return tzDate;
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

      const soResult = await getDeviceLogs({
        FromDate: formatSmartOfficeDate(fromDate),
        ToDate: formatSmartOfficeDate(toDate),
        SerialNumber: device.serialNumber,
      });

      if (!soResult.ok) {
        result.errors.push({ serialNumber: device.serialNumber, error: soResult.message });
        continue;
      }

      const logs: DeviceLogRecord[] = Array.isArray(soResult.data) ? soResult.data : [];

      for (const log of logs) {
        await prisma.attendanceLog.upsert({
          where: {
            employeeCode_logDate_serialNumber: {
              employeeCode: log.EmployeeCode,
              logDate: parseSmartOfficeDate(log.LogDate),
              serialNumber: log.SerialNumber,
            },
          },
          update: {
            punchDirection: log.PunchDirection,
            temperature: log.Temperature,
            syncedAt: new Date(),
          },
          create: {
            employeeCode: log.EmployeeCode,
            logDate: parseSmartOfficeDate(log.LogDate),
            serialNumber: log.SerialNumber,
            punchDirection: log.PunchDirection,
            temperature: log.Temperature,
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
