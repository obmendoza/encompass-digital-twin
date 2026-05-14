import { createClient } from "@supabase/supabase-js";
import { withDb, withTenantTx, isDbEnabled } from "./db/pool.js";
import { withStoreSnapshot } from "./store-db-consistency.js";
import { safeFetch } from "./ingestion/fetch-security.js";
import { enqueueRefire } from "./ingestion/refire-debounce.js";
import type { safeFetch as SafeFetchFn } from "./ingestion/fetch-security.js";
import type { enqueueRefire as EnqueueRefireFn } from "./ingestion/refire-debounce.js";
import { AdapterConfigSchema } from "@twin/core";
import type { AdapterConfig, Store } from "@twin/core";

// ── Metrics ──────────────────────────────────────────────────────────────────

export const docFetchMetrics = {
  attempts_total: new Map<string, number>(),    // key = outcome:failed_reason
  bytes_total: 0,
  dead_lettered_total: 0,
  refire_fires_total: 0,
};

function incMetric(key: string, by = 1): void {
  docFetchMetrics.attempts_total.set(key, (docFetchMetrics.attempts_total.get(key) ?? 0) + by);
}

export interface FetchBatchDeps {
  safeFetch: typeof SafeFetchFn;
  uploadToStorage: (key: string, bytes: Uint8Array, contentType: string | null) => Promise<{ key: string; url: string }>;
  dispatchAddDocument: (
    store: Store,
    tenantId: string,
    loanId: string,
    documentId: string,
    fileName: string,
    fileUrl: string,
    fileSize: number,
    mimeType: string | null,
    docType: string,
  ) => Promise<void>;
  enqueueRefire: typeof EnqueueRefireFn;
  loadAdapterConfig: (tenantId: string, sourceName: string | null) => Promise<AdapterConfig>;
}

interface PendingRow {
  tenant_id: string;
  external_id: string;
  document_id: string;
  loan_id: string;
  source_url: string;
  file_name: string;
  attempts: number;
  doc_type: string;
  source_name: string | null;
}

export const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 60 * 60_000, 12 * 60 * 60_000];

export interface ProcessResult { processed: number; succeeded: number; failed: number; }

export async function processOneFetchBatch(
  deps: FetchBatchDeps,
  limit: number,
): Promise<ProcessResult> {
  const pending = await claimPendingRows(limit);
  let succeeded = 0;
  let failed = 0;
  for (const row of pending) {
    const ok = await processRow(row, deps);
    if (ok) succeeded++; else failed++;
  }
  return { processed: pending.length, succeeded, failed };
}

async function claimPendingRows(limit: number): Promise<PendingRow[]> {
  return withDb(async (c) => {
    const { rows } = await c.query<PendingRow>(
      `SELECT tenant_id, external_id, document_id, loan_id, source_url, file_name, attempts, doc_type, source_name
       FROM ingested_documents
       WHERE status = 'pending_fetch' AND next_attempt_at <= NOW()
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED`,
      [limit],
    );
    return rows;
  });
}

async function processRow(row: PendingRow, deps: FetchBatchDeps): Promise<boolean> {
  const config = await deps.loadAdapterConfig(row.tenant_id, row.source_name);
  const fetched = await deps.safeFetch(row.source_url, {
    allowedHosts: config.allowedFetchHosts,
    maxBytes: config.maxFileBytes,
    timeoutMs: 30_000,
  });
  if (!fetched.ok) {
    const reason = classifyFailure(fetched.reason);
    const detail = fetched.detail ? `${fetched.reason}: ${fetched.detail}` : fetched.reason;
    incMetric(`fail:${reason}`);
    await recordFailure(row, reason, detail);
    return false;
  }
  const storageKey = `loan-documents/${row.tenant_id}/${row.loan_id}/${row.document_id}`;
  try {
    const upload = await deps.uploadToStorage(storageKey, fetched.bytes, fetched.contentType);
    // dispatchAddDocument is dependency-injected; Task 16 wires real store via closure.
    await deps.dispatchAddDocument(
      null as unknown as Store,
      row.tenant_id, row.loan_id, row.document_id, row.file_name, upload.url,
      fetched.bytes.byteLength, fetched.contentType, row.doc_type,
    );
    await markFetched(row);
    incMetric("success:ok");
    docFetchMetrics.bytes_total += fetched.bytes.byteLength;
    await deps.enqueueRefire(row.tenant_id, row.loan_id, "doc_added", 30);
    return true;
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    incMetric("fail:post_fetch_error");
    await recordFailure(row, "post_fetch_error", msg);
    return false;
  }
}

