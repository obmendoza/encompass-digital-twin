"use client";

import { useState, useEffect, useCallback } from "react";

const NQM_PROGRAMS = [
  { value: "BankStatement12", label: "Bank Statement 12-Mo" },
  { value: "BankStatement24", label: "Bank Statement 24-Mo" },
  { value: "DSCR", label: "DSCR" },
  { value: "AssetDepletion", label: "Asset Depletion" },
  { value: "1099Only", label: "1099 Only" },
  { value: "PnL", label: "P&L Only" },
  { value: "ForeignNational", label: "Foreign National" },
  { value: "ITIN", label: "ITIN" },
  { value: "FullDocNonQM", label: "Full Doc Non-QM" },
] as const;

const LENDER_TYPES = [
  { value: "correspondent", label: "Correspondent" },
  { value: "wholesale", label: "Wholesale" },
  { value: "retail", label: "Retail" },
  { value: "direct", label: "Direct" },
] as const;

export interface Step1Data {
  tenantName: string;
  slug: string;
  contactEmail: string;
  phone: string;
  lenderType: string;
  programs: string[];
}

interface Step1Props {
  initialData?: Partial<Step1Data>;
  onNext: (data: Step1Data) => void;
}

function autoSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 31);
}

export function Step1CreateTenant({ initialData, onNext }: Step1Props) {
  const [tenantName, setTenantName] = useState(initialData?.tenantName ?? "");
  const [slug, setSlug] = useState(initialData?.slug ?? "");
  const [contactEmail, setContactEmail] = useState(initialData?.contactEmail ?? "");
  const [phone, setPhone] = useState(initialData?.phone ?? "");
  const [lenderType, setLenderType] = useState(initialData?.lenderType ?? "correspondent");
  const [programs, setPrograms] = useState<string[]>(initialData?.programs ?? []);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  useEffect(() => {
    if (!slugManuallyEdited) {
      setSlug(autoSlug(tenantName));
    }
  }, [tenantName, slugManuallyEdited]);

  const toggleProgram = useCallback((value: string) => {
    setPrograms((prev) =>
      prev.includes(value) ? prev.filter((p) => p !== value) : [...prev, value],
    );
  }, []);

  const isValid =
    tenantName.trim().length > 0 &&
    slug.length >= 2 &&
    /^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) &&
    contactEmail.includes("@") &&
    programs.length >= 1;

  const handleSubmit = () => {
    if (!isValid) return;
    onNext({ tenantName, slug, contactEmail, phone, lenderType, programs });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-8">
      <h2 className="text-xl font-bold text-gray-900 mb-1">Create Lender Tenant</h2>
      <p className="text-sm text-gray-500 mb-8">
        Configure the basic details for this lender organization.
      </p>

      {/* Grid: Name + Slug, Email + Phone */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-8">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Lender Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Acme Lending"
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Slug <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="acme-lending"
            value={slug}
            onChange={(e) => {
              setSlugManuallyEdited(true);
              setSlug(e.target.value);
            }}
          />
          {slug && (
            <p className="text-xs text-blue-600 mt-1 font-mono">/t/{slug}/</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Contact Email <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="admin@acmelending.com"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
          <input
            type="tel"
            className="w-full border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="(555) 123-4567"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
      </div>

      {/* Lender Type */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Lender Type <span className="text-red-500">*</span>
        </label>
        <select
          className="w-full max-w-xs border border-gray-300 rounded-md px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
          value={lenderType}
          onChange={(e) => setLenderType(e.target.value)}
        >
          {LENDER_TYPES.map((lt) => (
            <option key={lt.value} value={lt.value}>
              {lt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Programs */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          NQM Programs <span className="text-red-500">*</span>
          <span className="text-gray-400 font-normal ml-2">(select at least one)</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {NQM_PROGRAMS.map((prog) => (
            <label
              key={prog.value}
              className={`
                flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer text-sm transition-colors
                ${programs.includes(prog.value)
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-gray-200 hover:border-gray-300 text-gray-700"
                }
              `}
            >
              <input
                type="checkbox"
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                checked={programs.includes(prog.value)}
                onChange={() => toggleProgram(prog.value)}
              />
              {prog.label}
            </label>
          ))}
        </div>
      </div>

      {/* Next Button */}
      <div className="flex justify-end">
        <button
          className={`
            px-5 py-2.5 rounded-md text-sm font-medium transition-colors
            ${isValid
              ? "bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
              : "bg-gray-100 text-gray-400 cursor-not-allowed"
            }
          `}
          disabled={!isValid}
          onClick={handleSubmit}
        >
          Next: Upload Documents &rarr;
        </button>
      </div>
    </div>
  );
}
