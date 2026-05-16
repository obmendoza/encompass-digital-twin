import type { DocumentRef, HoiExtractionResult, HoiFieldExtractor } from "./extractor.js";

export type ExtractorMode = "auto" | "portal-only" | "llm-only";

export class CompositeHoiExtractor implements HoiFieldExtractor {
  constructor(
    private portal: HoiFieldExtractor,
    private llm: HoiFieldExtractor,
    private mode: ExtractorMode,
  ) {}

  async canExtract(doc: DocumentRef): Promise<boolean> {
    if (this.mode === "portal-only") return this.portal.canExtract(doc);
    if (this.mode === "llm-only") return this.llm.canExtract(doc);
    return (await this.portal.canExtract(doc)) || (await this.llm.canExtract(doc));
  }

  async extract(doc: DocumentRef): Promise<HoiExtractionResult> {
    if (this.mode === "portal-only") return this.portal.extract(doc);
    if (this.mode === "llm-only") return this.llm.extract(doc);
    if (await this.portal.canExtract(doc)) return this.portal.extract(doc);
    return this.llm.extract(doc);
  }
}
