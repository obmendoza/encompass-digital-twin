// ── PII Redactor — regex + k-anonymity + per-record manifests ────

// ── Regex patterns ───────────────────────────────────────────────

const SSN_DASHED = /\b\d{3}-\d{2}-\d{4}\b/g;
const SSN_UNDASHED = /\b\d{9}\b/g;
const SSN_SPACED = /\b\d{3}\s\d{2}\s\d{4}\b/g;
const SSN_PARTIAL = /\bXXX-XX-\d{4}\b/gi;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const PHONE = /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g;
// 8-17 digits NOT preceded by '$'
const ACCOUNT_NUMBER = /(?<!\$)\b\d{8,17}\b/g;
const ADDRESS = /\b\d{1,6}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:St|Street|Ave|Avenue|Blvd|Boulevard|Dr|Drive|Ln|Lane|Rd|Road|Ct|Court|Way|Pl|Place|Cir|Circle)\b/gi;
const DOB_PATTERN = /\b(?:DOB|born|date\s+of\s+birth|birth\s*date|age)\s*[:\-]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi;

// ── redactText ───────────────────────────────────────────────────

export interface RedactTextResult {
  redacted: string;
  types: string[];
}

export function redactText(
  text: string,
  knownNames: string[] = [],
): RedactTextResult {
  const types: string[] = [];
  let result = text;
  let ssnCount = 0;

  // SSN dashed
  result = result.replace(SSN_DASHED, () => {
    ssnCount++;
    return "[REDACTED_SSN]";
  });

  // SSN spaced (before undashed to avoid overlap)
  result = result.replace(SSN_SPACED, () => {
    ssnCount++;
    return "[REDACTED_SSN]";
  });

  // SSN partial
  result = result.replace(SSN_PARTIAL, () => {
    ssnCount++;
    return "[REDACTED_SSN]";
  });

  // SSN undashed — careful not to match things already redacted
  result = result.replace(ACCOUNT_NUMBER, (match, offset) => {
    // Check if preceded by '$'
    if (offset > 0 && result[offset - 1] === "$") return match;

    if (match.length === 9) {
      ssnCount++;
      return "[REDACTED_SSN]";
    }
    types.push("ACCOUNT");
    return "[REDACTED_ACCOUNT]";
  });

  if (ssnCount > 0) types.push(`SSN:${ssnCount}`);

  // Email
  let emailFound = false;
  result = result.replace(EMAIL, () => {
    emailFound = true;
    return "[REDACTED_EMAIL]";
  });
  if (emailFound) types.push("EMAIL");

  // Phone
  let phoneFound = false;
  result = result.replace(PHONE, () => {
    phoneFound = true;
    return "[REDACTED_PHONE]";
  });
  if (phoneFound) types.push("PHONE");

  // Address
  let addrFound = false;
  result = result.replace(ADDRESS, () => {
    addrFound = true;
    return "[REDACTED_ADDRESS]";
  });
  if (addrFound) types.push("ADDRESS");

  // DOB
  let dobFound = false;
  result = result.replace(DOB_PATTERN, (full, dateGroup) => {
    dobFound = true;
    return full.replace(dateGroup, "[REDACTED_DOB]");
  });
  if (dobFound) types.push("DOB");

  // Known names
  const nameMap = new Map<string, string>();
  knownNames.forEach((name, idx) => {
    nameMap.set(name.toLowerCase(), `BORROWER_${idx + 1}`);
  });

  if (knownNames.length > 0) {
    // Sort by length descending so longer names match first
    const sorted = [...knownNames].sort((a, b) => b.length - a.length);
    for (const name of sorted) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "gi");
      const label = nameMap.get(name.toLowerCase())!;
      let found = false;
      result = result.replace(regex, () => {
        found = true;
        return `[${label}]`;
      });
      if (found) types.push(`PERSON:${nameMap.get(name.toLowerCase())!.split("_")[1]}`);
    }
  }

  return { redacted: result, types };
}

// ── bucketNumeric ────────────────────────────────────────────────

export function bucketNumeric(value: number, bandSize: number): number {
  return Math.floor(value / bandSize) * bandSize;
}

// ── k-Anonymity ──────────────────────────────────────────────────

export interface KAnonSample {
  loanProgram?: string;
  occupancy?: string;
  propertyType?: string;
  ficoBucket?: number;
  ltvBucket?: number;
  dtiBucket?: number;
  [key: string]: unknown;
}

export interface KAnonResult {
  passes: boolean;
  uniqueIndices: number[];
}

