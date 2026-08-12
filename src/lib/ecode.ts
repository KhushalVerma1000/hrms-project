import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

type TransactionClient = Prisma.TransactionClient;

// ─────────────────────────────────────────────────────────────────────────────
// Internal atomic increment helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically increments a Counter row and returns the new value, zero-padded
 * to the specified number of digits. Creates the row if it doesn't exist.
 *
 * Uses a raw SQL UPSERT to guarantee atomicity even under concurrent requests.
 */
async function atomicIncrement(
  tx: TransactionClient,
  counterId: string,
  padLength: number,
): Promise<string> {
  // Upsert + increment in one atomic statement
  const result = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" (id, value)
    VALUES (${counterId}, 1)
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

/**
 * Assigns the next sequential 2-digit Client code.
 * Call inside a Prisma transaction at Client creation time.
 */
export async function assignClientCode(tx: TransactionClient): Promise<string> {
  return atomicIncrement(tx, 'client', 2);
}

/**
 * Assigns the next sequential 2-digit WarehouseType code.
 * Call inside a Prisma transaction at WarehouseType creation time.
 */
export async function assignWarehouseTypeCode(
  tx: TransactionClient,
): Promise<string> {
  return atomicIncrement(tx, 'warehouseType', 2);
}

/**
 * Assigns the next sequential 2-digit Store code for a given client.
 * Unique within the client — different clients have independent sequences.
 * Call inside a Prisma transaction at Store creation time.
 */
export async function assignStoreCode(
  tx: TransactionClient,
  clientId: string,
): Promise<string> {
  return atomicIncrement(tx, `storeCode:${clientId}`, 2);
}

/**
 * Generates a fully-assembled 10-digit Employee Code for a new hire.
 *
 * Format: [ClientCode:2][WarehouseTypeCode:2][StoreCode:2][Serial:4]
 * Example: 01 + 01 + 01 + 0001 = "0101010001"
 *
 * This is atomic and race-condition-safe: the store's nextEmployeeSerial
 * is incremented via Prisma's atomic UPDATE ... SET x = x + 1, which
 * compiles to a single Postgres statement.
 *
 * @param storeId - The store where the employee is being onboarded.
 * @param tx      - Must be called inside a Prisma transaction.
 */
export async function generateEmployeeCode(
  tx: TransactionClient,
  storeId: string,
): Promise<string> {
  const store = await tx.store.update({
    where: { id: storeId },
    data: { nextEmployeeSerial: { increment: 1 } },
    select: {
      code: true,
      nextEmployeeSerial: true,
      client: { select: { code: true } },
      warehouseType: { select: { code: true } },
    },
  });

  // nextEmployeeSerial is the value AFTER increment; subtract 1 to get consumed value
  const serial = store.nextEmployeeSerial - 1;
  if (serial > 9999) {
    throw new Error(
      `Store '${storeId}' has exceeded 9,999 employees. ` +
      'Widen the Serial segment before onboarding more employees.',
    );
  }
  const paddedSerial = String(serial).padStart(4, '0');

  return `${store.client.code}${store.warehouseType.code}${store.code}${paddedSerial}`;
}
