// ── RFC 6902 Guideline Patcher — replace/add/remove with stale-view protection ──

import { GuidelineRulesSchema } from "@twin/core";
import type { SpecificChange } from "@twin/core";
import type { GuidelineRules } from "@twin/core";

// ── JSON Pointer Helpers ─────────────────────────────────────────

/**
 * Parse a JSON Pointer path (e.g. "/income/maxDtiBack") into segments.
 */
function parsePointer(path: string): string[] {
  if (!path.startsWith("/")) {
    throw new Error(`Invalid JSON Pointer: must start with /`);
  }
  return path
    .slice(1)
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/**
 * Resolve a JSON Pointer path to the value at that location.
 * Returns undefined if the path does not exist.
 */
export function getAtPath(obj: unknown, path: string): unknown {
  const segments = parsePointer(path);
  let current: unknown = obj;

  for (const seg of segments) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }

  return current;
}

/**
 * Set a value at a JSON Pointer path, creating intermediate objects as needed.
 */
export function setAtPath(obj: unknown, path: string, value: unknown): void {
  const segments = parsePointer(path);
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current[seg] == null || typeof current[seg] !== "object") {
      current[seg] = {};
    }
    current = current[seg] as Record<string, unknown>;
  }

  current[segments[segments.length - 1]] = value;
}

/**
 * Delete the value at a JSON Pointer path.
 * Returns true if the value existed and was deleted.
 */
export function deleteAtPath(obj: unknown, path: string): boolean {
  const segments = parsePointer(path);
  let current = obj as Record<string, unknown>;

  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (current[seg] == null || typeof current[seg] !== "object") {
      return false;
    }
    current = current[seg] as Record<string, unknown>;
  }

  const lastSeg = segments[segments.length - 1];
  if (!(lastSeg in current)) return false;

  delete current[lastSeg];
  return true;
}

// ── Preview Patch ────────────────────────────────────────────────

export interface PatchResult {
  success: boolean;
  before: unknown;
  after: unknown;
  error?: string;
}

/**
 * Apply a SpecificChange to a guideline rules object without persisting.
 * Performs stale-view check, applies the operation, validates the result.
 */
export function previewPatch(
  guidelineRules: GuidelineRules,
  change: SpecificChange,
): PatchResult {
  const before = structuredClone(guidelineRules);
  const after = structuredClone(guidelineRules);

  try {
    // Stale-view check: if `from` is provided, verify current value matches
    if (change.from !== undefined) {
      const currentValue = getAtPath(after, change.path);
      if (!deepEqual(currentValue, change.from)) {
        return {
          success: false,
          before,
          after: before, // no change applied
          error: `Stale view: expected ${JSON.stringify(change.from)} at ${change.path}, found ${JSON.stringify(currentValue)}`,
        };
      }
    }

    // Apply operation
    switch (change.operation) {
      case "replace": {
        const exists = getAtPath(after, change.path) !== undefined;
        if (!exists) {
          // Schema evolution: treat replace on missing path as add
          setAtPath(after, change.path, change.to);
        } else {
          setAtPath(after, change.path, change.to);
        }
        break;
      }
      case "add": {
        setAtPath(after, change.path, change.to);
        break;
      }
      case "remove": {
        const deleted = deleteAtPath(after, change.path);
        if (!deleted) {
          return {
            success: false,
            before,
            after: before,
            error: `Path ${change.path} does not exist — nothing to remove`,
          };
        }
        break;
      }
      default:
        return {
          success: false,
          before,
          after: before,
          error: `Unsupported operation: ${change.operation}`,
        };
    }

    // Validate result against schema
    const validation = GuidelineRulesSchema.safeParse(after);
    if (!validation.success) {
      return {
        success: false,
        before,
        after,
        error: `Schema validation failed: ${validation.error.issues.map((i) => i.message).join("; ")}`,
      };
    }

    return { success: true, before, after };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, before, after: before, error: msg };
  }
}

// ── Deep Equal Helper ────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;

  if (typeof a === "object") {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => deepEqual(val, b[i]));
    }

    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;

    return aKeys.every((key) => deepEqual(aObj[key], bObj[key]));
  }

  return false;
}