export function classifyFailure(reason: string): string {
  if (reason === "scheme_not_allowed" || reason === "host_not_allowed" || reason === "ip_range_blocked") return "ssrf_blocked";
  if (reason === "unexpected_redirect") return "unexpected_redirect";
  if (reason === "too_large") return "too_large";
  if (reason === "status_403" || reason === "status_404") return "url_expired";
  if (reason === "timeout") return "fetch_error";
  return "fetch_error";
}

const TERMINAL_REASONS = new Set(["ssrf_blocked", "unexpected_redirect", "too_large"]);

async function recordFailure(row: PendingRow, failedReason: string, lastError: string): Promise<void> {
  const attempts = row.attempts + 1;
  const terminal = TERMINAL_REASONS.has(failedReason) || attempts >= BACKOFF_MS.length;
  if (terminal) {
    docFetchMetrics.dead_lettered_total++;
    await withDb(async (c) => {
      await c.query(
        `UPDATE ingested_documents
            SET status='failed', failed_reason=$3, attempts=$4, last_error=$5, next_attempt_at=NOW()
          WHERE tenant_id=$1 AND external_id=$2`,
        [row.tenant_id, row.external_id, failedReason, attempts, lastError.slice(0, 500)],
      );
    });
  } else {
    const idx = Math.min(attempts - 1, BACKOFF_MS.length - 1);
    const delayMs = BACKOFF_MS[idx]!;
    await withDb(async (c) => {
      await c.query(
        `UPDATE ingested_documents
            SET attempts=$3, last_error=$4, failed_reason=$5,
                next_attempt_at=NOW() + ($6 || ' milliseconds')::interval
          WHERE tenant_id=$1 AND external_id=$2`,
        [row.tenant_id, row.external_id, attempts, lastError.slice(0, 500), failedReason, String(delayMs)],
      );
    });
  }
}

async function markFetched(row: PendingRow): Promise<void> {
  await withTenantTx(row.tenant_id, async (c) => {
    await c.query(
      `UPDATE ingested_documents SET status='fetched', fetched_at=NOW() WHERE tenant_id=$1 AND external_id=$2`,
      [row.tenant_id, row.external_id],
    );
  });
}

// ── Boot-time dispatcher ─────────────────────────────────────────────────────

const ADVISORY_LOCK = 45;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 10;

