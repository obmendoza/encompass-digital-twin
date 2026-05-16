import { describe, test, expect } from "vitest";
import type { LoanContext } from "../src/services/doc-requirements.js";

describe("LoanContext HOI-validator fields", () => {
  test("interface includes all HOI-validator fields as optional keys", () => {
    // Type-level check: the interface compiles if we assign these optionally.
    const ctx: LoanContext = {
      incomeDocType: "Full Doc",
      borrowerType: "W2",
      citizenship: "US Citizen",
      isItin: undefined,
      llcOrLegalEntity: undefined,
      occupancy: "primary",
      state: "TX",
      county: undefined,
      usCredit: true,
      program: "FLEX",
      // HOI fields all optional:
      channel: "Wholesale",
      borrowerFullName: "Chad D Clark",
      entityName: undefined,
      subjectPropertyAddress: { line1: "172 Front St", city: "Rockport", state: "TX", zip: "78382" },
      noteDate: "2026-05-06",
      closingDate: "2026-06-01",
      unpaidPrincipalBalance: 100000,
      replacementCost: 1020000,
      lenderName: undefined,
      lenderLoanNumber: undefined,
    };
    expect(ctx.channel).toBe("Wholesale");
    expect(ctx.borrowerFullName).toBe("Chad D Clark");
    expect(ctx.subjectPropertyAddress?.city).toBe("Rockport");
  });
});
