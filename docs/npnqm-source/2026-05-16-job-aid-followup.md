# UAS ↔ NPNQM — Follow-up to TPO Non-QM UW Job Aid

**Date:** 2026-05-16
**From:** UAS Engineering
**Re:** Job Aid (`10.28.22` version) + Encompass screen captures shared
**Status:** Inputs received and assessed; questions below would unblock our next implementation cycle.

---

## Summary

Thank you for the Job Aid and the production Encompass screen captures. They give us a clear and authoritative picture of what your TPO Non-QM Underwriters actually do day-to-day — much more grounded than working from public domain alone. We've walked through all 12 numbered phases of the Job Aid, the three cross-cutting sections (Condition Review, CTC Review, Adverse Action), and the screens.

This note captures (1) what's now clear on our side, (2) two findings we want to confirm with you, and (3) a short list of questions whose answers would shape our next implementation cycle.

---

## 1. What's now clear on our side

From the Job Aid + screens, our internal model now has authoritative grounding for:

- The 12-phase UW workflow and SLAs (Rush CTC → Rush Cond → Rush New → CTC → Cond → New).
- The milestone state machine (`TPO_Initial_Underwrite` ⇄ `TPO_Cond_Submitted` → `Clear_To_Close`, with `Suspense` and `DFT` orthogonal).
- The NON QMv2 screen field inventory (per-borrower fields, Housing Payment History matrix, Property Flipping sub-form, ARM/DSCR sections, reserves, residual, cash to close).
- The Conditions table structure (Name, Description, Source, Internal/External, Owner, Category, Prior To, Status, Date).
- The Conversation Log structured fields (Date, User ID, Name, Company, **Follow Up Needed** Y/N, Comments).
- The DataVerify DRIVE report shape (Identity / Property Ownership History / MERS SSN Liens / Employer — pass/cleared per check, target score 1000).
- The Automated Conditions catalog (named entries like `Closing: NonQM - Document Expirations`, `Credit: Primary Housing History`, `Misc: Initial CD (TPO)`, etc.).
- The Encompass deployment shape: hosted on Ellie Mae Cloud (`ea.elliemae.net`, Build 26.1.0.3) — confirms hosted-API integration model.

---

## 2. Two findings we want to confirm with you

### Finding A: Bank statement income — the BSA Team owns the calculation, not the UW

The Job Aid (p.22) is explicit:

> *"All bank statement income calculations are performed by the BSA Team prior to the loan being assigned to an underwriter. … The BSA Team is accountable for the calculation and conditions added. The underwriter should not recalculate or re-assess the income."*

Our original design assumed the AI Underwriting Service would calculate bank statement income end-to-end. The Job Aid tells us this is wrong for `npnqm-twin` — the BSA Team is the authoritative producer; the UW consumes the worksheet.

**What we'd need from you to align:**

- Is the BSA worksheet currently exposed to your portal's analysis output (i.e., are the BSA-computed monthly income numbers already in the `document_requests` / `scenario_summary` payload we receive)? Or is BSA a separate intake we'd need to receive?
- Do you want our system to consume the **worksheet file itself** (Excel/PDF) or just the **computed monthly income numbers**?
- Are non-bank-statement doc types (Full Doc, 1099, P&L+BS, Asset Utilization) also pre-calculated by a team upstream, or is that where our system computes?
- Is "BSA Team" still the active operational structure in 2026? (The Job Aid is the `10.28.22` revision; we want to confirm currency.)

### Finding B: The Condition Review cycle is iterative — and the revision history is encoded as text prefixes

The Job Aid describes (and the screens confirm) an iterative cycle: TPO_Initial_Underwrite → TPO_Cond_Submitted → UW Comparison → re-requested with `REVISED` prefix → loop until CTC.

Looking at real conditions in the captured screens, the revision history is encoded as ad-hoc prefixes in the Description field, with at least 5 variants observed in a single loan:

- `***5/4 JB***Provide most recent asset statement(s)…`
- `4/9/2026 UPDATE: Provide evidence of duration for HOA…`
- `**4/15/26 UPDATE: LOE ACH deposits from Elemental Direct…**`
- `**REV 4/29: Income: CPA to confirm Chad's ownership…**`
- `**UW Will clear at final review** EX: 5/22 - Verify the exis…`
- `4/15/26 Ok to clear. Only applicable if you are making ch…`

