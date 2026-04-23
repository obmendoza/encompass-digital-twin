import type { Loan } from "@twin/core";
import type { IngestionTransformer, ValidationResult } from "./transformer.js";

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object") current[parts[i]] = {};
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function coerce(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^\d+(\.\d+)?$/.test(value)) return Number(value);
    if (value.toLowerCase() === "true" || value === "Y") return true;
    if (value.toLowerCase() === "false" || value === "N") return false;
  }
  return value;
}

export class GenericJsonTransformer implements IngestionTransformer {
  name = "generic-json";

  transform(raw: unknown, fieldMap: Record<string, string>): Partial<Loan> {
    const result: Record<string, unknown> = {};
    for (const [sourceField, targetField] of Object.entries(fieldMap)) {
      if (targetField.includes("=")) {
        const [target, expr] = targetField.split("=").map((s) => s.trim());
        if (expr.includes("+")) {
          const parts = expr.split("+").map((p) => {
            p = p.trim();
            if (p.startsWith("'") && p.endsWith("'")) return p.slice(1, -1);
            return String(getNestedValue(raw, p) ?? "");
          });
          setNestedValue(result, target, parts.join(""));
        }
        continue;
      }
      const value = getNestedValue(raw, sourceField);
      if (value !== undefined) setNestedValue(result, targetField, coerce(value));
    }
    return result as Partial<Loan>;
  }

  validate(result: Partial<Loan>): ValidationResult {
    const errors: string[] = [];
    if (!result.borrower?.fullName) errors.push("borrower.fullName is required");
    if (!result.transaction?.loanAmount) errors.push("transaction.loanAmount is required");
    return { valid: errors.length === 0, errors };
  }
}
