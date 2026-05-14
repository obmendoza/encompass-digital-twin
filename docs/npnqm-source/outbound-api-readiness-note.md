# UAS → NPNQM Portal Outbound API — Readiness Note

**Date:** 2026-05-15
**From:** UAS Engineering
**Status:** Receiver ready; awaiting NPNQM's outbound API contract to wire the producer side.

---

## Summary

The UAS receiving side for NPNQM portal pushes is **live in production** as of 2026-05-15. The next step is the **outbound** direction — when our UW staff curate the AI-predicted Recommended Documents list (and as loans progress through milestones), we push that information back to your portal so borrowers see it and your downstream systems stay in sync.

We're writing this note to confirm:

1. **What's already working on our side** (inbound complete; you can start pushing analysis-output payloads today)
2. **What we're ready to send back** (the two outbound message types we want to push)
3. **The technical questions we need answered** to wire it up

---

## 1. What's already live (inbound — no action needed from you)

You can start pushing portal analysis output to UAS today:

- **Endpoint:** `POST https://api-production-8666.up.railway.app/api/ingest/{tenantSlug}/analysis-output`
- **Auth:** Bearer token (we'll provision per-tenant API keys once you're ready)
- **Payload shape:** exactly the `<loan>_output.json` shape from the 2026-05-15 sample drop — `document_requests[]`, `scenario_summary`, `seen_conflicts`, `stats`. We consume the full structure including your `program_eligibility_detail` verdict.
- **Idempotency:** content-hash based. Re-pushing the same payload is a no-op; re-pushing with new content supersedes the prior analysis and re-runs our pre-underwriter. No need to rotate identifiers.
- **PII handling:** SSN and DOB are redacted at the request boundary before any persistence or logging. Safe to send unmasked.

Per-loan latency on our side is sub-second for the inbound persist + millisecond-scale for our PC v2 second-opinion run. Your 8-minute portal analyzer is the load-bearing path; we just persist + cross-check.

---

## 2. What we want to send back (outbound — needs your API)

Two distinct message types:

### 2.1 Curated Recommended Documents (per loan, on staff curation event)

