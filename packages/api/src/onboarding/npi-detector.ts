// ── NPI Detector — Regex detection for SSN + account numbers ────────────

export interface NpiDetectionResult {
  detected: boolean;
  matchCount: number;
  types: string[];
}

// SSN patterns: 123-45-6789, 123 45 6789, 123456789
const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_SPACED = /\b\d{3}\s\d{2}\s\d{4}\b/g;
const SSN_UNDASHED = /\b(?<!\d)\d{9}(?!\d)\b/g;

// Account numbers: 10+ consecutive digits
const ACCOUNT_NUMBER = /\b\d{10,}\b/g;

export function detectNpi(text: string): NpiDetectionResult {
  const types: string[] = [];
  let matchCount = 0;

  const ssnDashed = text.match(SSN_DASHED);
  if (ssnDashed) {
    matchCount += ssnDashed.length;
    if (!types.includes("SSN")) types.push("SSN");
  }

  const ssnSpaced = text.match(SSN_SPACED);
  if (ssnSpaced) {
    matchCount += ssnSpaced.length;
    if (!types.includes("SSN")) types.push("SSN");
  }

  // For undashed SSN, exclude matches already counted as account numbers
  // (10+ digits). We match exactly 9-digit sequences.
  const ssnUndashed = text.match(SSN_UNDASHED);
  if (ssnUndashed) {
    matchCount += ssnUndashed.length;
    if (!types.includes("SSN")) types.push("SSN");
  }

  const accountNums = text.match(ACCOUNT_NUMBER);
  if (accountNums) {
    matchCount += accountNums.length;
    if (!types.includes("AccountNumber")) types.push("AccountNumber");
  }

  return {
    detected: matchCount > 0,
    matchCount,
    types,
  };
}
