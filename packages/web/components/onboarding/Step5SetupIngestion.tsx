"use client";

import { useState, useCallback } from "react";

export interface Step5Data {
  sourceName: string;
  fieldMapping: string;
  apiKeyGenerated: boolean;
  skipped: boolean;
}

interface Step5Props {
  onNext: (data: Step5Data) => void;
  onBack: () => void;
}

const DEFAULT_MAPPING = `{
  "borrowerName": "borrower.fullName",
  "loanAmt": "transaction.loanAmount",
  "propertyAddress": "property.streetAddress",
  "fico": "borrower.creditScore"
}`;

function generateMockApiKey(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let key = "dtwin_";
  for (let i = 0; i < 32; i++) {
    key += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return key;
}

export function Step5SetupIngestion({ onNext, onBack }: Step5Props) {
  const [sourceName, setSourceName] = useState("encompass");
  const [fieldMapping, setFieldMapping] = useState(DEFAULT_MAPPING);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleGenerateKey = useCallback(() => {
    setApiKey(generateMockApiKey());
    setCopied(false);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for environments without clipboard API
      setCopied(false);
    }
  }, [apiKey]);

  const handleNext = () => {
    onNext({
      sourceName,
      fieldMapping,
      apiKeyGenerated: !!apiKey,
      skipped: false,
    });
  };

  const handleSkip = () => {
    onNext({
      sourceName: "",
      fieldMapping: "",
      apiKeyGenerated: false,
      skipped: true,
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <div className="flex items-center gap-3 mb-1">
        <h2 className="text-xl font-bold text-gray-900">Ingestion Setup</h2>
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
          Optional
        </span>
      </div>
      <p className="text-sm text-gray-500 mb-8">
        Configure how external systems push loans into this lender&apos;s pipeline.
      </p>

      {/* Source Name */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Source Name
        </label>
        <input
          type="text"
          className="w-full max-w-md border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="e.g., encompass"
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
        />
        <p className="text-xs text-gray-400 mt-1">
          An identifier for the system sending loan data (e.g., &quot;encompass&quot;, &quot;calyx&quot;, &quot;custom-los&quot;)
        </p>
      </div>

      {/* Field Mapping */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Field Mapping (JSON)
        </label>
        <textarea
          className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          rows={8}
          placeholder={DEFAULT_MAPPING}
          value={fieldMapping}
          onChange={(e) => setFieldMapping(e.target.value)}
        />
        <p className="text-xs text-gray-400 mt-1">
          Maps source field names to platform field paths.
        </p>
      </div>

      {/* API Key Generation */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          API Key
        </label>
        {!apiKey ? (
          <button
            className="px-4 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
            onClick={handleGenerateKey}
          >
            Generate API Key
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-gray-50 border border-gray-200 rounded-md px-3 py-2.5 text-sm font-mono text-gray-800 select-all">
                {apiKey}
              </code>
              <button
                className="px-3 py-2.5 rounded-md text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
                onClick={handleCopy}
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-md">
              <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-xs text-amber-800">
                Save this key now. It will not be shown again after you leave this page.
                This key expires if not used within 30 days.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Skip link */}
      <div className="text-center mb-6">
        <button
          className="text-sm text-gray-500 hover:text-gray-700 underline underline-offset-2 transition-colors"
          onClick={handleSkip}
        >
          Skip &mdash; we&apos;ll configure ingestion later
        </button>
      </div>

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
          onClick={handleNext}
        >
          Next: User Management &rarr;
        </button>
      </div>
    </div>
  );
}