**What we'd need from you to align:**

- Is there an internal style guide for the REVISED prefix, or is this UW-discretionary?
- If we capture revision history as a structured array on our side (`{date, initials, type, note}`), would you want us to surface that as structured data through the outbound API, or do you need us to serialize back to the text-prefix convention to fit your existing portal display?
- Does the **UW Comparison screen** snapshot/diff between condition-review iterations live in Encompass, or does your portal track it independently? (If Encompass-side, do you have an API to read those snapshots?)

---

## 3. Other questions whose answers shape our next cycle

### 3.1 Two Non QM screens

Our Forms menu shows both `NON QMv2` and `Non QM - Delegated`. The Job Aid only documents one. Which channels/scenarios use which?

- Are these delegated vs. non-delegated authority?
- NDC (Banked-Correspondent) vs Wholesale?
- Or another distinction?

This affects per-channel adapter design on our side.

### 3.2 Tasks vs Conditions

Encompass exposes Tasks (e.g., `CL - PTP Conditions Uploaded`, `PC - Investor Upload`) as a separate first-class object from Underwriting Conditions. For Spec 2 outbound, should we push:

- (a) Only Conditions + Decisions, or
- (b) Conditions + Decisions + Task lifecycle updates?

If (b), what Task naming convention should we follow? (e.g., `CL - …` = Closer, `PC - …` = Post-Close — please confirm.)

### 3.3 Automated Conditions catalog alignment

We saw the named, finite Automated Conditions catalog (`Appraisal:`, `Closing: NonQM - Document Expirations`, `Credit: Primary Housing History`, etc.). Could you share the full catalog (CSV or list)? Our AI predictions will produce far better UW ergonomics if the names align with your canonical catalog — instead of inventing parallel terminology.

### 3.4 Conversation Log fields

Should we treat the **Follow Up Needed** flag as a signal for routing/SLA on our side, or is it a UW-private bookkeeping flag we should leave untouched?

Should we preserve the **CTC Review** category tag (the checkbox on the Loan Notes input form) as a structured field on outbound conversation-log events?

### 3.5 Job Aid currency

The Job Aid footer reads `10.28.22`. The 2026 screens corroborate most of it, but some specifics may have drifted. Is the `10.28.22` revision still the canonical training document, or do you have a more recent revision (2024+) you can share?

Specific items most likely to have drifted:

- State-specific condition lists (CA / DE / IL / ME / NY / NJ / TX)
- Condition set names (TPO Bank Statement / TPO DSCR / TPO Full Doc; NDC Tier One sets)
- BSA Team workflow and contact (`bsarequest@npinc.com`)
- TPO appraisal / transfer policy details

---

## 4. Recap on the outbound API contract (still blocked from §3 of the readiness note)

The Job Aid + screens **do not** unblock the outbound contract questions from our earlier readiness note (2026-05-15). We still need:

- Endpoint shape (one endpoint or two? base URL? REST vs RPC path style?)
- Authentication (bearer / mTLS / HMAC?)
- Idempotency-key convention + retry/dead-letter semantics
- Schema versioning approach
- Diff vs full-list for curated documents
- Decision-type enum
- Condition lifecycle: granular per-condition pushes, or batched at milestone advance?

What the Job Aid **does** do is let us draft a much more concrete §2 (the messages we want to send), grounded in real Encompass field names. We can share that pre-typed catalog in a follow-up document if useful.

---

## 5. Suggested next step

A 30-min sync would resolve §2 (BSA + Condition Review confirmations) and §3 (the five concrete questions) much faster than email back-and-forth. After that we can either close out the outbound contract questions from the readiness note in the same call, or schedule a separate technical sync with whoever owns your portal API.

If a sync isn't feasible, written answers to §2 and §3 alone would be enough for us to ship the immediate, non-outbound work (condition-lifecycle modeling, structured revision-history capture, multi-agent role refinement). We can keep the outbound writeback on hold until your portal contract is ready.

---

*Thank you again for the Job Aid and screens — these are exactly the inputs we needed to make our system fit your operation rather than the other way around.*
