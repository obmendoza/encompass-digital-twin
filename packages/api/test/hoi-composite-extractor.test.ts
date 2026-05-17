import { describe, test, expect } from "vitest";
import { CompositeHoiExtractor } from "../src/services/validators/hoi/composite-extractor.js";
import type { HoiFieldExtractor, DocumentRef, HoiExtractionResult } from "../src/services/validators/hoi/extractor.js";

class StubExtractor implements HoiFieldExtractor {
  constructor(private name: string, private hasCache: boolean) {}
  async canExtract(): Promise<boolean> { return this.hasCache; }
  async extract(): Promise<HoiExtractionResult> {
    if (!this.hasCache) throw new Error(`${this.name}: no cache`);
    return {
      fields: {} as never,
      source: this.name === "portal" ? "portal" : "llm-extractor",
      confidence: this.name === "portal" ? null : 0.85,
      extractedBy: this.name,
      extractionId: this.name,
      schemaVersion: 1,
    };
  }
}

const sampleDoc: DocumentRef = {
  tenantId: "t", loanId: "l", documentId: "d", category: "hoi-policy", storageUrl: "x",
};

describe("CompositeHoiExtractor", () => {
  test("extractorMode='auto', portal has extraction → uses portal", async () => {
    const portal = new StubExtractor("portal", true);
    const llm = new StubExtractor("llm", true);
    const composite = new CompositeHoiExtractor(portal, llm, "auto");
    const r = await composite.extract(sampleDoc);
    expect(r.source).toBe("portal");
  });

  test("extractorMode='auto', portal absent → uses LLM", async () => {
    const portal = new StubExtractor("portal", false);
    const llm = new StubExtractor("llm", true);
    const composite = new CompositeHoiExtractor(portal, llm, "auto");
    const r = await composite.extract(sampleDoc);
    expect(r.source).toBe("llm-extractor");
  });

  test("extractorMode='portal-only', portal absent → throws", async () => {
    const portal = new StubExtractor("portal", false);
    const llm = new StubExtractor("llm", true);
    const composite = new CompositeHoiExtractor(portal, llm, "portal-only");
    await expect(composite.extract(sampleDoc)).rejects.toThrow();
  });

  test("extractorMode='llm-only' → always uses LLM (ignores portal)", async () => {
    const portal = new StubExtractor("portal", true);
    const llm = new StubExtractor("llm", true);
    const composite = new CompositeHoiExtractor(portal, llm, "llm-only");
    const r = await composite.extract(sampleDoc);
    expect(r.source).toBe("llm-extractor");
  });
});
