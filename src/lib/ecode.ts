import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

// ─────────────────────────────────────────────────────────────────────────────
// E-Code v2 format
// ─────────────────────────────────────────────────────────────────────────────
//
//   [Client:2][Brand:2][Store:2][Serial:3][Check:1]  =  10 digits
//    10-99     10-99    10-99   100-999    0-9
//
// The first 9 digits are the same segments as before (never leading-zero —
// see the audit notes below). The 10th digit is a Luhn check digit computed
// over those 9, making every code self-verifying against typos/transposition
// with zero DB lookups — isValidChecksum() below. verifyEmployeeCode() goes
// one step further and confirms the segments actually resolve to real,
// *consistent* Client/WarehouseType/Store rows (catches a well-formed but
// wrong code, which a checksum alone can't).
//
// This is now the ONLY format — v1 (9 digits, no check digit) is retired.

const SEGMENT_LENGTH = 2;
const SERIAL_LENGTH = 3;
const PAYLOAD_LENGTH = SEGMENT_LENGTH * 3 + SERIAL_LENGTH; // 9
export const EMPLOYEE_CODE_LENGTH = PAYLOAD_LENGTH + 1; // 10
export const EMPLOYEE_SERIAL_MAX = 999;
/** Below this many slots left, callers can surface a "nearing capacity" warning. */
export const EMPLOYEE_SERIAL_WARN_THRESHOLD = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Luhn check digit
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Computes the Luhn check digit for a numeric-digit payload (any length).
 * Standard credit-card checksum algorithm — catches the two most common
 * transcription errors: a single mistyped digit, and two adjacent digits
 * swapped. Not cryptographic; just cheap, universal, and well understood.
 */
function luhnCheckDigit(payload: string): string {
  let sum = 0;
  const digits = payload.split('').reverse();
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[i]);
    // The digit immediately left of where the check digit will sit is
    // doubled, then every other one going left from there.
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return String((10 - (sum % 10)) % 10);
}

