// va-doc-return.ts
// Doc-return ingress for the VA Review Layer. After a VA has issued a
// `request_docs` verdict, the loan sits in va_state='va_doc_request_pending'
// while the originator gathers docs. When those docs come back (via the
// internal portal at POST /loans/:id/va/docs-returned, or the BPO portal at
// POST /bpo/loans/:id/docs-returned), this service:
//
//   1. Verifies the loan is still in va_doc_request_pending (atomic UPDATE
//      WHERE clause — race-safe against concurrent doc returns).
//   2. Adds the returned documents to the in-memory store via AddDocument.
//   3. Flips va_state to 'agent_review_pending' so the agent re-runs against
//      the new doc set; once a fresh recommendation is staged, Task 12's
//      routing hook will move the loan back into va_review_pending.
//   4. Fires a non-blocking POST to the agent service to trigger the re-run.
//      Failure to reach the agent does NOT fail the request — the loan state
//      has already advanced and an operator can manually re-run if needed.

import type { Store, Actor, DocumentType } from "@twin/core";
import { withTenantTx } from "../db/pool.js";

export interface ReceiveDocsInput {
  tenantId: string;
  loanId: string;
  /** Each doc carries the metadata the existing AddDocument action expects. */
  documents: Array<{ name: string; docType: string }>;
}

export interface ReceiveDocsResult {
  accepted: number;
  newState: "agent_review_pending";
  agentRerunTriggered: boolean;
}

export async function receiveVADocResponse(
  store: Store,
  input: ReceiveDocsInput,
  actor: { kind: "internal" | "bpo"; id: string },
): Promise<ReceiveDocsResult> {
  // 1. State check + transition (atomic; only succeeds when the row was in
  //    va_doc_request_pending). Using an UPDATE...WHERE guard avoids a
  //    read-then-write race against another concurrent doc-return.
  const transitioned = await withTenantTx(input.tenantId, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE va_loan_state
          SET va_state = 'agent_review_pending', updated_at = now()
        WHERE tenant_id = $1
          AND loan_id = $2
          AND va_state = 'va_doc_request_pending'`,
      [input.tenantId, input.loanId],
    );
    return rowCount === 1;
  });
  if (!transitioned) {
    throw new Error(
      `LOAN_NOT_AWAITING_DOCS: loan ${input.loanId} is not in va_doc_request_pending`,
    );
  }

  // 2. Add documents to the in-memory store. AddDocument assigns an id
  //    internally (d{N+1}); we don't need it here.
  const addActor: Actor = { kind: actor.kind, id: actor.id };
  for (const d of input.documents) {
    store.dispatch({
      type: "AddDocument",
      loanId: input.loanId,
      doc: { name: d.name, docType: d.docType as DocumentType },
      actor: addActor,
    });
  }

  // 3. Trigger agent re-run (fire-and-log).
  const triggered = await triggerAgentRerun(input.tenantId, input.loanId);

  return {
    accepted: input.documents.length,
    newState: "agent_review_pending",
    agentRerunTriggered: triggered,
  };
}

async function triggerAgentRerun(tenantId: string, loanId: string): Promise<boolean> {
  const agentUrl = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";
  try {
    const res = await fetch(
      `${agentUrl}/api/twin/underwrite-multi/${encodeURIComponent(loanId)}?tenant_id=${encodeURIComponent(tenantId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trigger: "va_doc_return" }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      console.warn(
        `[va-doc-return] Agent rerun returned ${res.status} for loan ${loanId}`,
      );
      return false;
    }
    return true;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(
      `[va-doc-return] Agent rerun trigger failed for loan ${loanId}: ${msg}`,
    );
    return false;
  }
}
