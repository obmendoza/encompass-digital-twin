// ── Document Processor Pipeline — Registry + Interface ──────────────────

import type { ProcessorInput, ProcessorOutput } from "@twin/core";

export interface DocumentProcessor {
  name: string;
  supportedFormats: string[];
  process(input: ProcessorInput): Promise<ProcessorOutput>;
}

const registry = new Map<string, DocumentProcessor>();

export function registerProcessor(processor: DocumentProcessor): void {
  registry.set(processor.name, processor);
}

export function getProcessor(name: string): DocumentProcessor | undefined {
  return registry.get(name);
}

export function listProcessors(): string[] {
  return Array.from(registry.keys());
}
