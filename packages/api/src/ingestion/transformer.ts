import type { Loan } from "@twin/core";

export interface ValidationResult { valid: boolean; errors: string[]; }

export interface IngestionTransformer {
  name: string;
  transform(raw: unknown, fieldMap: Record<string, string>): Partial<Loan>;
  validate(result: Partial<Loan>): ValidationResult;
}

const registry = new Map<string, IngestionTransformer>();

export function registerTransformer(transformer: IngestionTransformer): void {
  registry.set(transformer.name, transformer);
}

export function getTransformer(name: string): IngestionTransformer | undefined {
  return registry.get(name);
}