export function startDocFetchDispatcher(store: Store): void {
  if (!isDbEnabled() || process.env.NODE_ENV === "test") return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.warn("[doc-fetch] SUPABASE_URL / SUPABASE_SERVICE_KEY not set — dispatcher inactive");
    return;
  }
  console.log(`[doc-fetch] starting dispatcher (lock ${ADVISORY_LOCK}, poll ${POLL_INTERVAL_MS}ms)`);
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const deps: FetchBatchDeps = {
    safeFetch,
    uploadToStorage: async (key, bytes, contentType) => {
      const { error } = await supabase.storage.from("loan-documents").upload(key, bytes, {
        contentType: contentType ?? "application/octet-stream",
        upsert: true,
      });
      if (error) throw new Error(`supabase storage upload failed: ${error.message}`);
      const { data } = supabase.storage.from("loan-documents").getPublicUrl(key);
      return { key, url: data.publicUrl };
    },
    dispatchAddDocument: async (_storeRef, tenantId, loanId, documentId, fileName, fileUrl, fileSize, mimeType, docType) => {
      // _storeRef is null per the worker's per-row call; close over real `store` here.
      await withStoreSnapshot(store, loanId, async () => {
        const actor = { kind: "system" as const, id: "doc-fetch-worker" };
        // Determine the auto-assigned id: reducer uses `d${documents.length + 1}`.
        const state = store.getState() as { loans: Record<string, { documents: unknown[] } | undefined> };
        const preLen = state.loans[loanId]?.documents.length ?? 0;
        const newDocId = `d${preLen + 1}`;
        store.dispatch({
          type: "AddDocument",
          loanId,
          doc: { name: fileName, docType: docType as import("@twin/core").DocumentType },
          actor,
        });
        // Attach file metadata so the loan UI shows a fully resolved document
        // rather than a pending stub with no file link.
        store.dispatch({
          type: "AttachFile",
          loanId,
          documentId: newDocId,
          fileKey: `loan-documents/${tenantId}/${loanId}/${documentId}`,
          fileUrl,
          fileSize,
          mimeType: mimeType ?? "application/octet-stream",
          actor,
        });
      });
    },
    enqueueRefire,
    loadAdapterConfig: async (tenantId, sourceName) => {
      const result = await withTenantTx(tenantId, async (c) => {
        const { rows } = await c.query<{ adapter_config: unknown }>(
          sourceName
            ? `SELECT adapter_config FROM ingestion_mappings WHERE tenant_id=$1 AND source_name=$2 AND active=true LIMIT 1`
            : `SELECT adapter_config FROM ingestion_mappings WHERE tenant_id=$1 AND active=true LIMIT 1`,
          sourceName ? [tenantId, sourceName] : [tenantId],
        );
        return rows[0]?.adapter_config ?? {};
      });
      return AdapterConfigSchema.parse(result);
    },
  };

  // Lazy imports for tick handlers — keep startup cheap.
  let _drainRefires: typeof import("./ingestion/refire-debounce.js")["drainReadyRefires"] | null = null;
  let _runPredictions: ((tenantId: string, loanId: string, ctx: unknown, source: string) => Promise<unknown>) | null = null;
  let _buildCtx: ((loan: unknown) => Promise<unknown>) | null = null;

  setInterval(() => {
    void (async () => {
      try {
        // Acquire + work + release all on one pool connection (session advisory lock).
        await withDb(async (c) => {
          const { rows } = await c.query<{ got: boolean }>(
            `SELECT pg_try_advisory_lock($1) AS got`,
            [ADVISORY_LOCK],
          );
          if (!rows[0]!.got) return;
          try {
            await processOneFetchBatch(deps, BATCH_SIZE);

            // Drain ready refires inline.
            if (!_drainRefires) _drainRefires = (await import("./ingestion/refire-debounce.js")).drainReadyRefires;
            if (!_runPredictions) _runPredictions = (await import("./services/predict-conditions/index.js")).run as never;
            if (!_buildCtx) _buildCtx = (await import("./routes/predict-conditions-context-builder.js")).buildLoanContextFromLoan as never;
            const ready = await _drainRefires(50);
            docFetchMetrics.refire_fires_total += ready.length;
            for (const r of ready) {
              try {
                const state = store.getState() as { loans: Record<string, unknown> };
                const loan = state.loans[r.loanId];
                if (!loan) continue;
                const ctx = await _buildCtx(loan);
                await _runPredictions(r.tenantId, r.loanId, ctx, "system:loan-ingest");
              } catch (e) {
                console.error(`[doc-fetch] refire failed for ${r.loanId}:`, (e as Error).message);
              }
            }
          } finally {
            await c.query(`SELECT pg_advisory_unlock($1)`, [ADVISORY_LOCK]);
          }
        });
      } catch (e) {
        console.error("[doc-fetch] tick failed:", (e as Error).message);
      }
    })();
  }, POLL_INTERVAL_MS);
}
