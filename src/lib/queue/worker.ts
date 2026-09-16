/**
 * SmartOffice command queue worker.
 *
 * Processes SmartOfficeCommand rows, dispatching each to the appropriate
 * biometric provider (via the facade — Patch C of the biometric provider
 * modularization spec) with retry/backoff logic.
 *
 * Six command types (ADD_LOCATION, ADD_COMPANY, ADD_DEPARTMENT,
 * ADD_DESIGNATION, ADD_GRADE, ADD_TEAM) are deliberately NOT routed through
 * the facade — they're SmartOffice account/taxonomy setup calls with no
 * equivalent concept for a device vendor, and stay directly on
 * `smartoffice/client.ts`. See the doc comment at the top of
 * `src/lib/biometric/types.ts` for the full rationale.
 *
 * This module is imported by the standalone worker process (src/worker/index.ts)
 * and should NOT be imported inside Next.js App Router pages/routes.
 */

import { prisma } from '@/lib/prisma';
import {
  COMMAND_RETRY_BACKOFF_MS,
  COMMAND_MAX_ATTEMPTS,
  COMMAND_IN_PROGRESS_TIMEOUT_MS,
} from '@/lib/config';
import { SmartOfficeError } from '@/lib/errors';
import { isTerminalError } from '@/lib/smartoffice/types';
import * as so from '@/lib/smartoffice/client';
import * as facade from '@/lib/biometric/facade';
import { getDefaultProvider } from '@/lib/biometric/registry';
import type { BiometricResult } from '@/lib/biometric/types';
import type { SmartOfficeCommand } from '@prisma/client';

/** Compute the next retry timestamp based on attempt count. */
export function getNextAttemptAt(attemptNumber: number): Date {
  const delayMs = COMMAND_RETRY_BACKOFF_MS[attemptNumber] ?? COMMAND_RETRY_BACKOFF_MS.at(-1) ?? 60_000;
  return new Date(Date.now() + delayMs);
}

/**
 * On worker startup, recover any commands that were IN_PROGRESS but not resolved
 * (e.g. process crash after calling SmartOffice but before writing SUCCEEDED).
 */
export async function recoverStuckCommands(): Promise<void> {
  const cutoff = new Date(Date.now() - COMMAND_IN_PROGRESS_TIMEOUT_MS);
  const stuck = await prisma.smartOfficeCommand.findMany({
    where: {
      status: 'IN_PROGRESS',
      lastAttemptAt: { lt: cutoff },
    },
  });

  for (const cmd of stuck) {
    if (cmd.commandType === 'TRIGGER_ENROLLMENT') {
      console.warn(
        `[Worker] Stuck TRIGGER_ENROLLMENT command ${cmd.id} — leaving for manual review on Sync Issues screen`,
      );
      continue;
    }
    await prisma.smartOfficeCommand.update({
      where: { id: cmd.id },
      data: {
        status: 'PENDING',
        nextAttemptAt: new Date(),
      },
    });
    console.log(`[Worker] Recovered stuck command ${cmd.id} (${cmd.commandType})`);
  }
}

/**
 * Every dispatch path below — whether it goes through the facade
 * (BiometricResult) or straight to smartoffice/client.ts (SmartOfficeResult,
 * for the 6 taxonomy command types) — converges on this shape so the
 * success/failure handling further down stays a single code path, unchanged
 * from before this patch.
 */
function toLegacyResult(r: BiometricResult<unknown>): { ok: boolean; message: string } {
  return r.ok ? { ok: true, message: 'OK' } : { ok: false, message: r.message };
}

/**
 * Dispatches a single SmartOfficeCommand to the appropriate endpoint.
 */
