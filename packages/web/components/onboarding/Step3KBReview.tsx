"use client";

import { useState } from "react";
import KBIngestProgress from "./KBIngestProgress";
import TabProgramMatrix from "./TabProgramMatrix";

interface IngestResult {
  documentType: string;
  processingMethod: string;
  kbVersion: number;
  results: {
    chunks_created?: number;
    chunksStored?: number;
    sections_found?: number;
    programs_detected?: string[];
    programs_found?: string[];
    tiers_extracted?: number;
    tiersExtracted?: number;
    requirements_extracted?: number;
    pii_flagged_chunks?: number;
    quality_warnings?: string[];
  };
}

interface Step3KBReviewProps {
  tenantId: string;
  programs: string[];
  onApprove: (kbVersion: number) => void;
}

type KBTab = "ingest" | "programs" | "guidelines" | "test";

export default function Step3KBReview({ tenantId, programs, onApprove }: Step3KBReviewProps) {
  const [activeTab, setActiveTab] = useState<KBTab>("ingest");
  const [ingestResults, setIngestResults] = useState<IngestResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFile, setCurrentFile] = useState("");
  const [kbVersion, setKbVersion] = useState<number | null>(null);
  const [matrixTiers, setMatrixTiers] = useState<any[]>([]);
  const [extractedPrograms, setExtractedPrograms] = useState<string[]>([]);
  const [kbStatus, setKbStatus] = useState<any>(null);
  const [testQuery, setTestQuery] = useState("");
  const [testAnswer, setTestAnswer] = useState("");
  const [testLoading, setTestLoading] = useState(false);

  const handleIngestGuidelines = async (file: File) => {
    setIsProcessing(true);
    setCurrentFile(file.name);

    const formData = new FormData();
    formData.append("tenantId", tenantId);
    formData.append("category", "guideline_manual");
    formData.append("fileName", file.name);
    formData.append("document", file);

    try {
      const resp = await fetch("/api/guidelines/ingest", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (resp.ok) {
        setIngestResults((prev) => [...prev, {
          documentType: "guideline_manual",
          processingMethod: "hierarchical_rag_chunker",
          kbVersion: data.kbVersion,
          results: {
            chunksStored: data.chunksStored,
            programs_detected: data.programsDetected ?? [],
          },
        }]);
        setKbVersion(data.kbVersion);
      }
    } catch (err) {
      console.error("Guideline ingestion failed:", err);
    } finally {
      setIsProcessing(false);
      setCurrentFile("");
    }
  };

  const handleIngestMatrix = async (file: File) => {
    setIsProcessing(true);
    setCurrentFile(file.name);

    const formData = new FormData();
    formData.append("tenantId", tenantId);
    formData.append("category", "rate_sheet");
    formData.append("fileName", file.name);
    formData.append("document", file);

    try {
      const resp = await fetch("/api/guidelines/ingest", {
        method: "POST",
        body: formData,
      });
      const data = await resp.json();
      if (resp.ok) {
        setIngestResults((prev) => [...prev, {
          documentType: "rate_sheet",
          processingMethod: "matrix_table_extractor",
          kbVersion: data.kbVersion,
          results: {
            tiersExtracted: data.tiersExtracted,
            programs_found: data.programsExtracted ? [`${data.programsExtracted} programs`] : [],
          },
        }]);
        setExtractedPrograms(data.programs ?? []);
      }
    } catch (err) {
      console.error("Matrix ingestion failed:", err);
    } finally {
      setIsProcessing(false);
      setCurrentFile("");
    }
  };

  const handleTestQuery = async () => {
    if (!testQuery.trim()) return;
    setTestLoading(true);
    setTestAnswer("");

    try {
      const resp = await fetch("/api/guidelines/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId, query: testQuery }),
      });
      const data = await resp.json();
      const result = data.result ?? data;
      setTestAnswer(result.answer ?? "No answer received");
    } catch (err) {
      setTestAnswer("Error: could not query knowledge base");
    } finally {
      setTestLoading(false);
    }
  };

  const fetchKBStatus = async () => {
    try {
      const resp = await fetch(`/api/guidelines/status/${tenantId}`);
      const data = await resp.json();
      setKbStatus(data);
    } catch {}
  };

  const tabs: { key: KBTab; label: string }[] = [
    { key: "ingest", label: "Ingest Documents" },
    { key: "programs", label: "Program Matrices" },
    { key: "guidelines", label: "Guidelines KB" },
    { key: "test", label: "Test KB" },
  ];

  return (
    <div>
      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              setActiveTab(tab.key);
              if (tab.key === "guidelines") fetchKBStatus();
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "ingest" && (
        <div>
          <KBIngestProgress
            results={ingestResults}
            isProcessing={isProcessing}
            currentFile={currentFile}
          />

          <div className="grid grid-cols-2 gap-4 mt-4">
            <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
              <div className="text-sm font-medium text-gray-700 mb-1">Upload Guideline Manual</div>
              <div className="text-xs text-gray-500">PDF — narrative guidelines (143+ pages)</div>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleIngestGuidelines(file);
                  e.target.value = "";
                }}
              />
            </label>

            <label className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors">
              <div className="text-sm font-medium text-gray-700 mb-1">Upload Rate Sheet / Matrix</div>
              <div className="text-xs text-gray-500">PDF — LTV/FICO matrices (37+ pages)</div>
              <input
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleIngestMatrix(file);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}

      {activeTab === "programs" && (
        <div>
          {matrixTiers.length > 0 ? (
            <TabProgramMatrix
              tiers={matrixTiers}
              programs={extractedPrograms}
            />
          ) : (
            <div className="text-center text-gray-400 py-12">
              <p className="text-sm">No matrix data yet.</p>
              <p className="text-xs mt-1">Upload a rate sheet in the Ingest tab first.</p>
            </div>
          )}
        </div>
      )}

      {activeTab === "guidelines" && (
        <div>
          {kbStatus ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <span className={`inline-block w-3 h-3 rounded-full ${
                  kbStatus.kbState === "kb_active" ? "bg-green-500" :
                  kbStatus.kbState === "kb_disabled" ? "bg-gray-400" : "bg-yellow-500"
                }`} />
                <span className="text-sm font-medium text-gray-700">
                  {kbStatus.kbState === "kb_active" ? "Knowledge Base Active" :
                   kbStatus.kbState === "kb_disabled" ? "Not Configured" : kbStatus.kbState}
                </span>
              </div>
              {kbStatus.activeVersion && (
                <div className="text-sm text-gray-500">
                  Version {kbStatus.activeVersion} | {kbStatus.chunkCount ?? 0} chunks | ${kbStatus.cost?.toFixed(2) ?? "0.00"} cost
                </div>
              )}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-12 text-sm">Loading KB status...</div>
          )}
        </div>
      )}

      {activeTab === "test" && (
        <div>
          <p className="text-sm text-gray-500 mb-4">
            Test the knowledge base with questions before approving.
          </p>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={testQuery}
              onChange={(e) => setTestQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleTestQuery()}
              placeholder="Ask a question about the guidelines..."
              className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleTestQuery}
              disabled={testLoading || !testQuery.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
            >
              {testLoading ? "Searching..." : "Ask"}
            </button>
          </div>

          <div className="flex flex-wrap gap-2 mb-4">
            {["Min FICO for Flex Select?", "Max LTV for DSCR investment?", "Reserve requirements?"].map((q) => (
              <button
                key={q}
                onClick={() => { setTestQuery(q); }}
                className="text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100"
              >
                {q}
              </button>
            ))}
          </div>

          {testAnswer && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm whitespace-pre-wrap">
              {testAnswer}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
