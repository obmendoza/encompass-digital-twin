"use client";

import { useState, useRef, useCallback } from "react";

const CATEGORIES = [
  "Guideline Manual",
  "Rate Sheet / LTV Matrix",
  "Document Checklist",
  "Condition Templates",
  "Compliance Policy",
  "Other",
] as const;

const ACCEPTED_EXTENSIONS = ".pdf,.xlsx,.docx,.png,.jpg";

export interface UploadedDoc {
  id: string;
  fileName: string;
  fileSize: number;
  category: string;
  program: string;
  uploadedAt: string;
}

interface Step2Props {
  programs: string[];
  initialDocs?: UploadedDoc[];
  onNext: (data: { documents: UploadedDoc[] }) => void;
  onBack: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function Step2UploadDocuments({ programs, initialDocs, onNext, onBack }: Step2Props) {
  const [documents, setDocuments] = useState<UploadedDoc[]>(initialDocs ?? []);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newDocs: UploadedDoc[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      fileSize: file.size,
      category: "Guideline Manual",
      program: "All Programs",
      uploadedAt: new Date().toISOString(),
    }));
    setDocuments((prev) => [...prev, ...newDocs]);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);
      if (e.dataTransfer.files?.length) {
        addFiles(e.dataTransfer.files);
      }
    },
    [addFiles],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) {
        addFiles(e.target.files);
      }
      // Reset input so the same file can be selected again
      e.target.value = "";
    },
    [addFiles],
  );

  const updateDoc = useCallback((id: string, field: keyof UploadedDoc, value: string) => {
    setDocuments((prev) =>
      prev.map((doc) => (doc.id === id ? { ...doc, [field]: value } : doc)),
    );
  }, []);

  const removeDoc = useCallback((id: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== id));
  }, []);

  const handleSubmit = () => {
    onNext({ documents });
  };

  const programOptions = ["All Programs", ...programs];

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Upload Documents</h2>
      <p className="text-sm text-gray-500 mb-8">
        Upload lender guideline documents, rate sheets, and compliance policies for extraction.
      </p>

      {/* Drag-and-Drop Zone */}
      <div
        className={`
          relative border-2 border-dashed rounded-lg min-h-[200px] flex flex-col items-center justify-center cursor-pointer
          transition-colors duration-200
          ${dragActive
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100"
          }
        `}
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={handleFileSelect}
        />

        {/* Upload Icon */}
        <svg
          className={`w-12 h-12 mb-3 ${dragActive ? "text-blue-500" : "text-gray-400"}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>

        <p className={`text-sm font-medium ${dragActive ? "text-blue-600" : "text-gray-600"}`}>
          Drag files here or click to browse
        </p>
        <p className="text-xs text-gray-400 mt-1">
          PDF, Excel, Word, PNG, JPG
        </p>
      </div>

      {/* File List */}
      <div className="mt-8">
        {documents.length === 0 ? (
          /* Empty State */
          <div className="p-6 bg-gray-50 border border-dashed border-gray-300 rounded-lg text-center">
            <p className="text-sm text-gray-400">
              No documents uploaded yet. Upload lender guideline documents to begin.
            </p>
          </div>
        ) : (
          <div className="border border-gray-200 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    File Name
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Category
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Program
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-4 py-3 w-12" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors">
                    {/* File Name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <svg className="w-5 h-5 text-gray-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div>
                          <p className="font-medium text-gray-900 truncate max-w-[200px]">{doc.fileName}</p>
                          <p className="text-xs text-gray-400">{formatBytes(doc.fileSize)}</p>
                        </div>
                      </div>
                    </td>

                    {/* Category Dropdown */}
                    <td className="px-4 py-3">
                      <select
                        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={doc.category}
                        onChange={(e) => updateDoc(doc.id, "category", e.target.value)}
                      >
                        {CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Program Dropdown */}
                    <td className="px-4 py-3">
                      <select
                        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        value={doc.program}
                        onChange={(e) => updateDoc(doc.id, "program", e.target.value)}
                      >
                        {programOptions.map((prog) => (
                          <option key={prog} value={prog}>
                            {prog}
                          </option>
                        ))}
                      </select>
                    </td>

                    {/* Status Badge */}
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        Uploaded
                      </span>
                    </td>

                    {/* Delete Button */}
                    <td className="px-4 py-3 text-center">
                      <button
                        className="text-gray-400 hover:text-red-500 transition-colors p-1 rounded hover:bg-red-50"
                        title="Remove file"
                        onClick={() => removeDoc(doc.id)}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Upload count summary */}
      {documents.length > 0 && (
        <p className="text-xs text-gray-500 mt-3">
          {documents.length} document{documents.length !== 1 ? "s" : ""} uploaded
        </p>
      )}

      {/* Navigation */}
      <div className="flex justify-between mt-8">
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-100 transition-colors"
          onClick={onBack}
        >
          &larr; Back
        </button>
        <button
          className="px-5 py-2.5 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm transition-colors"
          onClick={handleSubmit}
        >
          Next: Review Extractions &rarr;
        </button>
      </div>
    </div>
  );
}
