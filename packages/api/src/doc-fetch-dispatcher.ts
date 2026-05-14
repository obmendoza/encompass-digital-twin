import { withDb, withTenantTx } from "./db/pool.js";
import type { safeFetch as SafeFetchFn } from "./ingestion/fetch-security.js";
import type { enqueueRefire as EnqueueRefireFn } from "./ingestion/refire-debounce.js";
import type { AdapterConfig, Store } from "@twin/core";

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
  ) => Promise<void>;
  enqueueRefire: typeof EnqueueRefireFn;
  loadAdapterConfig: (tenantId: string, loanId: string) => Promise<AdapterConfig>;
}

interface PendingRow {
  tenant_id: string;
  external_id: string;
  document_id: string;
  loan_id: string;
  source_url: string;
  file_name: string;
  attempts: number;
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
      `SELECT tenant_id, external_id, document_id, loan_id, source_url, file_name, attempts
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
  const config = await deps.loadAdapterConfig(row.tenant_id, row.loan_id);
  const fetched = await deps.safeFetch(row.source_url, {
    allowedHosts: config.allowedFetchHosts,
    maxBytes: config.maxFileBytes,
    timeoutMs: 30_000,
  });
  if (!fetched.ok) {
    const reason = classifyFailure(fetched.reason);
    const detail = fetched.detail ? `${fetched.reason}: ${fetched.detail}` : fetched.reason;
    await recordFailure(row, reason, detail);
    return false;
  }
  const storageKey = `loan-documents/${row.tenant_id}/${row.loan_id}/${row.document_id}`;
  const upload = await deps.uploadToStorage(storageKey, fetched.bytes, fetched.contentType);
  // dispatchAddDocument is dependency-injected; Task 16 wires real store via closure.
  await deps.dispatchAddDocument(
    null as unknown as Store,
    row.tenant_id, row.loan_id, row.document_id, row.file_name, upload.url,
    fetched.bytes.byteLength, fetched.contentType,
  );
  await markFetched(row);
  await deps.enqueueRefire(row.tenant_id, row.loan_id, "doc_added", 30);
  return true;
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