export function checkKAnonymity(
  samples: KAnonSample[],
  k: number,
): KAnonResult {
  const quasiFields = [
    "loanProgram",
    "occupancy",
    "propertyType",
    "ficoBucket",
    "ltvBucket",
    "dtiBucket",
  ] as const;

  // Build key for each sample
  const keys = samples.map((s) =>
    quasiFields.map((f) => String(s[f] ?? "")).join("|"),
  );

  // Count occurrences of each key
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  // Find indices where count < k
  const uniqueIndices: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if ((counts.get(keys[i]!) ?? 0) < k) {
      uniqueIndices.push(i);
    }
  }

  return { passes: uniqueIndices.length === 0, uniqueIndices };
}

// ── Redaction Pipeline ───────────────────────────────────────────

export interface LoanSample {
  id?: string;
  loanProgram?: string;
  occupancy?: string;
  propertyType?: string;
  fico?: number;
  ltv?: number;
  dti?: number;
  loanAmount?: number;
  income?: number;
  rationale?: string;
  [key: string]: unknown;
}

export interface RedactionManifest {
  sampleId: string;
  typesRedacted: string[];
  ficoBand: number;
  ltvBand: number;
  dtiBand: number;
  kAnonDropped: boolean;
}

export interface RedactSamplesResult {
  redacted: LoanSample[];
  manifests: RedactionManifest[];
}

const SAFE_FIELDS = new Set([
  "id",
  "loanProgram",
  "occupancy",
  "propertyType",
  "fico",
  "ltv",
  "dti",
  "loanAmount",
  "income",
  "rationale",
]);

export function redactSamples(
  samples: LoanSample[],
  knownNames: string[] = [],
): RedactSamplesResult {
  // Stage 1: whitelist only safe fields
  let working = samples.map((s) => {
    const out: LoanSample = {};
    for (const key of SAFE_FIELDS) {
      if (key in s) out[key] = s[key];
    }
    return out;
  });

  // Stage 2: redact free-text rationale
  const textResults = working.map((s) => {
    if (s.rationale && typeof s.rationale === "string") {
      return redactText(s.rationale, knownNames);
    }
    return { redacted: s.rationale ?? "", types: [] as string[] };
  });

  working = working.map((s, i) => ({
    ...s,
    rationale: textResults[i]!.redacted,
  }));

  // Stage 3: k-anonymity with bucketed quasi-identifiers
  let bandSize = 5;

  const bucketSamples = (band: number) =>
    working.map((s) => ({
      ...s,
      ficoBucket: s.fico != null ? bucketNumeric(s.fico, band) : undefined,
      ltvBucket: s.ltv != null ? bucketNumeric(s.ltv, band) : undefined,
      dtiBucket: s.dti != null ? bucketNumeric(s.dti, band) : undefined,
      loanProgram: s.loanProgram,
      occupancy: s.occupancy,
      propertyType: s.propertyType,
    }));

  let bucketed = bucketSamples(bandSize);
  let kResult = checkKAnonymity(bucketed, 3);

  if (!kResult.passes) {
    // Try 10-point bands
    bandSize = 10;
    bucketed = bucketSamples(bandSize);
    kResult = checkKAnonymity(bucketed, 3);
  }

  // Build manifests and drop unique records
  const droppedSet = new Set(kResult.passes ? [] : kResult.uniqueIndices);
  const manifests: RedactionManifest[] = [];
  const redacted: LoanSample[] = [];

  for (let i = 0; i < working.length; i++) {
    const manifest: RedactionManifest = {
      sampleId: working[i]!.id ?? `sample-${i}`,
      typesRedacted: textResults[i]!.types,
      ficoBand: bandSize,
      ltvBand: bandSize,
      dtiBand: bandSize,
      kAnonDropped: droppedSet.has(i),
    };
    manifests.push(manifest);

    if (!droppedSet.has(i)) {
      // Bucket all numerics to bandSize in final output
      const s = { ...working[i] };
      if (s.fico != null) s.fico = bucketNumeric(s.fico, bandSize);
      if (s.ltv != null) s.ltv = bucketNumeric(s.ltv, bandSize);
      if (s.dti != null) s.dti = bucketNumeric(s.dti, bandSize);
      if (s.loanAmount != null) s.loanAmount = bucketNumeric(s.loanAmount, bandSize);
      if (s.income != null) s.income = bucketNumeric(s.income, bandSize);
      redacted.push(s);
    }
  }

  return { redacted, manifests };
}
