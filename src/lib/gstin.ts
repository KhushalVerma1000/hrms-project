// GSTIN (India GST Identification Number) helpers — safe for server and client.
// Format: 2-digit state code + 10-char PAN + entity digit + 'Z' + check char (15 total).

const GSTIN_SHAPE = /^(0[1-9]|[1-2][0-9]|3[0-9])[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Standard GSTIN mod-36 checksum over the first 14 chars → expected 15th char. */
function checkChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = ALPHABET.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(v / 36) + (v % 36);
  }
  return ALPHABET[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin: string): boolean {
  return GSTIN_SHAPE.test(gstin) && checkChar(gstin.slice(0, 14)) === gstin[14];
}

/** Normalizes user input. Empty → null (field cleared). Returns an error string if malformed. */
export function parseGstin(input: string | null | undefined): { ok: true; value: string | null } | { ok: false; error: string } {
  const v = (input ?? '').replace(/\s+/g, '').toUpperCase();
  if (!v) return { ok: true, value: null };
  if (v.length !== 15) return { ok: false, error: 'GSTIN must be exactly 15 characters.' };
  if (!isValidGstin(v)) return { ok: false, error: 'This GSTIN is not valid — please re-check it for typos.' };
  return { ok: true, value: v };
}
