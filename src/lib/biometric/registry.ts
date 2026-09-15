/**
 * Registry — resolves a `BiometricProviderConfig` DB row to a live
 * `BiometricProvider` adapter instance. This is what makes provider
 * selection a per-device *data* decision instead of a *code* decision
 * (Section 2.2 of the spec): onboarding a new vendor means implementing its
 * adapter once, adding its enum value + a config row — zero changes here or
 * to any call site.
 *
 * `facade.ts` is the only intended caller of this module.
 */

import { prisma } from '@/lib/prisma';
import { NotFoundError } from '@/lib/errors';
import type { BiometricProviderConfig } from '@prisma/client';
import type { BiometricProvider } from './types';
import { SmartOfficeAdapter } from './adapters/smartoffice-adapter';
import { ManualAdapter } from './adapters/manual-adapter';

// Adapter instances are cheap, stateless wrappers (no open connections), but
// re-created per config lookup they'd still be one `new` per call — cache by
// config id so repeated facade calls in a single request/worker tick reuse
// the same instance.
const adapterCache = new Map<string, BiometricProvider>();

/** Pure factory — DB-independent, easy to unit test on its own. */
export function buildAdapter(config: BiometricProviderConfig): BiometricProvider {
  switch (config.type) {
    case 'SMARTOFFICE':
      return new SmartOfficeAdapter(config);
    case 'MANUAL':
      return new ManualAdapter(config);
    default: {
      // Exhaustiveness guard: if BiometricProviderType grows a new value
      // (Patch D) before its adapter is registered here, fail loudly at the
      // resolution point rather than silently misrouting calls.
      const exhaustiveCheck: never = config.type;
      throw new Error(
        `No adapter registered for biometric provider type "${String(exhaustiveCheck)}" ` +
          `(config "${config.label}", id ${config.id}). Add a case in registry.ts.`,
      );
    }
  }
}

export function resolveProvider(config: BiometricProviderConfig): BiometricProvider {
  const cached = adapterCache.get(config.id);
  if (cached) return cached;
  const adapter = buildAdapter(config);
  adapterCache.set(config.id, adapter);
  return adapter;
}

/** Resolves the provider a given Device is wired to. */
export async function getProviderForDevice(
  deviceId: string,
): Promise<{ provider: BiometricProvider; config: BiometricProviderConfig }> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: { provider: true },
  });
  if (!device) throw new NotFoundError('Device', deviceId);
  return { provider: resolveProvider(device.provider), config: device.provider };
}

/**
 * Resolves a provider by its BiometricProviderConfig id directly — for
 * operations that aren't scoped to one Device (e.g. registering a brand-new
 * device, which by definition has no Device row yet; or SmartOffice's
 * AddEmployee/DeleteEmployee, which are Location-level, not device-level).
 */
export async function getProviderById(
  providerId: string,
): Promise<{ provider: BiometricProvider; config: BiometricProviderConfig }> {
  const config = await prisma.biometricProviderConfig.findUnique({ where: { id: providerId } });
  if (!config) throw new NotFoundError('BiometricProviderConfig', providerId);
  return { provider: resolveProvider(config), config };
}

/**
 * Resolves the org's default provider — today effectively always the single
 * backfilled SmartOffice config (see migration 20260904090000). Callers that
 * don't yet have a principled per-store/per-device provider to resolve
 * against (see facade.ts doc comment) fall back to this.
 */
export async function getDefaultProvider(): Promise<{
  provider: BiometricProvider;
  config: BiometricProviderConfig;
}> {
  const config = await prisma.biometricProviderConfig.findFirst({ where: { isDefault: true } });
  if (!config) {
    throw new Error(
      'No default BiometricProviderConfig configured — expected exactly one row with isDefault: true.',
    );
  }
  return { provider: resolveProvider(config), config };
}
