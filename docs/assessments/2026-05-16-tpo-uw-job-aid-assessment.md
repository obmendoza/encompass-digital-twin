# TPO Non-QM UW Job Aid — Architectural Assessment

**Date:** 2026-05-16
**Sources:**
- NPNQM Tenant, *Job Aid: TPO Non-QM Underwriting* (60 pages, footer date `10.28.22`)
- NPNQM Tenant, 10 Encompass screen captures (live production, May 2026) — addendum at end

**Source date caveat:** Job Aid footer reads `10.28.22` — **3.5 years old**. The 2026 screen captures confirm most of the 12-phase shape and field inventory is still current, but recommend NPNQM confirm specifics for state condition sets and BSA process. The screens show **Encompass Build 26.1.0.3** (Ellie Mae cloud / Encompass Anywhere SaaS, host `ea.elliemae.net`) — confirms hosted-deployment integration model, not on-prem.

This assessment maps the Job Aid against our current architecture (PC v2, Two-Source Coexistence UI, ROADMAP Phase 2 multi-agent plan) and the Spec 2 outbound writeback that's waiting on NPNQM's contract.

---

## TL;DR — Two findings that reshape our roadmap

### Finding 1: NPNQM's BSA Team competes with our Income Agent

The Job Aid is explicit (p.22):

> *"All bank statement income calculations are performed by the BSA Team prior to the loan being assigned to an underwriter. … The BSA Team is accountable for the calculation and conditions added. The underwriter should not recalculate or re-assess the income."*

Our ROADMAP Phase 2 Income Agent does its own income calculation from bank statements. In the NPNQM tenant that is **not what a UW does** — they consume a worksheet produced upstream by a separate BSA team. Re-calculating would duplicate work, contradict the canonical worksheet, and produce a different number that the UW has no authority to use anyway.

**Implication:** The Income Agent is tenant-shaped, not single-shaped.
- `npnqm-twin`: consume the BSA worksheet (or its portal-LLM equivalent in `document_requests` from Spec 1.5); only re-calculate for non-bank-statement doc types (Full Doc, 1099, P&L+BS, Asset Utilization).
- `demo` / future tenants: full calculation as originally designed.

This is the most consequential single divergence between the Job Aid and our agent model. It says: **agents are per-tenant configurable, not universal.** It also reframes Phase 2 — we're not building one Income Agent, we're building an Income Agent **role** with tenant-specific implementations and skip-paths.

### Finding 2: The Condition Review cycle is iterative, not one-shot

Our current model is one-shot: PC v2 predicts → UW accepts/dismisses → done. NPNQM's reality is a **loop**:

```
TPO Initial UW → conditions added
   ↓
RM uploads docs, marks TPO Cond. Submitted
   ↓
UW Comparison: what loan terms changed since last touch? (red text in Current Data)
   ↓
Per-condition review: Fulfilled? If insufficient → REVISED prefix + Re-requested flag → back to RM
   ↓
Loop until all PTD cleared → CTC review → Final Mavent → Clear to Close
```

Three primitives in this cycle that we do not currently model:

1. **Milestone state machine** — `TPO_Initial_Underwrite` ⇄ `TPO_Cond_Submitted` → `Clear_To_Close` (and orthogonal: `Suspense`, `DFT/Adverse_Action`). The UW toggles `TPO_Cond_Submitted.finished = false` to bounce the loan back to RM. This is workflow infrastructure that PC v2 has no concept of.

2. **UW Comparison primitive** — a snapshot-diff between successive condition-review iterations. *"Items that have changed will show in red text in the Current Data column."* The UW reviews the diff first, accepts the changes, then proceeds. This is a first-class workflow object, separate from the conditions themselves.

3. **Condition lifecycle states + revision convention** — conditions carry `PTA | PTD | PTF | PTP` prior-to-state, an `Owner` (UW / RM / Client / Closer), and a `Re-requested` flag with a `**MM/DD REVISED INIT: …**` description prefix convention encoding revision history. Our `predicted_conditions` schema captures status (pending/accepted/dismissed) but none of this lifecycle.

**Implication:** Modeling the cycle is more architecturally consequential than the Encompass field inventory. It's what makes our system actually useful for a working UW vs. being a fancier prediction surface.

---

## How the 12-phase UW workflow maps onto our agents

