/**
 * SmartOffice connection diagnostic.
 *
 * Answers three separate questions that "is it working?" actually bundles together:
 *   1. Is SMARTOFFICE_BASE_URL reachable at all? (network/DNS/firewall)
 *   2. Is SMARTOFFICE_API_KEY valid? (auth)
 *   3. Is the response shape what we expect? (API version/contract sanity)
 *
 * Uses GetDeviceCommands as the probe — it's a GET, mutates nothing, and
 * SmartOffice's own docs show it returns a clean, typed error for a bad key
 * ("API key is not correct") vs a clean success shape, which is exactly the
 * signal we need to tell these three failure modes apart.
 */

import { getDeviceCommands, formatSmartOfficeDate } from './client';
import { SMARTOFFICE_BASE_URL, SMARTOFFICE_API_KEY } from '@/lib/config';

export interface ConnectionTestResult {
  ok: boolean;
  reachable: boolean;
  apiKeyValid: boolean;
  latencyMs: number | null;
  baseUrlConfigured: boolean;
  apiKeyConfigured: boolean;
  message: string;
  raw?: unknown;
}

export async function testSmartOfficeConnection(): Promise<ConnectionTestResult> {
  const baseUrlConfigured = !!SMARTOFFICE_BASE_URL;
  const apiKeyConfigured = !!SMARTOFFICE_API_KEY;

  if (!baseUrlConfigured || !apiKeyConfigured) {
    return {
      ok: false,
      reachable: false,
      apiKeyValid: false,
      latencyMs: null,
      baseUrlConfigured,
      apiKeyConfigured,
      message: !baseUrlConfigured
        ? 'SMARTOFFICE_BASE_URL is not set in the environment.'
        : 'SMARTOFFICE_API_KEY is not set in the environment.',
    };
  }

  const today = formatSmartOfficeDate(new Date());
  const start = Date.now();

  try {
    const result = await getDeviceCommands({ FromDate: today, ToDate: today });
    const latencyMs = Date.now() - start;

    // normalizeResponse (in client.ts) already collapses SmartOffice's
    // inconsistent shapes into { ok, message, data } — a bad key surfaces
    // as ok:false with SmartOffice's own "API key is not correct" message.
    if (!result.ok) {
      const isAuthError = /api key/i.test(result.message || '');
      return {
        ok: false,
        reachable: true, // we got A response, just not a successful one
        apiKeyValid: !isAuthError,
        latencyMs,
        baseUrlConfigured,
        apiKeyConfigured,
        message: isAuthError
          ? `Reached SmartOffice, but the API key was rejected: "${result.message}"`
          : `Reached SmartOffice, but got an error: "${result.message}"`,
        raw: result,
      };
    }

    return {
      ok: true,
      reachable: true,
      apiKeyValid: true,
      latencyMs,
      baseUrlConfigured,
      apiKeyConfigured,
      message: `Connected successfully in ${latencyMs}ms. Found ${result.data?.length ?? 0} device command(s) issued today.`,
      raw: result,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    // Network-level failure (DNS, connection refused, timeout) — thrown before
    // we ever got an HTTP response to normalize, so this is a reachability problem.
    return {
      ok: false,
      reachable: false,
      apiKeyValid: false,
      latencyMs,
      baseUrlConfigured,
      apiKeyConfigured,
      message: `Could not reach ${SMARTOFFICE_BASE_URL}: ${err.message}. Check the base URL, network access, and that SmartOffice's service is actually running.`,
    };
  }
}
