import { AsyncLocalStorage } from "node:async_hooks";

export interface BpoContext {
  partnerId: string;
  smeId: string;
  smeName: string;
  tenantId: string;
}

const store = new AsyncLocalStorage<BpoContext>();

export function runWithBpoContext<T>(ctx: BpoContext, fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    store.run(ctx, () => {
      fn().then(resolve, reject);
    });
  });
}

export function getBpoContext(): BpoContext {
  const ctx = store.getStore();
  if (!ctx) throw new Error("getBpoContext called outside a BPO request");
  return ctx;
}

export function tryGetBpoContext(): BpoContext | null {
  return store.getStore() ?? null;
}
