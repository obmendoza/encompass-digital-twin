import type {
  Loan, NewCondition, QualifyingIncomeWorksheet, UwDecision, Actor, Condition, LoggedAction, Document, PendingRecommendation,
} from "@twin/core";

const base = process.env.API_URL ?? process.env.TWIN_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";

// Cache the demo tenant ID after first lookup
let cachedDemoTenantId: string | null = null;

async function resolveDemoTenantId(): Promise<string> {
  if (cachedDemoTenantId) return cachedDemoTenantId;
  try {
    // Look up the demo tenant from the API (using super_admin access)
    const res = await fetch(`${base}/tenants/demo`, {
      headers: { "x-user-id": "web-server", "x-super-admin": "true", "x-tenant-id": "any" },
      cache: "no-store",
    });
    if (res.ok) {
      const tenant = await res.json();
      cachedDemoTenantId = tenant.id;
      return tenant.id;
    }
  } catch { /* API not reachable */ }
  return "";
}

// Resolve the user's tenant ID from request headers (set by web middleware)
async function getUserTenantId(): Promise<string> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const tenantId = h.get("x-user-tenant-id") ?? "";
    if (tenantId) return tenantId;
  } catch { /* not in server component context */ }
  // No user tenant → default to demo
  return resolveDemoTenantId();
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // Resolve tenant from the current user's JWT (via middleware headers)
  const userTenantId = await getUserTenantId();

  const defaultHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-user-id": "web-server",
    "x-super-admin": "true",
  };
  // Only set x-tenant-id if we have one — API uses its own fallback otherwise
  if (userTenantId) defaultHeaders["x-tenant-id"] = userTenantId;

  const mergedHeaders = { ...defaultHeaders, ...(init?.headers as Record<string, string>) };

  const res = await fetch(`${base}${path}`, {
    cache: "no-store",
    ...init,
    headers: mergedHeaders,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: "INTERNAL", message: res.statusText }));
    const code = body.code ?? body.error ?? "INTERNAL";
    const message = body.message ?? body.error ?? res.statusText;
    throw new Error(`${code}: ${message}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getTenantIdBySlug: async (slug: string): Promise<string | null> => {
    try {
      const tenant = await req<{ id: string }>(`/tenants/${slug}`);
      return tenant.id;
    } catch { return null; }
  },
  listScenarios: () => req<Array<{ id: string; name: string; description: string }>>("/scenarios"),
  loadScenario: (scenarioId: string) =>
    req<{ scenarioId: string | null }>("/world/load-scenario", {
      method: "POST", body: JSON.stringify({ scenarioId }),
    }),
  loadByLoan: (loanId: string) =>
    req<{ scenarioId: string; loanId: string }>("/world/load-by-loan", {
      method: "POST", body: JSON.stringify({ loanId }),
    }),
  reset: () => req<{ scenarioId: null }>("/world/reset", { method: "POST", body: JSON.stringify({}) }),
  getLoan: (loanId: string, init?: RequestInit) => req<Loan>(`/loans/${loanId}`, init),
  listLoans: (init?: RequestInit) => req<Array<{ id: string; borrower: string; program: string;
    loanAmount: number; ltv: number; decision: string; openConditions: number }>>("/loans", init),
  getConditions: (loanId: string) => req<Condition[]>(`/loans/${loanId}/conditions`),
  getAudit: (loanId: string) => req<LoggedAction[]>(`/loans/${loanId}/audit`),
  setDecision: (loanId: string, decision: UwDecision, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/decision`, {
      method: "POST", body: JSON.stringify({ decision, rationale, actor }),
    }),
  recalcIncome: (loanId: string, worksheet: QualifyingIncomeWorksheet, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/qualifying-income`, {
      method: "POST", body: JSON.stringify({ worksheet, actor }),
    }),
  addCondition: (loanId: string, condition: NewCondition, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions`, {
      method: "POST", body: JSON.stringify({ condition, actor }),
    }),
  clearCondition: (loanId: string, conditionId: string, notes: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/clear`, {
      method: "POST", body: JSON.stringify({ notes, actor }),
    }),
  waiveCondition: (loanId: string, conditionId: string, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/waive`, {
      method: "POST", body: JSON.stringify({ rationale, actor }),
    }),
  removeCondition: (loanId: string, conditionId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}`, {
      method: "DELETE", body: JSON.stringify({ actor }),
    }),
  getDocuments: (loanId: string) => req<Document[]>(`/loans/${loanId}/documents`),
  addDocument: (loanId: string, doc: { name: string; docType: string }, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/documents`, {
      method: "POST", body: JSON.stringify({ doc, actor }),
    }),
  updateDocument: (loanId: string, docId: string, patch: { status?: string; linkedConditionId?: string; notes?: string }, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/documents/${docId}`, {
      method: "PATCH", body: JSON.stringify({ ...patch, actor }),
    }),
  linkDocument: (loanId: string, docId: string, conditionId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/documents/${docId}/link`, {
      method: "POST", body: JSON.stringify({ conditionId, actor }),
    }),
  stageRecommendation: (loanId: string, rec: { recommendation: string; rationale: string; confidence: number; conditions: string[]; trace: unknown[] }, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/recommendation`, {
      method: "POST", body: JSON.stringify({ recommendation: rec, actor }),
    }),
  acceptRecommendation: (loanId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/recommendation/accept`, {
      method: "POST", body: JSON.stringify({ actor }),
    }),
  clearRecommendation: (loanId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/recommendation`, {
      method: "DELETE", body: JSON.stringify({ actor }),
    }),
  assignLoan: (loanId: string, assignedTo: string, priority: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/assign`, {
      method: "POST", body: JSON.stringify({ assignedTo, priority, actor }),
    }),
  updateAssignmentStatus: (loanId: string, status: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/assignment-status`, {
      method: "POST", body: JSON.stringify({ status, actor }),
    }),
  unassignLoan: (loanId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/assign`, {
      method: "DELETE", body: JSON.stringify({ actor }),
    }),
  getAssignments: (userId: string) =>
    req<Array<{ id: string; borrower: string; program: string; loanAmount: number; status: string; priority: string; assignedAt: string; decision: string }>>(`/assignments/${userId}`),
  overrideDecision: (loanId: string, originalRecommendation: UwDecision, overrideDecision: UwDecision, overrideReason: string, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/override`, {
      method: "POST", body: JSON.stringify({ originalRecommendation, overrideDecision, overrideReason, rationale, actor }),
    }),
  sendBackToVA: (loanId: string, notes: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/send-back`, {
      method: "POST", body: JSON.stringify({ notes, actor }),
    }),
  getMetrics: () => req<{
    totalLoans: number;
    decisions: { pending: number; approved: number; denied: number; suspended: number; counter: number };
    assignments: { unassigned: number; queued: number; in_progress: number; report_ready: number; under_review: number; decided: number };
    programs: Record<string, number>;
    conditions: { total: number; cleared: number; open: number };
    documents: { total: number; withFiles: number };
    pendingRecommendations: number;
    overrides: number;
    auditLogEntries: number;
  }>("/metrics"),
  injectLoan: (loan: unknown) =>
    req<{ ok: boolean; loanId: string }>("/world/inject-loan", {
      method: "POST", body: JSON.stringify({ loan }),
    }),
  uploadFile: async (loanId: string, docId: string, file: File): Promise<{ ok: boolean; fileKey: string; fileUrl: string; document: Document }> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(`${base}/loans/${loanId}/documents/${docId}/upload`, {
      method: "POST",
      body: formData,
      // Don't set content-type — FormData sets it with boundary automatically
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json();
  },
  getFileUrl: (fileKey: string) => `${base}/uploads/${fileKey}`,
};