The Job Aid documents 12 numbered phases + 3 cross-cutting sections (Condition Review, CTC Review, Adverse Action). Mapping these onto the ROADMAP Phase 2 multi-agent plan (Doc / Income / Credit / Compliance / Risk + VA Orchestrator):

| Job Aid phase | Current coverage | Gap |
|---|---|---|
| 1. Open Loan | None | Workflow Orchestrator + milestone state machine |
| 2. Review Loan Notes | None | Conversation Log primitive (already exists in DB; not yet agent-consumed) |
| 3. Review Loan Structure | Doc Agent partial | Cross-screen consistency check (Project Type / Property Type / # Units must match across Borrower Summary, Transmittal, Non QM — *load-bearing for lock desk*) |
| 4. Open eFolder | Doc Agent | Mark-as-Reviewed, sort/filter Ready for UW |
| 5. Review All Docs (Prequal, Purchase Contract, Property/FEMA/Flood/Tax, Appraisal, Secondary Appraisal/CDA/SSR, Survey, Title 24-mo chain, 1003 Parts 1-4, ID, Credit, Assets, AUS) | Doc + Credit Agents partial | **Property review is its own ~300 lines of Job Aid** — appraisal acceptance, secondary appraisal product gating (SSR ≤2.5 or CDA, not Freddie SSR), FEMA disaster, flood cert, hazard insurance occupancy match, title vesting on refi vs purchase, CPL 60-day. This is bigger than "Doc Agent" |
| 6. Calculate Income | Income Agent | **BSA mismatch — see Finding 1** |
| 7. Update Encompass (Non QM, Transmittal, UW Summary, UW Summary Page 2, File Contacts, Doc Exp, Vesting) | None | This is the **outbound side-effect** of every agent finding — the LenderAdapter target for Spec 2 |
| 8. DRIVE Report (DataVerify fraud/audit) | None | Fraud/identity verification specialist — AKA collection, Employer/Borrower/REO/MERS profiles, occupancy map, alert clearing with score-to-1000 target |
| 9. Add Conditions (Automated + Sets + Free Form, state-specific, distinctive) | PC v2 | PC v2 covers prediction; missing: PTA/PTD/PTF/PTP lifecycle, Owner field, state overlays (CA/DE/IL/ME/NY/NJ/TX), distinctive conditions (Appraisal:, Misc: Non-Conditioned Items, TPO – Closing: Doc Expirations, Verbal VOE waiver for DSCR) |
| 10. Review Decision (prelim print) | Risk Agent (Audit Report) | Output mapping to NPNQM's TPO Enhanced Conditional Approval / Suspense Notification forms |
| 11. Communicate Decision (UW Summary write, milestone advance, auto-emails) | None | Outbound — this is Spec 2's "decision events" |
| 12. Update Loan Notes | None | Auto-summary generator using Loan Notes Template |
| Condition Review cycle | None | **See Finding 2** — milestone state machine, UW Comparison, revision convention |
| 2nd Level Review | None | Routing primitive (sub-skill of "approval workflows" we already have for KB versions) |
| Exception Process | None | Comments/Guidelines Deviation → exception form → 2nd Level Review → approval — workflow we don't model |
| Suspense | None | 24-hour hold, suspense conditions per category, UW Summary Page 2 suspense date+reason |
| CTC Review | None | Final checklist (PTD/PTC/PTF/PTP cleared, ALR form, final DRIVE→1000, final Mavent, Doc Expiration recheck, eFolder cleanup, ULDDs) |
| Adverse Action / DFT | None | DFT queue, Processor Details, route to UW management |

---

## Gaps grouped by class

### A. Agent specialization (architecture-level choice — needs your decision)

**Option A (lighter): keep 5-agent decomposition; fold property/fraud/identity into existing agents.**
- Property review (FEMA/flood/title/appraisal/secondary appraisal/24-mo chain) → expand **Doc Agent**.
- DRIVE fraud alerts → fold into **Compliance Agent** (already does QM/ATR/HPML).
- Identity/AKA cross-reference → fold into **Doc Agent**.
- *Pros:* less orchestration overhead, fewer agent boundaries, matches existing ROADMAP commitment.
- *Cons:* "Doc Agent" balloons in scope; the property review alone is ~300 lines of Job Aid; lossy if any one of these grows further.

**Option B (heavier): split into 7-8 specialists.**
- Doc Agent (eFolder operations, IDP, stacking, classification, Reviewed-status)
- Property Agent (appraisal acceptance, CDA/SSR gating, FEMA/flood, title vesting, 24-mo chain)
- Income Agent (tenant-shaped per Finding 1)
- Credit Agent (tradelines, derogs, AKAs, address history)
- Fraud Agent (DataVerify DRIVE, alert clearing, score→1000, occupancy map)
- Identity Agent (ID docs, SSN cross-ref, citizenship) — *or fold into Credit*
- Compliance Agent (Mavent, HPML, QM/ATR, flipping, geo, state overlays)
- Risk Agent (synthesizes findings + Audit Report)
- *Pros:* clean separation, each specialist has a tractable scope, matches the Job Aid's natural sectioning.
- *Cons:* more inter-agent contracts, more orchestrator complexity, more deferred work to ship.

**Recommendation:** Option B for the long term (the Job Aid's natural sectioning is a signal that NPNQM's domain experts split work this way; matching the seam reduces friction). But Option A is shippable sooner and the seams can be carved later. Your call.

### B. Workflow primitives (additive; not in current ROADMAP)

These are new system-level objects, not specific to any agent:

- **Milestone state machine** — `TPO_Initial_Underwrite` ⇄ `TPO_Cond_Submitted` → `Clear_To_Close`, with `Suspense` and `DFT` orthogonal terminal states. Toggle-based bounce-back semantics.
- **UW Comparison snapshot/diff** — captured at each `TPO_Cond_Submitted` transition; diffs against prior snapshot; surfaces what fields changed (red text in current UI).
- **Condition lifecycle extension** — add `prior_to` (PTA/PTD/PTF/PTP), `owner` (UW/RM/Client/Closer), `re_requested_at`, `revision_history` to `predicted_conditions`. Several of these can ride on existing `portal_metadata` JSON; some warrant promotion to columns.
- **Document Expiration tracking** — per-doc receipt-date + expiration-days → expiration-date table; surfaced via the catch-all `TPO – Closing: Document Expirations` condition; the UW uses the *earliest* expiration for the decision expiration date.

### C. Decision/sign-off workflows (mostly orthogonal to agents)

- **2nd Level Review** — required for: all suspensions, recommended denials, no-lending-authority UWs, optionally condos/trusts/entity/exceptions/escrow holdbacks. Similar in shape to our KB version two-key approval workflow; the primitive may be reusable.
- **Exception Process** — Comments/Guidelines Deviation field on Non QM → Non QM Exception Form (printable) → 2nd Level Review → approval → exception summary on Transmittal. Tightly coupled to 2nd Level Review.
- **Suspense workflow** — 24-hour hold between suspense decision and milestone advance; suspense conditions per category; UW Summary Page 2 suspense date + reason; do-not-suspend-after-approved rule.
- **Adverse Action / DFT** — out-of-scope for UW; routes to UW management via DFT queue.

### D. Doc/data tracking conventions (NPNQM-specific)

- **AKA collection** — per-borrower list from DRIVE Borrower Profile, semicolon-separated on Borrower Information Vesting screen.
- **REVISED-condition prefix** — `**MM/DD REVISED INIT: [reason]**` prepended to original condition description on re-request. This is parseable structured data masquerading as free text — worth promoting to a structured `revision_history` array as we model the condition lifecycle.
- **Alternative Loan Review Form (ALR)** — required for all Non-QM loans at CTC; auto-populated from Encompass; placed in UW Decision bucket.
- **Doc Expiration catch-all** — `TPO – Closing: Document Expirations` condition aggregates *all* document expirations into a single condition description. This is the **canonical UW-facing expiration view**, distinct from the per-document data on the Doc Expiration screen.

### E. Tenant-config mismatches (architectural pressure on per-tenant adapters)

- **BSA Team consumption** (Finding 1) — Income Agent role is configured per tenant.
- **Condition sets are per-channel** — TPO Bank Statement / TPO DSCR / TPO Full Doc for Wholesale; NDC Tier One sets for NDC. Plus state overlays. Plus distinctive conditions.
- **Doc Type code A/F/C/D** — Alternative / Full / No-Doc-DSCR-≥0.75 / No-Ratio-DSCR-<0.75. Drives the condition set selection.
- **Channel-specific gates** — NDC requires `Underwriting Delegated = NO` (else conditions don't surface in their portal). NDC uses Client's credit report exclusively. NY/NJ has wet-sig vs e-sig differences.

These argue for the LenderAdapter pattern (already in use for inbound) being applied symmetrically outbound — and for **per-channel sub-adapters** below the per-tenant adapter.

---

## Spec 2 (outbound writeback) — what changed, what didn't

### What the Job Aid grounds for us

The Job Aid gives us a **complete inventory of fields** the UW touches in Encompass: roughly 80+ distinct fields across Non QM screen, Transmittal Summary, UW Summary, UW Summary Page 2, Document Expirations, Borrower Information Vesting, File Contacts, 1003 URLA Parts 1-4. We now know precisely **what semantic content** we'd want to send back to NPNQM's portal — that surface area is no longer hand-waved.

This grounds **our internal representation** (clean, normalized, schema-typed) and **what the outbound LenderAdapter must translate to** (NPNQM-tenant-specific shapes).

### What is NOT unblocked

Looking at our Spec 1.5 inbound experience: NPNQM's portal payload (`document_requests`, `scenario_summary`, `seen_conflicts`, `stats`) used its *own* vocabulary — not Encompass field names. The portal is an analyzer layer that consumes from Encompass but speaks its own JSON. Their outbound *receiving* API will likely do the same: their own field names, their own auth, their own idempotency convention, their own versioning.

The §3 readiness-note questions remain unanswered:
- Endpoint shape (one endpoint or two? URL? path style?)
- Authentication (bearer / HMAC / mTLS?)
- Retry semantics (idempotency-key header? retry status codes? dead-letter behavior?)
- Schema versioning (URL-versioned? header-versioned?)
- Diff vs full-list for curated docs
- Decision-type enum

So: **the Job Aid does not let us bypass the NPNQM sync.** What it does do is let us draft a richer, more concrete §2 of the readiness note — moving from generic "curated documents + decision events" to a fully-typed Encompass-grounded internal schema that any reasonable portal contract can be adapted onto.

### Three outbound message types (revised)

The original readiness note proposed two. The Job Aid surfaces a third (granular condition status updates with revision history) and a possible fourth (UW Comparison snapshots). All four would be produced by our LenderAdapter from the same internal events:

1. **Decision events** — milestone advance, including approval/suspense/CTC/counteroffer-restructure, with UW Summary internal + Transmittal external comments, exception details, 2nd-level reviewer.
2. **Condition curation events** — full current condition list at a curation point, with prior-to/owner/category, plus dismissed predictions if NPNQM wants to surface them.
3. **Condition status events (per condition)** — individual fulfilled/re-requested/waived/cleared transitions with the structured equivalent of the REVISED prefix.
4. **(Optional) UW Comparison snapshot events** — pushed on `TPO_Cond_Submitted` transition; NPNQM's portal may or may not need these (their own UI may track this client-side).

### Existing bridge to leverage

Our `portal_metadata` JSONB column (added in Spec 1.5: `priority`, `tags`, `specifications`, `reasonsNeeded`) is the right home for: prior-to, owner, category, revision-history, distinctive-condition flag. **Use that existing column** before designing parallel data structures. Promote individual fields to top-level columns only when query patterns demand it.

---

## Recommended sequencing

### Immediate (no NPNQM unblock needed)

1. **Confirm Job Aid currency** — 30-min sync with NPNQM: is `10.28.22` the latest, or do they have a 2024+ revision? Especially: BSA Team workflow, state overlays, condition set names.
2. **Pick agent decomposition** (Option A vs B above) — this is your call.
3. **Draft condition lifecycle extension** — schema spec for PTA/PTD/PTF/PTP + owner + re-requested + revision-history on `predicted_conditions` (or on `portal_metadata`).
4. **Spec the milestone state machine + UW Comparison primitive** — new tables/objects, no agent work yet.
5. **Update readiness note §2** with the typed Encompass-grounded shapes from this assessment. Send as a *follow-up* to NPNQM ("here's our internal model — your receiving API can be adapted onto this") rather than as a contract.

### After NPNQM responds (Spec 2 proper)

6. **Outbound LenderAdapter for npnqm-twin** — per-channel sub-adapters (NDC vs Wholesale, doc-type A/F/C/D, state overlays).
7. **Outbox + retry/dead-letter worker** — already foreshadowed in the readiness note; the patterns from our inbound `doc-fetch` worker port over.
8. **Curation/decision-event triggers** — wire UI actions to outbound events.

### Longer-term (ROADMAP Phase 2 revision)

9. **Agent decomposition** per chosen Option A or B.
10. **Income Agent tenant-shaping** — BSA-worksheet-consumer mode for `npnqm-twin`.
11. **DataVerify DRIVE integration** — either Fraud Agent (Option B) or extension to Compliance Agent (Option A).
12. **Audit Report → UW Summary Page 2 mapping** — Strengths / Concerns / Credit / Appraisal / Exceptions sections as structured output of Risk Agent.

---

## Open questions (for NPNQM sync, regardless of Spec 2)

- Is the 10.28.22 Job Aid still current? Any newer revision?
- Is `npnqm-twin` portal's `document_requests` output the BSA worksheet equivalent, or is BSA a separate intake we'd also receive?
- Do you want our system to consume the *worksheet itself* (file attachment) or just the *computed monthly income numbers* (already in `document_requests`)?
- For curation outbound: diff or full list per round?
- For condition status events: granular per-condition pushes, or batched at milestone advance?
- Does your portal track UW Comparison snapshots client-side, or do you want us to push them?
- What's your enum for decision types? Suspense codes? Exception categories?

---

*This assessment grounds our internal model in the Job Aid's authoritative inventory but does not bypass the NPNQM contract negotiation for the wire format. The most consequential changes it implies are (a) Income Agent tenant-shaping, (b) modeling the iterative Condition Review cycle, and (c) the agent-decomposition choice — none of which require new specs from NPNQM to begin.*

---

## Addendum: 2026 Encompass Screen Observations

Ten production screen captures from `npnqm-twin`'s Encompass instance corroborate and refine the Job Aid findings. Key empirical confirmations and refinements below.

### A.1 Environment confirmed

- **Encompass Build 26.1.0.3**, hosted at `https://BE[id].ea.elliemae.net/$BE[id]` — this is **Ellie Mae Cloud / Encompass Anywhere SaaS**, not an on-prem ICE Mortgage Technology install. Integration model is hosted-API + Web Services, not direct database access.
- Captured users include `tpodvaldez`, `tharris`, `twright`, `jmerjudio` — RM / processor / closer / UW roles all visible in the data.

### A.2 Pipeline columns are structured fields (not just menu labels)

The `Underwriter - NonQM New UW Pipelin` pipeline view shows these as **real columns**, not derived/calculated text:
- `Underwriter`, `Loan Number`, `Borrower Name`, `Total Loan Amount`, `Loan Program`, `Loan Purpose`, `Select the NonQM`, `Credit Sc(ore)`, `Occupancy Typ(e)`, `Last Finished Milestone`, `Last Finishe(d Date)`, `2nd Lev(el)`, `Hold Date`, `Rush Approve`, `NQM Curren(t status)`

The visible pipeline filter logic:
> `Loan Status = Active Loan AND NONQM Loan = Yes AND TPO Company Name does not contain "test" AND Last Finished Milestone is any of TPO Submission;Submittal AND DFT Submitted Date = Empty Date Field`

**Implication:** `2nd Lev`, `Hold Date`, `Rush Approve`, `NQM Current` are **first-class fields** on the loan, not derived. Our outbound model should treat 2nd-level-review status and rush-approve as structured loan state, not free text in conversation log.

### A.3 Pipeline color legend (operational signals)

| Color | Meaning |
|---|---|
| Purple | CTC Review |
| Light blue | FEMA Disaster related |
| Green | TBD Loans |
| Red | Rush Request |
| Yellow | ICD Required (Initial Closing Disclosure) |
| Orange | DFT Requested (Deal Fell Through) |

These six states are the **operational categories** for routing — useful when designing the outbound API: a "loan state change" message type would emit transitions among these.

### A.4 NON QMv2 screen — empirical field inventory

This single screen captures roughly 60% of the meaningful outbound-API field surface. Empirically captured field structure:

**Per-borrower (parallel columns for borrower + co-borrower):**
- Name (First/Middle/Last/Suffix)
- Citizenship: checkboxes (US Citizen / Permanent Resident Alien / Non Permanent Resident Alien) + Country of Citizenship + Foreign National flag + Citizenship dropdown
- FTHB (First Time Home Buyer) flag
- Credit scores: Experian/FICO, TransUnion/Empirica, Equifax/BEACON
- "Non-Borr/Title Only" button (vesting variant)
- "Expiration Dates" button (per-borrower doc expirations)

**Calculated:** Credit Score for Decision Making (derived from per-bureau scores)

**Housing Payment History — matrix structure** (counts × periods × derog event types):

| Bucket | Period 1 | Period 2 | Derog event types (NA / count) |
|---|---|---|---|
| `x30x12` | 0 | — | BK (CH. 13) |
| `x60x12` | 0 | — | BK (OTHER) |
| `x90x12` | 0 | — | Foreclosure |
| `x120x12` | 0 | — | Short Sale/Mod (*Non-COVID Mods only*) |
| `x30x24` | 0 | — | Deed-In-Lieu |

Plus a `No Housing` flag (when borrower has no housing history at all).

**Loan terms:**
- Loan Program: free text product label (e.g., "Flex Select 30 Year Fixed - NON QM")
- Loan Term: months (e.g., 360)
- Interest Only: flag + IO term in months
- NQM Loan Term: product code (e.g., "30 YR FIXED") — **distinct from Loan Term**
- Purchase Loan with a Buydown: yes/no + Buydown Info sub-form
- Occupancy: Primary / Secondary / Investment
- Purpose / NQM Purpose: Purchase / Refi (two fields, one source-of-truth, one NQM-canonical)
- Total Loan Amt
- LTV / CLTV (separate fields)
- Note Rate / Qual Rate (separate fields)

**Property:**
- No (number of) Units
- Rural Property flag
- Leasehold (Yes/No + date)
- Purchase Price
- Appraised Value
- Property Type (Detached, …)
- NQM Prop Type (SFR, …) — **distinct from Property Type**
- AVM / Appraisal Info / Zillow buttons (external integrations)
- NQM Loan Doc Type (e.g., "Bank Stmts 12 Months Business") — product variant
- Loan Doc Type (A / F / C / D — code class)
- Asset Utilization # of months
- Expense Factor Used (Yes/No + Factor Req'd numeric)
- Gift Funds flag

**Reserves & residual:**
- Required Residual Income / Required Months Reserves
- Verified Residual Income / Verified Months Reserves (with refresh button)
- Cash To/From Borrower (positive = cash to close)

**ARM / DSCR sub-section:**
- ARM - Payment for Qualification (only on ARM products): Fully Indexed Rate, APM Info button
- DSCR Proposed Payment (shown on DSCR products)

**Property Flipping sub-section (HPML flipping rule support):**
- Seller's Acquisition Date
- Seller's Acquisition Price
- Subject Purchase Contract Date
- # of Days Acquisition to Contract (derived)
- % Increase in Value (derived)
- Flipping Guides Apply (Y/N)
- HPML Alert (flag — driven by Mavent)
- 2nd Appraisal added (flag)

**TPO Company Status** — sidebar widget showing Active / Application Pending (gates submission per Job Aid p.26).

**Implication for outbound API:** the NON QMv2 schema is the canonical decision-state surface. Spec 2 outbound messages should mirror this structure as the loan-state field (separate from condition list and decision events).

### A.5 NPNQM uses **TWO** Non QM screens

Forms menu confirms two distinct screens:
- `NON QMv2` (the one Job Aid documents)
- `Non QM - Delegated`

The Job Aid does not differentiate. Likely: NDC vs Wholesale, or delegated-authority vs non-delegated. **Action:** ask NPNQM which screen applies to which channel — this affects per-channel adapter design.

### A.6 Conditions table — structured columns confirmed

The Underwriting Conditions tab is a structured table, NOT free text. Columns:

| Column | Type | Values observed |
|---|---|---|
| Name | string | `Appraisal:`, `Credit: Address Variation(s)`, `Property: Title Company Documents (TPO)`, … |
| Description | text | Long-form, frequently containing REVISED-prefix markers (see A.7) |
| Source | enum | `Automated Con...` (Automated Conditions), `Manual`, `condition set` |
| Internal | bool | Yes/No |
| External | bool | Yes/No |
| Owner | enum | `UW`, `LC` (Loan Closer), … |
| Category | enum | `Property`, `Assets`, `Closing`, `Credit`, `Income`, `Misc` |
| Prior To | enum | `Docs` (= PTD), [also: Approval = PTA, Funding = PTF, Purchase = PTP] |
| Status | enum | `Cleared`, `Waived`, [also: pending, fulfilled, re-requested] |
| Date | date | acted-on date |

**Internal/External flags are structured** — they exist as columns. This is a richer condition model than `predicted_conditions.portal_metadata` currently captures. Likely `External=Yes` means visible in client portal; `Internal=Yes` means UW-only.

### A.7 REVISED-prefix convention has ≥5 variants in production

Observed in real condition descriptions on a single loan:

| Variant | Example |
|---|---|
| Triple-asterisk init | `***5/4 JB***Provide most recent asset statement(s)…` |
| `MM/DD UPDATE:` no asterisks | `4/9/2026 UPDATE: Provide evidence of duration for HOA…` |
| `**MM/DD UPDATE:**` asterisks | `**4/15/26 UPDATE: LOE ACH deposits from Elemental Direct…**` |
| `**MM/DD (INIT) …**` | `**4/9 (BR) NEED CONFIRMATION OF WIND AND HAIL***4/6 Quote provided, need full active policy**` |
| `**REV MM/DD INIT: …**` | `**REV 4/29: Income: CPA to confirm Chad's ownership…**` |
| `**UW Will clear at final review** EX: …` | (different semantics: future-action marker) |
| `MM/DD Ok to clear.` | `4/15/26 Ok to clear. Only applicable if you are making ch…` (status-change marker) |

**Implication:** the REVISED-prefix convention is **not standardized** across UW users. It carries genuine workflow data (revision history, future-action markers, status-change markers) but is encoded as ad-hoc text. This is a data-quality issue **and** an architectural opportunity:

- Promote to structured fields in our internal model: `revision_history[]` with `{ date, initials, type: "REVISE" | "FUTURE_ACTION" | "STATUS_CHANGE", note }`.
- Outbound LenderAdapter can re-serialize back to whichever prefix convention NPNQM prefers (or just append to a structured field if they update their portal to consume it).
- A migration / NLP pass could backfill structured history from existing free text.

This refines Finding 2: **the cycle isn't just iterative; the iteration history is currently encoded as parser-fragile text**. Modeling it properly improves observability + outbound fidelity.

### A.8 Automated Conditions catalog is finite and named

The Import Automated Conditions modal shows the seeded catalog (partial list visible):

- `Appraisal:`
- `Appraisal: Appraisal Delivery (TPO)`
- `Appraisal: Third Party Appraisal Review`
- `Assets: Asset Statements (NonQM)`
- `Closing: Approval Terms`
- `Closing: Documents required to be signed at closing:`
- `Closing: NonQM - Document Expirations` ← the catch-all I called out
- `Closing: NonQM - Max PITIA`
- `Closing: Verbal VOE for Borrower`
- `Closing: Verbal VOE for Co-Borrower`
- `Credit: Address Variation(s)`
- `Credit: Broker Signed 1003`
- `Credit: Primary Housing History`
- `Credit: Primary Identification`
- `Misc: Fraud Report (TPO)`
- `Misc: Initial CD (TPO)`
- `Misc: Initial LE (TPO)`
- (scrollable, more below)

**Implication:** PC v2's prediction names should align with this canonical catalog (`Category: Description` format with seeded names). This is concrete alignment work for our seed data — the matrix-resolver, doc-checklist-resolver, requirements-resolver outputs should map onto these literal names where applicable, so a UW reviewing PC v2's predictions sees familiar condition names.

### A.9 Conversation Log — two views, structured fields

The Job Aid mentions "Conversation Log" generically. The screens reveal **two distinct UIs** over what is likely one logical store:

**(1) Loan Notes screen** (Forms menu → Loan Notes):
- Input form: free-text body + `CTC Review` checkbox flag + Add button
- Below: Conversation Log Details panel showing entries in text form:
  ```
  Date Notes were added: 2/18/2026 6:15:11 PM (twright)
  Notes: Loan is being submitted for CTC review. All conditions have been met and should be satisfied.
  ```

**(2) Conversation Log screen** (Tools menu → Conversation Log):
- Tabular view with columns: `Date | User ID | Name | Company | Follow Up Needed`
- Per-entry detail panel with: Date, Name, Company, New Comments, Previous Comments

**Structured fields per entry:**
- `Date` (timestamp)
- `User ID` (username)
- `Name` (short subject — e.g., "Credit imported correctly")
- `Company` (optional)
- `Follow Up Needed` (Yes/No flag)
- `Comments` (body)

**Plus an optional `CTC Review` category tag** from the Loan Notes screen entry form.

**Implication:** Conversation Log is **not just a free-text feed** — it has structured subject/company/follow-up-flag fields. The outbound API should preserve these. The `Follow Up Needed` flag in particular is meaningful for SLA / task creation downstream.

### A.10 Tasks ≠ Conditions (separate first-class object)

Visible in the production loan view sidebar:
- **Tasks panel:** `CL - PTP Conditions Uploaded` / `CL - Purchase Advise` / `PC - Investor Upload`
- **Tools menu → Tasks** is a distinct screen from Underwriting Conditions

So Tasks and Conditions are separate Encompass objects. Tasks appear to be **role-pair workflow checkpoints** (CL = Closer, PC likely = Post-Close), while Conditions are UW-managed.

Our PC v2 model conflates these. **Action:** clarify with NPNQM whether outbound should also push Task updates, or only Conditions + Decisions.

### A.11 DataVerify DRIVE Report — structured sections

The Fraud/Audit Report panel reveals DRIVE output structure:

```
Summary of Findings: ADV
  Reference Number, Last Process Date, Requester

Identity
  First Name: Pass
  Last Name: Pass
  SSN: Cleared
  Date of Birth: Pass
  Address: Pass
  Phone: Pass
  Zip: Pass

Property Ownership History
  Borrower-related addresses, last 3 months: N
  Borrower-owned properties identified: Cleared (N)
  Borrower-related foreclosure activity events, last 7 years: N

MERS SSN Liens
  No. of active MERS liens identified: Cleared (N)

Employer - Company Search
  [employer name + status]
```

**Implication:** if we build a Fraud Agent (Option B from earlier) or extend Compliance Agent (Option A), the input shape is well-defined: structured pass/cleared/fail per check, with counts and aggregations. The target end-state per Job Aid is "score of 1000" (all alerts cleared). Each check is independently addressable.

### A.12 Additional Encompass screens not in the Job Aid

Forms/Tools menus surface screens the Job Aid doesn't cover but UWs use:

- **3rd Party Order Tracking** — appraisal/title/MI/flood order status
- **AUS Tracking** — DU/LP find status (when AUS used)
- **Disclosure Tracking** — LE/CD/eConsent state
- **Fee Variance Worksheet** — tolerance/cure tracking
- **LO Compensation** — loan officer comp setup
- **Anti-Steering Safe Harbor Disclosure** — TPO_LP requirement
- **Net Tangible Benefit** — NTB rule for refi
- **ECS Data Viewer** — Encompass Compliance Service?
- **TQL Services** — Total Quality Loan (Ellie Mae QC service)
- **MI Center** — Mortgage Insurance
- **NonQM Post Closing Request** — post-closing condition workflow
- **Underwriting** + **Request Underwriting** — workflow screens distinct from UW Summary

**Implication:** the outbound API needs to anticipate signals from these screens too — at minimum, AUS recommendation, Disclosure state, NTB outcome, MI selection.

---

## Refined recommendations (incorporating screen evidence)

The two headline findings (BSA mismatch + iterative cycle) hold and are reinforced. The screens add three refinements:

1. **REVISED-prefix variants are a data-quality + observability opportunity** (A.7). Promote revision history to structured fields in our model regardless of agent decomposition choice — this is a small, well-scoped piece of work.

2. **Two Non QM screens (NON QMv2 vs Non QM - Delegated)** suggest per-channel adapter design is unavoidable (A.5). Add this to the NPNQM sync agenda.

3. **Tasks vs Conditions distinction** (A.10) should be confirmed before Spec 2 design — does NPNQM want us to push Task updates or only Condition + Decision events?

The Automated Conditions catalog (A.8) gives PC v2 a concrete seed-data alignment target — worth a small follow-on PR to align our prediction names with NPNQM's canonical catalog.

---

*Screen captures from May 2026 production confirm the Job Aid's structural shape is current. The most consequential additions from the screens are: (1) the REVISED-prefix data-quality issue with a clear structured-history fix, (2) the per-channel Non QM screen duality, and (3) the Tasks-vs-Conditions distinction — none of which overturn the Job Aid analysis but all of which sharpen Spec 2's outbound contract.*