After your portal analyzer produces `document_requests` and our UW staff review them, the staff:
- Accept the prediction (doc becomes part of the borrower's required list)
- Dismiss the prediction (with a reason)
- Add a custom condition (operator-originated, not LLM-predicted)

Once the staff sign off, UAS needs to push the **curated final list** back to your portal so:
- Borrowers see the same set of required documents in your portal UI
- Your portal's document-tracking workflow has the canonical authoritative list

**Proposed shape we'd POST to you** (subject to your preferences):

```json
{
  "tenantId": "npnqm-twin",
  "externalLoanId": "<your loan_number>",
  "curatedAt": "2026-05-15T20:00:00Z",
  "curatedBy": "uw-staff-user-id",
  "curationRound": 1,
  "documents": [
    {
      "documentType": "Credit Report",
      "documentCategory": "Credit",
      "priority": "P0",
      "specifications": ["Tri-merge from Experian/TransUnion/Equifax", "..."],
      "reasonsNeeded": ["Credit score validation per NQMF guidelines"],
      "appliesTo": "all_borrowers",
      "status": "required",
      "source": "portal_predicted_accepted | uas_added | portal_predicted_modified"
    }
  ],
  "dismissedPredictions": [
    { "documentType": "Bank Statement (12mo)", "dismissReason": "DSCR loan; not required" }
  ]
}
```

### 2.2 Decision events (per loan, on milestone advancement)

When a UW makes a decision on a loan (Conditional Approval, Cleared to Close, Suspend, Decline, etc.), we'd push that decision so:
- The portal reflects the loan's state to brokers/borrowers
- Your downstream LOS/CRM stays in sync

**Proposed shape:**

```json
{
  "tenantId": "npnqm-twin",
  "externalLoanId": "<your loan_number>",
  "decisionAt": "2026-05-15T20:30:00Z",
  "decisionBy": "uw-user-id",
  "decisionType": "ConditionalApproval | ClearedToClose | Suspend | Decline | Counter",
  "conditions": [
    { "id": "uw-cond-1", "description": "Updated 4506-C", "category": "PTD", "status": "open" }
  ],
  "rationale": "Auto-summary or UW free-text",
  "minorityOpinions": []   // future — when our multi-agent pipeline disagrees
}
```

Decision events are **ordered**: a loan progresses through statuses. We'd send each transition as a separate event, with `decisionAt` as the authoritative ordering signal.

---

## 3. What we need from you (the questions that block us)

To wire the producer side, we need answers to:

### 3.1 Endpoint shape

- **One endpoint or two?** Single `POST .../loan-events` accepting a discriminated union, OR `POST .../recommended-docs` + `POST .../decision-events` as two distinct endpoints?
- **Base URL?** What's your inbound API URL? Are there tenant-specific subdomains?
- **Path conventions?** REST-style `/loans/{id}/...` or RPC-style `/curated-docs.update`?

### 3.2 Authentication

- **Bearer token, mTLS, HMAC signature, or something else?** We currently support bearer tokens cleanly; HMAC signing is straightforward to add.
- **Credential rotation cadence** — how do you expect us to receive new tokens?
- **Per-tenant credential isolation** — we'd store your API key in a per-tenant credential vault (each NPNQM-twin tenant gets its own). Is there one shared credential per UAS instance or one per UAS-tenant?

### 3.3 Retry + delivery semantics

- **What's your endpoint's expected SLA?** Sub-second responses, async ack pattern, etc.
- **Idempotency key** — do you accept a client-supplied `idempotency_key` header so our retries don't double-write on your side?
- **What status codes should we retry on?** 5xx + 429 are standard; we'd respect `Retry-After` headers. Anything else?
- **Dead-letter behavior** — if we exhaust retries (we use exponential backoff: 1m → 5m → 30m → 2h → 12h, dead-letter after 5 attempts), what's the right escalation? Email to a contact? Webhook to a separate alerts endpoint?

### 3.4 Schema versioning

- **API versioning strategy?** URL-versioned (`/v1/...`), header-versioned (`Accept: application/vnd.npnqm.v1+json`), or unversioned-and-stable?
- **Deprecation cadence** — how much notice on breaking changes?

### 3.5 Document-level questions

- For the curated-docs push: **do you want the diff** (added + removed since last curation) or **the full current list** every time? Diffs are smaller; full lists are simpler and idempotent.
- For dismissed predictions: do you want them in the same payload (so the portal can show "predicted but cleared") or filtered out entirely?

### 3.6 Decision-level questions

- **Decision types** — are the values listed in §2.2 sufficient, or do you have a different enum?
- **Condition lifecycle** — once a decision pushes, how do you handle subsequent condition clear/satisfy events? Separate `condition.cleared` event, or implicit via the next decision push?

---

## 4. Suggested next step

A 30-min sync to walk through these questions. We can adapt to whatever your portal API needs — we just need the contract pinned down so we can wire the producer side without guesswork.

Alternatively, if you have an OpenAPI spec, Postman collection, or even a README with sample request/response pairs, those alone are enough for us to start. The questions in §3 cover everything we'd otherwise discover through trial-and-error.

---

## 5. Timeline once we have the contract

Once we have answers to §3, we can ship Spec 2 (outbound writeback) in about a week:
- Days 1-2: schema design + Zod validation of your accepted shape + outbox table
- Days 3-4: signed-webhook dispatcher with retry + dead-letter
- Days 5-6: curation-trigger wiring (UW accepts → push) + decision-event wiring (milestone advance → push)
- Day 7: integration tests against a mock portal endpoint + ops runbook

The pieces are largely additive to the existing infrastructure (we already have a worker pattern with advisory locks, audit logs, and a webhook-deliveries table from earlier work).

---

*Receiver is live. Producer is waiting on your contract. Looking forward to closing the loop.*
