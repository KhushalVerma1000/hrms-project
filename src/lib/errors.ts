/**
 * Typed error classes for the HRMS platform.
 * Use these instead of plain Error so callers can distinguish failure modes.
 */

export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_ERROR';
  constructor(message = 'You do not have permission to perform this action') {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export class ValidationError extends Error {
  readonly code = 'VALIDATION_ERROR';
  readonly fields?: Record<string, string[]>;
  constructor(message: string, fields?: Record<string, string[]>) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class SmartOfficeError extends Error {
  readonly code = 'SMARTOFFICE_ERROR';
  readonly isTerminal: boolean;
  constructor(message: string, isTerminal = false) {
    super(message);
    this.name = 'SmartOfficeError';
    this.isTerminal = isTerminal;
  }
}

export class QueueError extends Error {
  readonly code = 'QUEUE_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'QueueError';
  }
}

export class NotFoundError extends Error {
  readonly code = 'NOT_FOUND';
  constructor(resource: string, id?: string) {
    super(id ? `${resource} with id '${id}' not found` : `${resource} not found`);
    this.name = 'NotFoundError';
  }
}

/**
 * Serialise any error to a plain user-facing message string.
 * SmartOffice error messages are passed through verbatim (they are already
 * human-readable plain English per the spec).
 */
export function toUserMessage(error: unknown): string {
  if (error instanceof SmartOfficeError) return error.message;
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof ValidationError) return error.message;
  if (error instanceof NotFoundError) return error.message;
  if (error instanceof Error) return error.message;
  return 'An unexpected error occurred';
}
