import { describe, it, expect } from "vitest";
import { getTenantId, getTenantContext, runInTenantContext } from "../src/tenant-context.js";

describe("tenant-context", () => {
  it("throws when accessed without context", () => {
    expect(() => getTenantId()).toThrow("No tenant context");
    expect(() => getTenantContext()).toThrow("No tenant context");
  });

  it("returns tenantId when in context", () => {
    runInTenantContext(
      { tenantId: "test-123", userId: "user-1", isSuperAdmin: false },
      () => { expect(getTenantId()).toBe("test-123"); },
    );
  });

  it("returns full context", () => {
    runInTenantContext(
      { tenantId: "t-1", userId: "u-1", isSuperAdmin: true },
      () => {
        const ctx = getTenantContext();
        expect(ctx.tenantId).toBe("t-1");
        expect(ctx.userId).toBe("u-1");
        expect(ctx.isSuperAdmin).toBe(true);
      },
    );
  });

  it("isolates nested contexts", () => {
    runInTenantContext(
      { tenantId: "outer", userId: "u", isSuperAdmin: false },
      () => {
        expect(getTenantId()).toBe("outer");
        runInTenantContext(
          { tenantId: "inner", userId: "u", isSuperAdmin: false },
          () => { expect(getTenantId()).toBe("inner"); },
        );
        expect(getTenantId()).toBe("outer");
      },
    );
  });

  it("context is available in async operations", async () => {
    await runInTenantContext(
      { tenantId: "async-test", userId: "u", isSuperAdmin: false },
      async () => {
        await new Promise((r) => setTimeout(r, 10));
        expect(getTenantId()).toBe("async-test");
      },
    );
  });
});
