// bpo-document-access.ts
// Issues 15-minute Supabase Storage signed URLs for loan documents on behalf
// of a BPO SME, and writes a `tenant_audit_log` row per access.
//
// Caller (the route handler) is responsible for verifying that the SME has
// pool-membership access to the loan BEFORE invoking issueSignedUrl — this
// service trusts its inputs and is purely about the storage + audit step.
//
// The Supabase client is lazy-initialized here (mirrors file-store.ts) rather
// than reused, because file-store.ts keeps `getSupabase` private and the BPO
// flow has different semantics (signed-URL vs. public-URL). For testability
// callers can override the storage client via the optional `deps` argument.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { withTenantTx } from "../db/pool.js";

const BUCKET = "documents";
const EXPIRY_SECONDS = 15 * 60;

let sbClient: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    throw new Error(
      "BPO_DOC_STORAGE_UNCONFIGURED: missing SUPABASE_URL or SUPABASE_SERVICE_KEY",
    );
  }
  if (!sbClient) {
    sbClient = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY,
    );
  }
  return sbClient;
}

export interface IssueSignedUrlInput {
  tenantId: string;
  partnerId: string;
  smeId: string;
  loanId: string;
  docId: string;
  /** Storage path on the loan's Document object. Resolved by the route. */
  fileKey: string;
}

export interface IssueSignedUrlResult {
  url: string;
  /** ISO timestamp at which the signed URL stops working. */
  expiresAt: string;
}

/**
 * Minimal shape of the Supabase client we depend on. Lets tests inject a
 * fake without pulling in @supabase/supabase-js' full surface area.
 */
export interface SignedUrlStorage {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{
        data: { signedUrl: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export interface IssueSignedUrlDeps {
  /** Override the Supabase storage client (used by tests). */
  supabase?: SignedUrlStorage;
}

/**
 * Issue a 15-minute signed URL for a loan document and write a
 * `tenant_audit_log` row capturing the BPO NPI access.
 *
 * Returns `{ url, expiresAt }` on success.
 *
 * Throws:
 *   - `BPO_DOC_STORAGE_UNCONFIGURED` when SUPABASE env vars are missing
 *     (route maps to 503).
 *   - `BPO_SIGNED_URL_FAILED: <reason>` when Supabase rejects the request
 *     (route maps to 502).
 */
export async function issueSignedUrl(
  input: IssueSignedUrlInput,
  deps: IssueSignedUrlDeps = {},
): Promise<IssueSignedUrlResult> {
  const sb: SignedUrlStorage = deps.supabase ?? (getSupabase() as unknown as SignedUrlStorage);

  const { data, error } = await sb.storage
    .from(BUCKET)
    .createSignedUrl(input.fileKey, EXPIRY_SECONDS);
  if (error || !data) {
    throw new Error(
      `BPO_SIGNED_URL_FAILED: ${error?.message ?? "no data returned"}`,
    );
  }

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString();

  // Real audit row using the actual tenant_audit_log schema (verified Task 14):
  //   (id, actor_id, target_tenant_id, action, reason, metadata, created_at)
  // `target_tenant_id` is NOT NULL and is the tenant whose data is being
  // accessed — for BPO doc access, that's the BPO context's tenantId.
  // The storage path (`fileKey`) is intentionally NOT included in metadata:
  // the audit must describe what was accessed without exposing internal
  // storage layout.
  await withTenantTx(input.tenantId, async (c) => {
    await c.query(
      `INSERT INTO tenant_audit_log (actor_id, target_tenant_id, action, reason, metadata)
       VALUES ($1, $2, 'bpo_document_access', $3, $4::jsonb)`,
      [
        `bpo:${input.smeId}`,
        input.tenantId,
        `BPO SME accessed loan document ${input.docId} on loan ${input.loanId}`,
        JSON.stringify({
          partner_id: input.partnerId,
          sme_id: input.smeId,
          loan_id: input.loanId,
          doc_id: input.docId,
          expiry_at: expiresAt,
        }),
      ],
    );
  });

  return { url: data.signedUrl, expiresAt };
}
