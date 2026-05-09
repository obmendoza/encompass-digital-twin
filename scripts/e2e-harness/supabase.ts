// scripts/e2e-harness/supabase.ts
// Thin Supabase REST client for the harness. Used to query tables (e.g.
// decision_records) that the API persists but doesn't expose via a GET
// endpoint. Service-key auth bypasses RLS — ONLY use in tests.

import { readFileSync } from "node:fs";
import { join } from "node:path";

interface SupabaseEnv {
  url: string;
  serviceKey: string;
}

let cachedEnv: SupabaseEnv | null = null;

/**
 * Resolve Supabase URL + service key from process.env, falling back to
 * packages/api/.env (the canonical location). Returns null if neither
 * source has both values — the caller should treat that as "Supabase
 * not configured" and skip Supabase-dependent assertions cleanly.
 */
export function getSupabaseEnv(): SupabaseEnv | null {
  if (cachedEnv) return cachedEnv;
  let url = process.env.SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    try {
      const raw = readFileSync(join(process.cwd(), "packages/api/.env"), "utf8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq < 0) continue;
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (k === "SUPABASE_URL" && !url) url = v;
        if (k === "SUPABASE_SERVICE_KEY" && !key) key = v;
      }
    } catch { /* file missing — return null */ }
  }
  if (!url || !key) return null;
  cachedEnv = { url, serviceKey: key };
  return cachedEnv;
}

export async function supabaseSelect<T = unknown>(
  table: string,
  query: string,
): Promise<T[] | null> {
  const env = getSupabaseEnv();
  if (!env) return null;
  const url = `${env.url}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: env.serviceKey,
      Authorization: `Bearer ${env.serviceKey}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    throw new Error(`supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return (await res.json()) as T[];
}

export interface DecisionRecord {
  id: string;
  loan_id: string;
  decision_type: "accepted" | "overridden" | "manual";
  agent_recommendation: string | null;
  final_decision: string;
  override_reason: string | null;
  rationale: string | null;
  kb_version: number | null;
  chatbot_consultation_id: string | null;
  decided_at: string;
}

export async function getLatestDecisionRecord(
  loanId: string,
  opts: { tenantId?: string; decidedAfter?: string } = {},
): Promise<DecisionRecord | null> {
  const tenantFilter = opts.tenantId ? `&tenant_id=eq.${opts.tenantId}` : "";
  const afterFilter = opts.decidedAfter ? `&decided_at=gt.${encodeURIComponent(opts.decidedAfter)}` : "";
  const rows = await supabaseSelect<DecisionRecord>(
    "decision_records",
    `select=id,loan_id,decision_type,agent_recommendation,final_decision,override_reason,rationale,kb_version,chatbot_consultation_id,decided_at&loan_id=eq.${loanId}${tenantFilter}${afterFilter}&order=decided_at.desc&limit=1`,
  );
  return rows && rows.length > 0 ? rows[0]! : null;
}

/**
 * Polls for a decision record decided AFTER the given timestamp. Use the
 * workflow's own start time so prior runs' stale records aren't matched.
 * The decision-writer is fire-and-forget (server.ts:224 launches but doesn't
 * await writeDecisionRecord), so a query immediately after Accept / Override
 * can race the write. Polls every 250ms up to ~10s.
 */
export async function pollForDecisionRecord(
  loanId: string,
  opts: { tenantId?: string; decidedAfter: string; attempts?: number; delayMs?: number },
): Promise<DecisionRecord | null> {
  const attempts = opts.attempts ?? 40;
  const delayMs = opts.delayMs ?? 250;
  for (let i = 0; i < attempts; i++) {
    const rec = await getLatestDecisionRecord(loanId, { tenantId: opts.tenantId, decidedAfter: opts.decidedAfter });
    if (rec) return rec;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}
