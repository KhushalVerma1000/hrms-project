'use server';

import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/smartoffice/audit';
import { AuthorizationError } from '@/lib/errors';
import { SMARTOFFICE_TIMEZONE } from '@/lib/config';
import { getOrCreatePeriod, writeBlockedReason } from '@/lib/attendance/period';
import {
  DUPLICATE_THRESHOLD,
  ENROLL_MAX_SAMPLES,
  ENROLL_MIN_SAMPLES,
  MIN_GAP_MS,
  decidePunch,
  distance,
  findBestMatch,
  parseDescriptor,
  samplesAreConsistent,
} from '@/lib/face/match';
import type { Session } from 'next-auth';

/**
 * Face-scan attendance (phone-based, free tier: all face maths runs in the
 * user's browser via face-api; the server only compares 128-number vectors).
 *
 * Works for EVERY store, whatever its attendance mode (once switched on for the store):
 *  - MANUAL stores    → writes ManualAttendanceEntry (source FACE_SCAN), so period
 *                       deadlines, monthly overtime and the Daily Register keep
 *                       working unchanged.
 *  - BIOMETRIC stores → writes an AttendanceLog row against a virtual device
 *                       serial (FACE-<storeId>), so the phone scan shows up in the
 *                       same Attendance Logs screen and OT maths as device punches.
 *                       The device sync never touches this serial, so it is never
 *                       overwritten.
 */

/** Virtual "device" serial that phone face-scans are logged under for BIOMETRIC stores. */
const faceSerialFor = (storeId: string) => `FACE-${storeId}`;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface FaceRosterRow {
  id: string;
  name: string;
  designation: string;
  samples: number; // 0 = not enrolled
}

export interface FaceContext {
  store: { id: string; name: string };
  canEnroll: boolean;
  roster: FaceRosterRow[];
}

export type FacePunchResult =
  | {
      ok: true;
      outcome: 'CHECKED_IN' | 'CHECKED_OUT' | 'CHECK_OUT_UPDATED' | 'ALREADY_RECORDED';
      employee: { id: string; name: string; designation: string };
      at: string; // ISO instant of the punch (or of the earlier punch for ALREADY_RECORDED)
    }
  | {
      ok: false;
      code: 'NO_MATCH' | 'AMBIGUOUS' | 'BLOCKED' | 'CLOSED' | 'NOBODY_ENROLLED' | 'ERROR';
      error: string;
      employeeName?: string;
    };

export type SimpleResult = { ok: true } | { ok: false; error: string };

// ─── Shared guards ──────────────────────────────────────────────────────────

type ManualStore = { id: string; name: string; clientId: string; attendanceMode: string; faceAttendanceEnabled: boolean };

async function loadFaceStore(
  session: Session,
  storeId: string,
): Promise<{ store: ManualStore } | { error: string }> {
  const store = await prisma.store.findUnique({
    where: { id: storeId },
    select: { id: true, name: true, clientId: true, attendanceMode: true, faceAttendanceEnabled: true },
  });
  if (!store) return { error: 'Store not found.' };
  if (session.user.role === 'CLIENT' && session.user.clientId !== store.clientId) {
    return { error: 'Not authorized for this store.' };
  }
  if (!store.faceAttendanceEnabled) {
    return { error: `Face attendance is not switched on for ${store.name}. Ask an Admin or Client user to enable it in Stores & Brands.` };
  }
  return { store };
}

function errorMessage(err: unknown): string {
  if (err instanceof AuthorizationError) return 'You are not allowed to do this for this store.';
  return err instanceof Error ? err.message : 'Something went wrong. Please try again.';
}

// ─── Context for the screen ─────────────────────────────────────────────────

