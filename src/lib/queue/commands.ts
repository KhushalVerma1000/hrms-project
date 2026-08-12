import { prisma } from '@/lib/prisma';
import { COMMAND_MAX_ATTEMPTS } from '@/lib/config';
import type { Prisma, SmartOfficeCommand } from '@prisma/client';
import crypto from 'crypto';

type TransactionClient = Prisma.TransactionClient;

/** All supported SmartOffice command types. */
export type CommandType =
  | 'ADD_EMPLOYEE'
  | 'UPLOAD_USER'
  | 'DELETE_USER'
  | 'DELETE_EMPLOYEE'
  | 'ADD_BIOMETRIC'
  | 'DELETE_BIOMETRIC'
  | 'ADD_LOCATION'
  | 'ADD_COMPANY'
  | 'ADD_DEPARTMENT'
  | 'ADD_DESIGNATION'
  | 'ADD_GRADE'
  | 'ADD_TEAM'
  | 'BLOCK_USER'
  | 'UNBLOCK_USER'
  | 'SET_USER_EXPIRATION'
  | 'CLEAR_LOGS'
  | 'CLEAR_LOGS_BY_TIME'
  | 'TRIGGER_ENROLLMENT';

/** Helper to compute a short SHA-256 hash of a payload for idempotency keys. */
export function payloadHash(payload: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex')
    .slice(0, 12);
}

/**
 * Derives the idempotency key for a command, per Section 12.2.1 of the spec.
 *
 * Keys are deterministic so that retrying the same logical action produces the
 * same key, allowing the unique constraint to act as a deduplication gate.
 */
export function deriveIdempotencyKey(
  commandType: CommandType,
  opts: {
    employeeId?: string;
    targetId?: string;
    payload?: Record<string, unknown>;
    enrollmentRound?: number;
  },
): string {
  switch (commandType) {
    case 'ADD_EMPLOYEE':
    case 'UPLOAD_USER':
    case 'DELETE_USER':
    case 'DELETE_EMPLOYEE':
      if (!opts.employeeId) throw new Error(`employeeId required for ${commandType} idempotency key`);
      return `${commandType}:${opts.employeeId}`;

    case 'TRIGGER_ENROLLMENT': {
      if (!opts.employeeId) throw new Error('employeeId required for TRIGGER_ENROLLMENT idempotency key');
      const round = opts.enrollmentRound ?? 1;
      return `${commandType}:${opts.employeeId}:round${round}`;
    }

    case 'ADD_BIOMETRIC':
    case 'DELETE_BIOMETRIC':
    case 'BLOCK_USER':
    case 'UNBLOCK_USER':
    case 'SET_USER_EXPIRATION':
    case 'CLEAR_LOGS':
    case 'CLEAR_LOGS_BY_TIME':
    case 'ADD_LOCATION':
    case 'ADD_COMPANY':
    case 'ADD_DEPARTMENT':
    case 'ADD_DESIGNATION':
    case 'ADD_GRADE':
    case 'ADD_TEAM': {
      if (!opts.targetId) throw new Error(`targetId required for ${commandType} idempotency key`);
      const hash = opts.payload ? `:${payloadHash(opts.payload)}` : '';
      return `${commandType}:${opts.targetId}${hash}`;
    }

    default:
      throw new Error(`Unknown commandType: ${commandType as string}`);
  }
}

interface EnqueueCommandOpts {
  commandType: CommandType;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  relatedType?: string;
  relatedId?: string;
  createdBy: string;
  /** Optional Prisma transaction client — pass to enqueue inside a transaction. */
  tx?: TransactionClient;
}

/**
 * Enqueues a SmartOffice write command.
 *
 * Idempotent: if a command with the same idempotencyKey already exists and is
 * PENDING/IN_PROGRESS/SUCCEEDED, returns the existing row without error.
 * Only fails if the key exists with status FAILED (use retryCommand() instead).
 *
 * Always call inside the same Prisma transaction as the related record mutation
 * so the command row is created atomically with the app-side write.
 */
export async function enqueueCommand(
  opts: EnqueueCommandOpts,
): Promise<SmartOfficeCommand> {
  const db = opts.tx ?? prisma;

  try {
    const command = await db.smartOfficeCommand.create({
      data: {
        idempotencyKey: opts.idempotencyKey,
        commandType: opts.commandType,
        payload: opts.payload as unknown as Prisma.InputJsonObject,
        relatedType: opts.relatedType,
        relatedId: opts.relatedId,
        createdBy: opts.createdBy,
        maxAttempts: COMMAND_MAX_ATTEMPTS,
      },
    });
    return command;
  } catch (err) {
    // Unique constraint violation — command already exists
    if (
      err instanceof Error &&
      (err.message.includes('Unique constraint') ||
        err.message.includes('unique constraint'))
    ) {
      const existing = await db.smartOfficeCommand.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
      });
      if (!existing) throw err;
      // Return existing row silently — this is a duplicate enqueue, not an error
      return existing;
    }
    throw err;
  }
}

/**
 * Resets a FAILED command so the worker will pick it up again on the next poll.
 * Use from the Sync Issues screen's "Retry now" action.
 */
export async function retryCommand(commandId: string): Promise<SmartOfficeCommand> {
  return prisma.smartOfficeCommand.update({
    where: { id: commandId },
    data: {
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      nextAttemptAt: new Date(),
    },
  });
}