export async function dispatchCommand(cmd: SmartOfficeCommand): Promise<void> {
  const payload = cmd.payload as Record<string, any>;

  await prisma.smartOfficeCommand.update({
    where: { id: cmd.id },
    data: { status: 'IN_PROGRESS', lastAttemptAt: new Date() },
  });

  try {
    let result: { ok: boolean; message: string };

    switch (cmd.commandType) {
      case 'ADD_EMPLOYEE': {
        const { config } = await getDefaultProvider();
        result = toLegacyResult(
          await facade.enrollEmployee(config.id, {
            staffCode: payload.StaffCode,
            staffName: payload.StaffName,
            gender: payload.Gender,
            status: payload.Status,
            companyShortName: payload.CompanySName,
            departmentShortName: payload.DepartmentSName,
            locationName: payload.Location,
            designation: payload.Designation,
            grade: payload.Grade,
            team: payload.Team,
            dateOfJoining: payload.DOJ,
            dateOfConfirmation: payload.DOC,
            dateOfBirth: payload.DOB,
            dateOfRelieving: payload.DOR,
          }),
        );
        break;
      }
      case 'UPLOAD_USER':
        result = toLegacyResult(
          await facade.uploadEmployeeToDeviceBySerials(payload.SerialNumber, {
            employeeCode: payload.EmployeeCode,
            employeeName: payload.EmployeeName,
            cardNumber: payload.CardNumber,
            verifyMode: payload.VerifyMode,
            isFaceUpload: payload.IsFaceUpload,
            isFingerprintUpload: payload.IsFPUpload,
            isCardUpload: payload.IsCardUpload,
            isBioPasswordUpload: payload.IsBioPasswordUpload,
          }),
        );
        break;
      case 'DELETE_USER':
        result = toLegacyResult(
          await facade.removeEmployeeFromDeviceBySerials(payload.SerialNumber, {
            employeeCode: payload.EmployeeCode,
          }),
        );
        break;
      case 'DELETE_EMPLOYEE': {
        const { config } = await getDefaultProvider();
        result = toLegacyResult(
          await facade.deleteEmployee(config.id, { employeeCode: payload.EmployeeCode }),
        );
        break;
      }
      case 'ADD_BIOMETRIC':
        result = toLegacyResult(
          await facade.addDeviceBySerial(payload.SerialNumber, { deviceName: payload.DeviceName }),
        );
        break;
      case 'DELETE_BIOMETRIC':
        // The Device row is deleted synchronously in the same transaction
        // that enqueues this command (see devices/actions.ts
        // deleteDeviceAction) — by dispatch time there's no Device row left
        // to resolve a provider from via SerialNumber, so providerId is
        // captured in the payload at enqueue time instead.
        if (!payload.providerId) {
          result = {
            ok: false,
            message:
              'DELETE_BIOMETRIC payload is missing providerId — this command was enqueued before ' +
              'Patch C and cannot be routed to a provider automatically. Resolve manually on the Sync Issues screen.',
          };
        } else {
          result = toLegacyResult(
            await facade.removeDeviceForProvider(payload.providerId, {
              serialNumber: payload.SerialNumber,
            }),
          );
        }
        break;
      case 'ADD_LOCATION':
        result = await so.addLocation(payload as Parameters<typeof so.addLocation>[0]);
        break;
      case 'ADD_COMPANY':
        result = await so.addCompany(payload as Parameters<typeof so.addCompany>[0]);
        break;
      case 'ADD_DEPARTMENT':
        result = await so.addDepartment(payload as Parameters<typeof so.addDepartment>[0]);
        break;
      case 'ADD_DESIGNATION':
        result = await so.addDesignation(payload as Parameters<typeof so.addDesignation>[0]);
        break;
      case 'ADD_GRADE':
        result = await so.addGrade(payload as Parameters<typeof so.addGrade>[0]);
        break;
      case 'ADD_TEAM':
        result = await so.addTeam(payload as Parameters<typeof so.addTeam>[0]);
        break;
      case 'BLOCK_USER':
      case 'UNBLOCK_USER':
        // Same SmartOffice endpoint handles both — the payload's BlockUser
        // field (0 = block, 1 = unblock) determines behavior.
        result = toLegacyResult(
          await facade.blockEmployeeBySerial(payload.SerialNumber, {
            employeeCode: payload.EmployeeCode,
            block: payload.BlockUser === 0,
          }),
        );
        break;
      case 'SET_USER_EXPIRATION':
        result = toLegacyResult(
          await facade.setEmployeeExpirationBySerial(payload.SerialNumber, {
            employeeCode: payload.EmployeeCode,
            expirationDate: payload.ExpirationDate,
          }),
        );
        break;
      case 'CLEAR_LOGS':
        result = toLegacyResult(await facade.clearAllLogsBySerial(payload.SerialNumber));
        break;
      case 'CLEAR_LOGS_BY_TIME':
        result = toLegacyResult(
          await facade.clearLogsByTimeBySerial(payload.SerialNumber, {
            startTime: payload.StartTime,
            endTime: payload.EndTime,
          }),
        );
        break;
      case 'TRIGGER_ENROLLMENT':
        result = toLegacyResult(
          await facade.triggerRemoteEnrollmentBySerial(payload.SerialNumber, {
            employeeCode: payload.EmployeeCode,
            employeeName: payload.EmployeeName,
            backupNumber: payload.backup_number,
          }),
        );
        break;
      default:
        throw new SmartOfficeError(`Unknown command type: ${cmd.commandType}`, true);
    }

    if (result.ok) {
      await prisma.smartOfficeCommand.update({
        where: { id: cmd.id },
        data: { status: 'SUCCEEDED', resolvedAt: new Date() },
      });
      console.log(`[Worker] ✅ Command ${cmd.id} (${cmd.commandType}) succeeded`);
    } else {
      await handleCommandFailure(cmd, result.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await handleCommandFailure(cmd, message);
  }
}

async function handleCommandFailure(
  cmd: SmartOfficeCommand,
  errorMessage: string,
): Promise<void> {
  const isTerminal = isTerminalError(errorMessage);
  const newAttempts = cmd.attempts + 1;

  if (isTerminal || newAttempts >= COMMAND_MAX_ATTEMPTS) {
    await prisma.smartOfficeCommand.update({
      where: { id: cmd.id },
      data: {
        status: 'FAILED',
        attempts: newAttempts,
        lastError: errorMessage,
        resolvedAt: new Date(),
      },
    });
    console.error(
      `[Worker] ❌ Command ${cmd.id} (${cmd.commandType}) FAILED ${
        isTerminal ? '(terminal rejection)' : '(max attempts exhausted)'
      }: ${errorMessage}`,
    );
  } else {
    const nextAttemptAt = getNextAttemptAt(newAttempts);
    await prisma.smartOfficeCommand.update({
      where: { id: cmd.id },
      data: {
        status: 'PENDING',
        attempts: newAttempts,
        lastError: errorMessage,
        nextAttemptAt,
      },
    });
    console.log(
      `[Worker] ⚠️ Command ${cmd.id} (${cmd.commandType}) failed, retry ${newAttempts}/${
        COMMAND_MAX_ATTEMPTS
      } at ${nextAttemptAt.toISOString()}: ${errorMessage}`,
    );
  }
}

/**
 * Single poll cycle: pick up to N pending commands and dispatch them.
 */
export async function pollAndProcess(batchSize = 10): Promise<number> {
  const now = new Date();

  const commands = await prisma.$queryRaw<SmartOfficeCommand[]>`
    SELECT * FROM "SmartOfficeCommand"
    WHERE status = 'PENDING'
    AND "nextAttemptAt" <= ${now}
    ORDER BY "nextAttemptAt" ASC
    LIMIT ${batchSize}
    FOR UPDATE SKIP LOCKED
  `;

  if (commands.length === 0) return 0;

  for (const cmd of commands) {
    try {
      await dispatchCommand(cmd);
    } catch (err) {
      console.error(`[Worker] Unexpected error dispatching command ${cmd.id}:`, err);
    }
  }

  return commands.length;
}
