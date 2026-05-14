import type { LenderAdapter } from "./lender-adapter.js";

const KEBAB_CASE = /^[a-z][a-z0-9-]*$/;

const registry = new Map<string, LenderAdapter>();

export function registerAdapter(adapter: LenderAdapter): void {
  if (!KEBAB_CASE.test(adapter.adapterType)) {
    throw new Error(
      `adapterType must be kebab-case (matching ${KEBAB_CASE.source}); got "${adapter.adapterType}"`,
    );
  }
  registry.set(adapter.adapterType, adapter);
}

export function getAdapter(adapterType: string): LenderAdapter | null {
  return registry.get(adapterType) ?? null;
}

/** Test-only helper. Production code should never clear the registry. */
export function clearAdapterRegistryForTesting(): void {
  registry.clear();
}
