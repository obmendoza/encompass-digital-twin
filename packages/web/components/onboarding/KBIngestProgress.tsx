"use client";

interface IngestResult {
  documentType: string;
  processingMethod: string;
  kbVersion: number;
  results: {
    chunks_created?: number;
    sections_found?: number;
    programs_detected?: string[];
    programs_found?: string[];
    tiers_extracted?: number;
    requirements_extracted?: number;
    pii_flagged_chunks?: number;
    quality_warnings?: string[];
  };
  cost?: { embedding_tokens?: number; estimated_usd?: number };
}

interface KBIngestProgressProps {
  results: IngestResult[];
  isProcessing: boolean;
  currentFile?: string;
}

function getDocLabel(documentType: string): string {
  if (documentType.toLowerCase().includes("guideline")) return "Guidelines";
  if (
    documentType.toLowerCase().includes("matrix") ||
    documentType.toLowerCase().includes("rate")
  )
    return "Matrices";
  return documentType;
}

export function KBIngestProgress({
  results,
  isProcessing,
  currentFile,
}: KBIngestProgressProps) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[#1a2b4a]">
        Knowledge Base Processing
      </p>

      {isProcessing && (
        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span
            className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
            aria-label="Processing"
          />
          <span>
            Processing{currentFile ? ` ${currentFile}` : ""}...
          </span>
        </div>
      )}

      {results.map((result, idx) => {
        const label = getDocLabel(result.documentType);
        const isMatrix =
          label === "Matrices" ||
          result.documentType.toLowerCase().includes("matrix") ||
          result.documentType.toLowerCase().includes("rate");

        const programs =
          result.results.programs_detected ?? result.results.programs_found ?? [];
        const piiCount = result.results.pii_flagged_chunks ?? 0;

        return (
          <div
            key={idx}
            className="rounded border bg-gray-50 p-3 space-y-2"
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-700">{label}</span>
              <span className="text-xs font-medium text-green-600">Done</span>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              {!isMatrix && (
                <>
                  {result.results.chunks_created !== undefined && (
                    <span>{result.results.chunks_created} chunks</span>
                  )}
                  {result.results.sections_found !== undefined && (
                    <span>{result.results.sections_found} sections</span>
                  )}
                </>
              )}
              {isMatrix && (
                <>
                  {programs.length > 0 && (
                    <span>{programs.length} programs</span>
                  )}
                  {result.results.tiers_extracted !== undefined && (
                    <span>{result.results.tiers_extracted} tiers</span>
                  )}
                </>
              )}
            </div>

            {/* Programs detected */}
            {programs.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {programs.map((p) => (
                  <span
                    key={p}
                    className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}

            {/* PII warning */}
            {piiCount > 0 && (
              <p className="text-xs text-amber-600">
                {piiCount} PII-flagged chunk{piiCount !== 1 ? "s" : ""} redacted
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
