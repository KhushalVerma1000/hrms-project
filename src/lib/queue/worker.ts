/**
 * SmartOffice command queue worker.
 *
 * Processes SmartOfficeCommand rows, dispatching each to the appropriate
 * SmartOffice endpoint with retry/backoff logic.
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
 * Dispatches a single SmartOfficeCommand to the appropriate endpoint.
 */
export async function dispatchCommand(cmd: SmartOfficeCommand): Promise<void> {
  const payload = cmd.payload as Record<string, unknown>;

  await prisma.smartOfficeCommand.update({
    where: { id: cmd.id },
    data: { status: 'IN_PROGRESS', lastAttemptAt: new Date() },
  });

  try {
    let result;

    switch (cmd.commandType) {
      case 'ADD_EMPLOYEE':
        result = await so.addEmployee(payload as Parameters<typeof so.addEmployee>[0]);
        break;
      case 'UPLOAD_USER':
        result = await so.uploadUser(payload as Parameters<typeof so.uploadUser>[0]);
        break;
      case 'DELETE_USER':
        result = await so.deleteUser(payload as Parameters<typeof so.deleteUser>[0]);
        break;
      case 'DELETE_EMPLOYEE':
        result = await so.deleteEmployee(payload as Parameters<typeof so.deleteEmployee>[0]);
        break;
      case 'ADD_BIOMETRIC':
        result = await so.addBiometricDevice(payload as Parameters<typeof so.addBiometricDevice>[0]);
        break;
      case 'DELETE_BIOMETRIC':
        result = await so.deleteBiometricDevice(payload as Parameters<typeof so.deleteBiometricDevice>[0]);
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
        result = await so.blockUserInBiometric(payload as Parameters<typeof so.blockUserInBiometric>[0]);
        break;
      case 'SET_USER_EXPIRATION':
        result = await so.setUserExpiration(payload as Parameters<typeof so.setUserExpiration>[0]);
        break;
      case 'CLEAR_LOGS':
        result = await so.clearAllLogsFromDevice(payload as Parameters<typeof so.clearAllLogsFromDevice>[0]);
        break;
      case 'CLEAR_LOGS_BY_TIME':
        result = await so.clearLogsFromDeviceByTime(payload as Parameters<typeof so.clearLogsFromDeviceByTime>[0]);
        break;
      case 'TRIGGER_ENROLLMENT':
        result = await so.triggerUserOnlineEnrollment(payload as Parameters<typeof so.triggerUserOnlineEnrollment>[0]);
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
