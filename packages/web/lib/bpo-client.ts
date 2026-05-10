// Server-side fetch wrapper for /bpo/* endpoints. Reads the bpo_token cookie
// and forwards as Authorization: Bearer. This is intentionally separate from
// `lib/api-client.ts`, which targets internal routes and injects x-user-id /
// x-super-admin / x-tenant-id headers — those headers must NOT be sent to
// /bpo/* (BPO routes authenticate strictly via the bearer token).
import type { Loan } from "@twin/core";

const base =
  process.env.API_URL ??
  process.env.TWIN_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://127.0.0.1:4000";

async function getToken(): Promise<string | null> {
  try {
    const { cookies } = await import("next/headers");
    const c = await cookies();
    return c.get("bpo_token")?.value ?? null;
  } catch {
    return null;
  }
}

async function bpoReq<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("BPO_NOT_AUTHENTICATED");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "authorization": `Bearer ${token}`,
    ...((init?.headers as Record<string, string>) ?? {}),
  };

  const res = await fetch(`${base}${path}`, { cache: "no-store", ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`${res.status}: ${body.error ?? body.message ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const bpoApi = {
  auth: () =>
    bpoReq<{ partnerId: string; smeId: string; smeName: string; tenantId: string }>(
      `/bpo/auth`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  getQueue: () =>
    bpoReq<{
      items: Array<{ loan_id: string; assigned_pool_id: string; claimed_at: string | null }>;
    }>(`/bpo/queue`),
  getLoan: (loanId: string) => bpoReq<{ loan: Loan }>(`/bpo/loans/${loanId}`),
  claim: (loanId: string) =>
    bpoReq<{ claimed: boolean; loanId: string; vaId: string | null; reason?: string }>(
      `/bpo/loans/${loanId}/claim`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  submitReview: (loanId: string, payload: unknown) =>
    bpoReq<{ reviewId: string; newState: string; outboxEventId: string | null }>(
      `/bpo/loans/${loanId}/review`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
  reviewHistory: (_loanId: string) =>
    // Note: BPO route surface (Tasks 13-16) does not expose review history.
    // For v1, the BPO portal renders only the current review form. Extending
    // the BPO routes with a history endpoint is a follow-up.
    Promise.resolve({ reviews: [] as Array<unknown> }),
};