export async function getFaceContext(
  storeId: string,
): Promise<{ ok: true; data: FaceContext } | { ok: false; error: string }> {
  try {
    const session = await requireAuth('attendance:facePunch', { storeId });
    const loaded = await loadFaceStore(session, storeId);
    if ('error' in loaded) return { ok: false, error: loaded.error };

    const employees = await prisma.employee.findMany({
      where: { storeId, status: 'ACTIVE' },
      select: { id: true, name: true, designation: true, _count: { select: { faceTemplates: true } } },
      orderBy: { name: 'asc' },
    });

    const canEnroll = ['ADMIN', 'CLIENT', 'MANAGER', 'SHIFT_INCHARGE'].includes(session.user.role);

    return {
      ok: true,
      data: {
        store: { id: loaded.store.id, name: loaded.store.name },
        canEnroll,
        roster: employees.map((e) => ({
          id: e.id,
          name: e.name,
          designation: e.designation,
          samples: e._count.faceTemplates,
        })),
      },
    };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// ─── Recording a scan ───────────────────────────────────────────────────────

export async function recordFacePunch(storeId: string, rawDescriptor: unknown): Promise<FacePunchResult> {
  try {
    const session = await requireAuth('attendance:facePunch', { storeId });

    const descriptor = parseDescriptor(rawDescriptor);
    if (!descriptor) return { ok: false, code: 'ERROR', error: 'Scan data was invalid. Please try again.' };

    const loaded = await loadFaceStore(session, storeId);
    if ('error' in loaded) return { ok: false, code: 'ERROR', error: loaded.error };

    // "Today" is the store's local calendar day, not the server's (Vercel runs in UTC).
    const now = new Date();
    const dateStr = formatInTimeZone(now, SMARTOFFICE_TIMEZONE, 'yyyy-MM-dd');
    const date = new Date(dateStr); // UTC midnight — same convention as the Daily Register
    const isBiometricStore = loaded.store.attendanceMode !== 'MANUAL';

    // Period deadlines only govern manually-entered attendance; device-style
    // punches are never blocked by them (the device sync isn't either).
    if (!isBiometricStore) {
      const period = await getOrCreatePeriod(storeId, date.getFullYear(), date.getMonth() + 1);
      if (session.user.role !== 'ADMIN') {
        const blocked = writeBlockedReason(period.status);
        if (blocked) return { ok: false, code: 'CLOSED', error: blocked };
      }
    }

    const templates = await prisma.faceTemplate.findMany({
      where: { employee: { storeId, status: 'ACTIVE' } },
      select: { employeeId: true, descriptor: true },
    });
    if (templates.length === 0) {
      return {
        ok: false,
        code: 'NOBODY_ENROLLED',
        error: 'No faces are enrolled for this store yet. Use the Enroll tab first.',
      };
    }

    const match = findBestMatch(descriptor, templates);
    if (match.kind === 'NO_MATCH') {
      return { ok: false, code: 'NO_MATCH', error: 'Face not recognised. Try again in better light, or enroll this person.' };
    }
    if (match.kind === 'AMBIGUOUS') {
      return { ok: false, code: 'AMBIGUOUS', error: 'Could not tell this person apart from a colleague. Try again, facing the camera.' };
    }

    const employee = await prisma.employee.findUnique({
      where: { id: match.employeeId },
      select: { id: true, name: true, designation: true, staffCode: true },
    });
    if (!employee) return { ok: false, code: 'ERROR', error: 'Employee not found.' };
    const person = { id: employee.id, name: employee.name, designation: employee.designation };

    // ── BIOMETRIC store: log the scan like a device punch ───────────────────
    if (isBiometricStore) {
      const dayStart = fromZonedTime(`${dateStr} 00:00:00`, SMARTOFFICE_TIMEZONE);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const todays = await prisma.attendanceLog.findMany({
        where: { employeeCode: employee.staffCode, logDate: { gte: dayStart, lt: dayEnd } },
        orderBy: { logDate: 'desc' },
        select: { logDate: true },
        take: 1,
      });
      const last = todays[0]?.logDate;
      if (last && now.getTime() - last.getTime() < MIN_GAP_MS) {
        return { ok: true, outcome: 'ALREADY_RECORDED', employee: person, at: last.toISOString() };
      }
      const isFirst = !last;
      await prisma.attendanceLog.create({
        data: {
          employeeCode: employee.staffCode,
          logDate: now,
          serialNumber: faceSerialFor(storeId),
          punchDirection: isFirst ? 'IN' : 'OUT',
        },
      });
      return { ok: true, outcome: isFirst ? 'CHECKED_IN' : 'CHECKED_OUT', employee: person, at: now.toISOString() };
    }

    const existing = await prisma.manualAttendanceEntry.findUnique({
      where: { employeeId_date: { employeeId: employee.id, date } },
      select: { status: true, checkInTime: true, checkOutTime: true },
    });

    const decision = decidePunch(existing, now);

    switch (decision.action) {
      case 'BLOCKED':
        return {
          ok: false,
          code: 'BLOCKED',
          employeeName: employee.name,
          error: `${employee.name} is marked ${decision.status.replace(/_/g, ' ').toLowerCase()} today. A manager must change that in Manual Attendance first.`,
        };

      case 'TOO_SOON':
        return { ok: true, outcome: 'ALREADY_RECORDED', employee: person, at: decision.lastPunch.toISOString() };

      case 'CREATE_CHECK_IN':
        await prisma.manualAttendanceEntry.create({
          data: {
            employeeId: employee.id,
            date,
            status: 'PRESENT',
            checkInTime: now,
            source: 'FACE_SCAN',
            enteredByUserId: session.user.id,
          },
        });
        return { ok: true, outcome: 'CHECKED_IN', employee: person, at: now.toISOString() };

      case 'SET_CHECK_IN':
        await prisma.manualAttendanceEntry.update({
          where: { employeeId_date: { employeeId: employee.id, date } },
          data: decision.keepStatus
            ? { checkInTime: now, enteredByUserId: session.user.id }
            : {
                status: 'PRESENT',
                checkInTime: now,
                checkOutTime: null,
                source: 'FACE_SCAN',
                uploadBatchId: null,
                enteredByUserId: session.user.id,
              },
        });
        return { ok: true, outcome: 'CHECKED_IN', employee: person, at: now.toISOString() };

      case 'SET_CHECK_OUT':
        await prisma.manualAttendanceEntry.update({
          where: { employeeId_date: { employeeId: employee.id, date } },
          data: { checkOutTime: now, enteredByUserId: session.user.id },
        });
        return {
          ok: true,
          outcome: decision.isUpdate ? 'CHECK_OUT_UPDATED' : 'CHECKED_OUT',
          employee: person,
          at: now.toISOString(),
        };
    }
  } catch (err) {
    return { ok: false, code: 'ERROR', error: errorMessage(err) };
  }
}

// ─── Enrolment ──────────────────────────────────────────────────────────────

export async function enrollFace(
  employeeId: string,
  rawSamples: unknown,
  consentGiven: boolean,
): Promise<SimpleResult> {
  try {
    if (consentGiven !== true) {
      return { ok: false, error: "Confirm that the employee has agreed to their face data being stored." };
    }
    if (!Array.isArray(rawSamples)) return { ok: false, error: 'No face samples received.' };
    if (rawSamples.length < ENROLL_MIN_SAMPLES || rawSamples.length > ENROLL_MAX_SAMPLES) {
      return { ok: false, error: `Capture between ${ENROLL_MIN_SAMPLES} and ${ENROLL_MAX_SAMPLES} samples.` };
    }
    const samples: number[][] = [];
    for (const raw of rawSamples) {
      const d = parseDescriptor(raw);
      if (!d) return { ok: false, error: 'A face sample was invalid. Please capture again.' };
      samples.push(d);
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, name: true, storeId: true, status: true },
    });
    if (!employee) return { ok: false, error: 'Employee not found.' };

    const session = await requireAuth('attendance:faceEnroll', { storeId: employee.storeId });
    const loaded = await loadFaceStore(session, employee.storeId);
    if ('error' in loaded) return { ok: false, error: loaded.error };
    if (employee.status !== 'ACTIVE') return { ok: false, error: 'Only active employees can be enrolled.' };

    if (!samplesAreConsistent(samples)) {
      return { ok: false, error: 'The captures do not look like the same person. Please start again with one person in front of the camera.' };
    }

    // Refuse to enrol a face that already belongs to a different employee in this store.
    const others = await prisma.faceTemplate.findMany({
      where: { employee: { storeId: employee.storeId, status: 'ACTIVE' }, employeeId: { not: employee.id } },
      select: { descriptor: true, employee: { select: { name: true } } },
    });
    for (const other of others) {
      for (const s of samples) {
        if (distance(s, other.descriptor) < DUPLICATE_THRESHOLD) {
          return { ok: false, error: `This face already looks like ${other.employee.name}, who is enrolled. Check you selected the right employee.` };
        }
      }
    }

    const replaced = await prisma.$transaction(async (tx) => {
      const del = await tx.faceTemplate.deleteMany({ where: { employeeId: employee.id } });
      await tx.faceTemplate.createMany({
        data: samples.map((descriptor) => ({
          employeeId: employee.id,
          descriptor,
          consentAt: new Date(),
          enrolledByUserId: session.user.id,
        })),
      });
      return del.count;
    });

    await writeAuditLog({
      userId: session.user.id,
      action: 'FACE_ENROLLED',
      targetType: 'Employee',
      targetId: employee.id,
      metadata: { samples: samples.length, replacedExisting: replaced > 0, consentRecorded: true },
    });

    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteFaceData(employeeId: string): Promise<SimpleResult> {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, storeId: true },
    });
    if (!employee) return { ok: false, error: 'Employee not found.' };

    const session = await requireAuth('attendance:faceEnroll', { storeId: employee.storeId });
    const store = await prisma.store.findUnique({ where: { id: employee.storeId }, select: { clientId: true } });
    if (session.user.role === 'CLIENT' && session.user.clientId !== store?.clientId) {
      return { ok: false, error: 'Not authorized for this store.' };
    }

    const del = await prisma.faceTemplate.deleteMany({ where: { employeeId: employee.id } });
    if (del.count > 0) {
      await writeAuditLog({
        userId: session.user.id,
        action: 'FACE_DATA_DELETED',
        targetType: 'Employee',
        targetId: employee.id,
        metadata: { samplesDeleted: del.count },
      });
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}