function assembleCode(clientCode: string, brandCode: string, storeCode: string, paddedSerial: string): string {
  const payload = `${clientCode}${brandCode}${storeCode}${paddedSerial}`;
  return payload + luhnCheckDigit(payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal atomic increment helper (Client / WarehouseType / Store codes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically increments a Counter row and returns the new value, zero-padded
 * to the specified number of digits. Creates the row if it doesn't exist.
 *
 * AUDIT NOTE (leading zeros): a brand-new counter is inserted starting at
 * 10^(padLength-1) — e.g. 10 for padLength=2 — not 1, so the FIRST code
 * issued under a fresh counter key is "10", never "01". This matters most
 * for `storeCode:{clientId}`, a new counter key created the moment each
 * Client is created. Existing counters are unaffected — the ON CONFLICT
 * branch still just increments by 1.
 */
async function atomicIncrement(
  tx: TransactionClient,
  counterId: string,
  padLength: number,
): Promise<string> {
  const floor = Math.pow(10, padLength - 1);
  const result = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (id, value)
    VALUES (${counterId}, ${floor})
    ON CONFLICT (id)
    DO UPDATE SET value = "Counter".value + 1
    RETURNING value
  `;
  const value = result[0]?.value;
  if (value === undefined) throw new Error(`Counter ${counterId} returned no value`);
  if (value > Math.pow(10, padLength) - 1) {
    throw new Error(
      `Counter '${counterId}' has exceeded max capacity (${padLength} digits). ` +
      'Widen the code length before onboarding more records.',
    );
  }
  return String(value).padStart(padLength, '0');
}

// ─────────────────────────────────────────────────────────────────────────────
// Public code-assignment functions
// ─────────────────────────────────────────────────────────────────────────────

/** Assigns the next sequential 2-digit Client code. Call inside a transaction at Client creation. */
export async function assignClientCode(tx: TransactionClient): Promise<string> {
  return atomicIncrement(tx, 'client', SEGMENT_LENGTH);
}

/** Assigns the next sequential 2-digit WarehouseType code. Call inside a transaction at creation. */
export async function assignWarehouseTypeCode(tx: TransactionClient): Promise<string> {
  return atomicIncrement(tx, 'warehouseType', SEGMENT_LENGTH);
}

/**
 * Assigns the next sequential 2-digit Store code for a given client.
 * Unique within the client — different clients have independent sequences.
 */
export async function assignStoreCode(tx: TransactionClient, clientId: string): Promise<string> {
  return atomicIncrement(tx, `storeCode:${clientId}`, SEGMENT_LENGTH);
}

/**
 * Generates a fully-assembled 10-digit Employee Code for a new hire.
 * Format: [Client:2][Brand:2][Store:2][Serial:3][Check:1]
 * Example: 10 + 10 + 10 + 100 + check → "1010100109"
 *
 * Atomic and race-condition-safe: nextEmployeeSerial is incremented via
 * Prisma's atomic UPDATE ... SET x = x + 1 (a single Postgres statement).
 *
 * EDGE CASE — store hits capacity (Serial would exceed 999, i.e. 900
 * employees already issued at this store): the whole transaction is rolled
 * back (Prisma auto-rolls-back on a thrown error inside $transaction, so
 * the increment itself is undone — no serials are burned) and a clear,
 * actionable error is thrown instead of silently wrapping around or
 * truncating, either of which would produce a DUPLICATE code. There is no
 * automatic recovery: a 2-digit Store code is unique only within its
 * Client, so the fix is a business decision, not a format change — create
 * an additional Store row for the same physical site (it gets its own
 * fresh 2-digit code and thus a fresh 900-slot Serial range). See
 * EMPLOYEE_SERIAL_WARN_THRESHOLD for surfacing this before it's hit.
 *
 * @param storeId - The store where the employee is being onboarded.
 * @param tx      - Must be called inside a Prisma transaction.
 */
export async function generateEmployeeCode(tx: TransactionClient, storeId: string): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { nextEmployeeSerial: { increment: 1 } },
    select: {
      code: true,
      name: true,
      nextEmployeeSerial: true,
      client: { select: { code: true } },
      warehouseType: { select: { code: true } },
    },
  });

  // nextEmployeeSerial is the value AFTER increment; subtract 1 to get the consumed value
  const serial = store.nextEmployeeSerial - 1;
  if (serial > EMPLOYEE_SERIAL_MAX) {
    throw new Error(
      `"${store.name}" has reached its maximum of ${EMPLOYEE_SERIAL_MAX - 99} employees ` +
      `(Serial ${EMPLOYEE_SERIAL_MAX} reached). This store's code is full — create an ` +
      'additional Store entry for this location to keep onboarding; each store gets its own ' +
      'independent serial range.',
    );
  }
  const paddedSerial = String(serial).padStart(SERIAL_LENGTH, '0');

  return assembleCode(store.client.code, store.warehouseType.code, store.code, paddedSerial);
}

/**
 * Non-consuming preview of the code the NEXT employee at this store would
 * get, without touching the counter. Used by the onboarding wizard's live
 * preview — must stay in lockstep with generateEmployeeCode's assembly
 * logic (both call assembleCode) or the previewed code and the committed
 * code will silently diverge.
 */
export function previewEmployeeCode(store: {
  code: string;
  nextEmployeeSerial: number;
  client: { code: string };
  warehouseType: { code: string };
}): { code: string | null; slotsRemaining: number; nearCapacity: boolean } {
  const slotsRemaining = Math.max(0, EMPLOYEE_SERIAL_MAX - store.nextEmployeeSerial + 1);
  // Store is full: there is no valid next code (a 4-digit serial would
  // silently produce a malformed 11-digit code), so return null.
  const code =
    slotsRemaining === 0
      ? null
      : assembleCode(
          store.client.code,
          store.warehouseType.code,
          store.code,
          String(store.nextEmployeeSerial).padStart(SERIAL_LENGTH, '0'),
        );
  return { code, slotsRemaining, nearCapacity: slotsRemaining <= EMPLOYEE_SERIAL_WARN_THRESHOLD };
}

// ─────────────────────────────────────────────────────────────────────────────
// Verification
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedEmployeeCode {
  clientCode: string;
  brandCode: string;
  storeCode: string;
  serial: number;
  checkDigit: string;
}

/** Pure structural decode — no DB access. Throws if the code isn't 10 digits. */
export function decodeEmployeeCode(code: string): DecodedEmployeeCode {
  if (!/^\d{10}$/.test(code)) {
    throw new Error(`"${code}" is not a 10-digit E-Code.`);
  }
  return {
    clientCode: code.slice(0, 2),
    brandCode: code.slice(2, 4),
    storeCode: code.slice(4, 6),
    serial: Number(code.slice(6, 9)),
    checkDigit: code.slice(9, 10),
  };
}

/**
 * Format-only validation: right length, digits only, and the Luhn check
 * digit matches. Zero DB access — safe to run on every keystroke, CSV row,
 * or SmartOffice punch as a first-pass filter before any lookup.
 */
export function isValidChecksum(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  const payload = code.slice(0, 9);
  return luhnCheckDigit(payload) === code.slice(9, 10);
}

export type VerifyEmployeeCodeResult =
  | { valid: true; decoded: DecodedEmployeeCode; client: string; brand: string; store: string }
  | { valid: false; reason: string; decoded?: DecodedEmployeeCode };

/**
 * Full verification: checksum, THEN confirms the segments resolve to real
 * rows that actually relate to each other — the Client exists, the Brand
 * exists, and the Store exists *under that Client and that Brand*. A code
 * can pass isValidChecksum() and still fail here (e.g. a real client code
 * with a store code that belongs to a different client) — that's the
 * "well-formed but wrong" case a checksum alone can't catch.
 */
export async function verifyEmployeeCode(code: string): Promise<VerifyEmployeeCodeResult> {
  if (!/^\d{10}$/.test(code)) {
    return { valid: false, reason: `Not a 10-digit code (got ${code.length} characters).` };
  }
  if (!isValidChecksum(code)) {
    return { valid: false, reason: 'Check digit does not match — likely a mistyped or transposed digit.' };
  }

  const decoded = decodeEmployeeCode(code);

  const store = await prisma.store.findFirst({
    where: { code: decoded.storeCode, client: { code: decoded.clientCode }, warehouseType: { code: decoded.brandCode } },
    select: { name: true, client: { select: { name: true } }, warehouseType: { select: { name: true } } },
  });

  if (!store) {
    return {
      valid: false,
      reason:
        `Checksum is valid, but no Store "${decoded.storeCode}" exists under Client ` +
        `"${decoded.clientCode}" / Brand "${decoded.brandCode}" together — one of these ` +
        'segments is wrong even though the code looks well-formed.',
      decoded,
    };
  }

  return { valid: true, decoded, client: store.client.name, brand: store.warehouseType.name, store: store.name };
}
