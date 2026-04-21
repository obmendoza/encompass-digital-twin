# Encompass AI Underwriting Platform — Product Roadmap

> From sandbox to production: a multi-role, multi-agent underwriting platform where AI handles volume and consistency, humans provide judgment and accountability, and the system continuously improves from every decision.

---

## Vision

Replace the traditional linear underwriting pipeline (processor → closer → UW → decision) with an **AI-orchestrated loop** where:

1. **Multiple specialized AI agents** divide the underwriting workload (income analysis, credit review, compliance, document processing, risk scoring)
2. A **Virtual Assistant (VA)** coordinates the agents, assembles findings, and presents a structured Audit Report
3. The **Underwriter (UW)** reviews the Audit Report, applies judgment on edge cases, and records the final decision
4. The system **learns from every UW decision** — calibrating agent confidence, refining prompts, and flagging patterns where agents consistently disagree with humans

The UW never touches routine work. The AI handles 80% autonomously. The UW focuses entirely on judgment calls — the 20% that justifies their expertise.

---

## Role Architecture

### Three roles, one platform

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│   DEMO USER                    VIRTUAL ASSISTANT          UNDERWRITER   │
│   (read-only explorer)         (AI + human HITL)          (final auth.) │
│                                                                         │
│   ┌─────────────────┐          ┌──────────────────┐     ┌────────────┐ │
│   │ Pipeline view    │          │ VA Dashboard     │     │ UW Review  │ │
│   │ Loan explorer    │          │ ├─ Assigned loans│     │ Queue      │ │
│   │ Scenario Workshop│          │ ├─ Agent status  │     │ ├─ Pending │ │
│   │ Agent demo       │          │ ├─ HITL inbox    │     │ ├─ In Work │ │
│   │ Read-only screens│          │ └─ Audit Reports │     │ └─ Decided │ │
│   └─────────────────┘          └──────────────────┘     └────────────┘ │
│                                         │                      │        │
│                                    Prepares                Reviews      │
│                                         ▼                      ▼        │
│                              ┌──────────────────────────────────────┐   │
│                              │         AUDIT REPORT                 │   │
│                              │  ┌────────────────────────────────┐  │   │
│                              │  │ Executive Summary              │  │   │
│                              │  │ Agent Findings (by specialist) │  │   │
│                              │  │ Risk Assessment Matrix         │  │   │
│                              │  │ Compliance Checks              │  │   │
│                              │  │ Recommended Decision + Conf.   │  │   │
│                              │  │ Minority Opinions (if agents   │  │   │
│                              │  │   disagreed)                   │  │   │
│                              │  │ Supporting Documents           │  │   │
│                              │  └────────────────────────────────┘  │   │
│                              └──────────────────────────────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Role → Feature mapping (existing + new)

| Feature | Demo | VA | UW | New? |
|---------|------|----|----|------|
| Pipeline / loan browser | ✅ read | ✅ assigned only | ✅ queue view | Modify |
| Transmittal Summary | ✅ read | ✅ read | ✅ read + decide | Existing |
| 1003 / URLA Pages | ✅ read | ✅ read | ✅ read | Existing |
| Income Analysis + bank stmt grid | ✅ read | ✅ run agent + edit | ✅ review + override | Existing |
| eFolder + IDP + Stare & Compare | ✅ read | ✅ upload + extract + push | ✅ review + clear conditions | Existing |
| Credit Report | ✅ read | ✅ read | ✅ read | Existing |
| Appraisal / Property | ✅ read | ✅ read | ✅ read | Existing |
| Compliance | ✅ read | ✅ read | ✅ read + override flags | Existing |
| Conversation Log | ✅ read | ✅ read (own loans) | ✅ read (all) | Existing |
| Program Overlays | ✅ read | ✅ read | ✅ read + exception approval | Existing |
| Scenario Workshop | ✅ full | ❌ | ❌ | Existing |
| Run AI Agent | ✅ demo | ✅ trigger multi-agent | ❌ read results only | Modify |
| HITL Inbox | ✅ read | ✅ respond + escalate | ✅ override | Existing |
| Recommendation Panel | ✅ read | ✅ stage | ✅ accept / reject / override | Existing |
| VA Dashboard + Avatar | ❌ | ✅ own dashboard | ❌ | **New** |
| Loan Assignment System | ❌ | ✅ receive assignments | ✅ assign / reassign | **New** |
| Multi-Agent Pipeline | ❌ | ✅ orchestrate | ✅ monitor | **New** |
| Structured Audit Report | ❌ | ✅ generate | ✅ review + sign-off | **New** |
| UW Decision Panel | ❌ | ❌ | ✅ decide + rationale + sign | **New** |
| Override Workflow | ❌ | ❌ | ✅ override + document why | **New** |
| Send-back-to-VA | ❌ | ✅ receive back | ✅ send back with notes | **New** |
| Performance Metrics | ✅ summary | ✅ own metrics | ✅ team dashboard | **New** |
| Learning / Feedback Loop | ❌ | ❌ | ✅ provide feedback | **New** |

---

## Multi-Agent Orchestration

### Five specialist agents (replace the single `mlb-uw-agent`)

```
                    ┌───────────────────────┐
                    │   VA Orchestrator     │
                    │   (coordinator agent)  │
                    └───────┬───────────────┘
                            │ dispatches
            ┌───────────────┼───────────────────────┐
            │               │               │       │
    ┌───────▼────┐  ┌───────▼────┐  ┌───────▼───┐  │
    │ Doc Agent  │  │ Income     │  │ Credit    │  │
    │            │  │ Agent      │  │ Agent     │  │
    │ • IDP      │  │ • Bank     │  │ • Trade-  │  │
    │ • Classify │  │   stmt     │  │   lines   │  │
    │ • Stack    │  │   calc     │  │ • Risk    │  │
    │ • Link to  │  │ • DSCR     │  │   score   │  │
    │   conds    │  │ • Asset    │  │ • Dispute │  │
    │ • Verify   │  │   depl.    │  │   flags   │  │
    └────────────┘  │ • Trend    │  └───────────┘  │
                    │   analysis │          ┌───────▼───┐
                    └────────────┘          │ Compliance│
                                           │ Agent     │
                                           │ • QM/ATR  │
                                   ┌───────▼───┐│ HPML  │
                                   │ Risk      ││ Geo   │
                                   │ Agent     │└───────┘
                                   │ • Score   │
                                   │ • Comp.   │
                                   │   factors │
                                   │ • Audit   │
                                   │   Report  │
                                   └───────────┘
```

**How they work together:**

1. **VA Orchestrator** receives a loan assignment, dispatches all five agents in parallel
2. **Doc Agent** processes eFolder — classifies, extracts, links to conditions, flags missing docs
3. **Income Agent** runs the bank statement / DSCR / asset depletion worksheet, flags anomalies
4. **Credit Agent** analyzes tradelines, computes risk score, flags disputes and derogatories
5. **Compliance Agent** runs QM/ATR/HPML/geo checks, flags violations
6. **Risk Agent** synthesizes all findings into a composite risk score and generates the Audit Report

Each agent records its work to the Conversation Log in real-time. The VA Orchestrator monitors progress and handles inter-agent dependencies (e.g., Income Agent needs Doc Agent to finish IDP first).

When all agents complete, the Risk Agent produces the **Audit Report** — a structured, formatted document (not raw markdown) that the UW reviews.

### Agent disagreement

If agents disagree (Income Agent says approve, Risk Agent says suspend), the Audit Report includes a **"Minority Opinions"** section highlighting the disagreement. This is where UW judgment is most critical.

---

## Structured Audit Report

Replaces the current raw-markdown `pendingRecommendation.rationale` with a structured, sectioned report:

```
┌─────────────────────────────────────────────────────────────┐
│                    AUDIT REPORT                              │
│                    Loan #2501000101                          │
│                    Prepared by: VA-001 (mlb-uw-agent)       │
│                    Date: 2026-04-21                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. EXECUTIVE SUMMARY                                        │
│     Conditional Approval recommended. All major criteria     │
│     pass. Two conditions outstanding. No risk exceptions.    │
│                                                              │
│  2. AGENT FINDINGS BY SPECIALIST                             │
│     2.1 Document Review (Doc Agent)         ✅ Complete      │
│     2.2 Income Analysis (Income Agent)      ✅ Verified      │
│     2.3 Credit Assessment (Credit Agent)    ✅ Acceptable    │
│     2.4 Compliance Check (Compliance Agent) ✅ Clear         │
│                                                              │
│  3. RISK ASSESSMENT MATRIX                                   │
│     ┌──────────┬───────┬──────────┬────────┐                │
│     │ Factor   │ Score │ Weight   │ Result │                │
│     ├──────────┼───────┼──────────┼────────┤                │
│     │ LTV      │ 85    │ 25%      │ 21.25  │                │
│     │ DTI      │ 72    │ 20%      │ 14.40  │                │
│     │ FICO     │ 90    │ 20%      │ 18.00  │                │
│     │ Reserves │ 95    │ 15%      │ 14.25  │                │
│     │ Income   │ 78    │ 20%      │ 15.60  │                │
│     ├──────────┼───────┼──────────┼────────┤                │
│     │ TOTAL    │       │          │ 83.50  │                │
│     └──────────┴───────┴──────────┴────────┘                │
│     Risk tier: LOW (80-100)                                  │
│                                                              │
│  4. COMPLIANCE FLAGS                                         │
│     ✅ QM: Non-QM (by design)                                │
│     ✅ ATR: Compliant                                        │
│     ✅ HPML: Not triggered                                   │
│     ✅ Geo: No restrictions                                  │
│                                                              │
│  5. RECOMMENDED DECISION                                     │
│     CONDITIONAL APPROVAL — 83% confidence                    │
│     Outstanding conditions: 2 (PTD: bank stmts, 4506-C)     │
│                                                              │
│  6. MINORITY OPINIONS                                        │
│     None — all agents concur.                                │
│                                                              │
│  7. SUPPORTING DOCUMENTS                                     │
│     ✓ 12mo Bank Statements (verified via IDP)                │
│     ✓ 1003 Application                                       │
│     ✓ Appraisal Summary                                      │
│     ○ 4506-C (pending)                                       │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│  UW DECISION:  [Accept as-is]  [Modify]  [Override]  [Send  │
│                                                    back to  │
│                                                    VA]      │
└─────────────────────────────────────────────────────────────┘
```

---

## Virtual Assistant (VA)

### Avatar + Live Human Pairing

The VA is a hybrid: an AI agent system paired with an optional live human assistant.

- **AI mode (default):** The multi-agent pipeline runs autonomously. The VA avatar shows status: "Analyzing income...", "Running compliance checks...", "Generating audit report..."
- **HITL mode:** When the AI hits an escalation trigger (exception, low confidence, regulatory flag), the VA routes to a live human assistant who resolves the issue and returns control to the AI
- **Human takeover:** The live assistant can take full manual control at any time, with the AI watching and learning from the human's actions

The avatar serves as the UW's "point of contact" — they interact with the VA, not with individual agents. The VA abstracts away the multi-agent complexity.

```
┌─ VA Dashboard ──────────────────────────────────────┐
│                                                      │
│  🤖 VA-001 "Sofia"                    Status: Active │
│  ┌──────┐                                            │
│  │ 👩‍💼  │  Currently processing:                     │
│  │      │  Loan #2501000201 (Kim, David)             │
│  └──────┘  Stage: Income Analysis (3/5 agents done)  │
│                                                      │
│  📊 My Queue                                         │
│  ┌────────────────────────────────────────────────┐  │
│  │ #2501000201  Kim, David      🔄 In Progress    │  │
│  │ #2501000203  Nakamura, K.    ⏳ Queued          │  │
│  │ #2501000108  Silva, Lucas    ✅ Report Ready    │  │
│  │ #2501000112  Carter, Devin   🔙 Sent Back      │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  📈 Today: 12 processed, 3 escalated, 1 sent back   │
└──────────────────────────────────────────────────────┘
```

---

## Performance Metrics & Continuous Learning

### Metrics Dashboard

```
┌─ Platform Metrics ──────────────────────────────────┐
│                                                      │
│  Throughput          Quality            Learning     │
│  ────────────        ────────           ────────     │
│  47 loans/day        92% auto-approve   +3.2% conf.  │
│  14 min avg          3 HITL escalations calibration   │
│  99.7% uptime        0 compliance flags this month   │
│                                                      │
│  Agent Accuracy (vs UW final decision)               │
│  ┌────────────┬──────────┬────────────┐             │
│  │ Agent      │ Accuracy │ Trend      │             │
│  ├────────────┼──────────┼────────────┤             │
│  │ Income     │ 94.2%    │ ↑ +1.3%    │             │
│  │ Credit     │ 97.1%    │ → stable   │             │
│  │ Compliance │ 99.8%    │ → stable   │             │
│  │ Doc Review │ 91.5%    │ ↑ +2.8%    │             │
│  │ Risk Score │ 88.3%    │ ↑ +4.1%    │             │
│  └────────────┴──────────┴────────────┘             │
│                                                      │
│  Override Analysis                                   │
│  Most common UW overrides:                          │
│  1. DTI exception (compensating factors) — 34%      │
│  2. Income calculation adjustment — 22%             │
│  3. Condition waiver — 18%                          │
│  Agent is learning: DTI exception accuracy ↑12%     │
│  in last 30 days from UW feedback                   │
└──────────────────────────────────────────────────────┘
```

### Continuous Learning Loop

```
UW makes decision → differs from agent recommendation
        │
        ▼
Feedback captured: { override_type, rationale, loan_context }
        │
        ▼
Pattern analyzer groups similar overrides
        │
        ▼
Prompt refinement engine generates updated agent instructions
        │
        ▼
A/B test: new prompt vs baseline on historical loans
        │
        ▼
If improvement verified → deploy updated agent behavior
        │
        ▼
Agent accuracy improves → fewer HITL escalations → higher throughput
```

This is the flywheel: **more UW decisions → better agent accuracy → less UW workload → UW focuses on harder loans → even better training data → even better agents.**

---

## Git Branching Strategy

```
main                    ← production (deployed on Railway)
 ├─ develop             ← integration branch
 │   ├─ feature/auth-oauth        ← Phase 1: OAuth + roles
 │   ├─ feature/va-dashboard      ← Phase 2: VA dashboard + assignment
 │   ├─ feature/multi-agent       ← Phase 2: Multi-agent pipeline
 │   ├─ feature/audit-report      ← Phase 2: Structured audit report
 │   ├─ feature/uw-decision-flow  ← Phase 3: UW review + override
 │   ├─ feature/metrics           ← Phase 4: Performance metrics
 │   └─ feature/learning-loop     ← Phase 4: Continuous learning
 │
 ├─ release/v1.1        ← Auth + roles release
 ├─ release/v1.2        ← VA + multi-agent release
 ├─ release/v1.3        ← UW decision flow release
 ├─ release/v1.4        ← Metrics + learning release
 └─ release/v2.0        ← Multi-tenant scale release
```

**Branch rules:**
- `main` — protected, deploy-on-merge, requires PR review
- `develop` — integration, CI runs full test suite
- `feature/*` — one branch per feature, squash-merge to develop
- `release/*` — cut from develop, only bugfixes, merge to main + back to develop
- Hotfixes branch from main, merge to main + develop

---

## Phased Delivery

### Phase 1: Auth + Roles (v1.1)

**Goal:** Multi-user platform with role-based access.

| Task | Details |
|------|---------|
| OAuth provider | Supabase Auth (already have Supabase) — Google + email/password |
| Role model | `demo` (read-only), `va` (process loans), `uw` (decide loans), `admin` |
| Session management | JWT tokens, middleware on API + Next.js |
| Role-gated UI | Navbar shows role badge, features hidden/disabled by role |
| User management | Admin panel for creating users, assigning roles |
| Audit trail | Every action tagged with authenticated user ID (replaces hardcoded `uw-local`) |

**Estimated scope:** 2-3 weeks

### Phase 2: VA + Multi-Agent (v1.2)

**Goal:** The VA dashboard, loan assignment system, and multi-agent pipeline.

| Task | Details |
|------|---------|
| VA Dashboard | New `/va` route — assigned loans, agent status, queue |
| Avatar system | Configurable VA persona (name, avatar, style) |
| Loan assignment | Admin/UW assigns loans to VAs; VA sees only their queue |
| Multi-agent pipeline | Split current single agent into 5 specialists |
| Agent orchestrator | Coordinator that dispatches specialists, handles dependencies, assembles results |
| Structured Audit Report | Replace raw markdown with sectioned JSON → rendered report |
| Real-time agent activity | Enhanced live feed showing which specialist is running |

**Estimated scope:** 4-6 weeks

### Phase 3: UW Decision Flow (v1.3)

**Goal:** Formal UW review and decision workflow.

| Task | Details |
|------|---------|
| UW Review Queue | New `/uw` route — loans with completed Audit Reports awaiting decision |
| Decision Panel | Accept / Modify / Override / Send-back-to-VA with structured rationale |
| Override workflow | UW overrides agent recommendation — must document why (dropdown + free text) |
| Send-back flow | UW returns loan to VA with notes — VA re-runs specific agents |
| Decision recording | Separate from loan state — creates an immutable decision record |
| Digital signature | UW "signs" the decision with their authenticated identity |

**Estimated scope:** 2-3 weeks

### Phase 4: Learning & Metrics (v1.4)

**Goal:** The system gets smarter with every decision.

| Task | Details |
|------|---------|
| Metrics dashboard | New `/metrics` route — throughput, accuracy, override analysis |
| Feedback capture | When UW overrides, structured feedback stored |
| Confidence calibration | Compare agent confidence vs actual UW agreement rate |
| Override pattern analysis | Cluster similar overrides, identify systematic agent blind spots |
| Prompt refinement | Generate improved agent prompts from feedback patterns |
| A/B testing framework | Test refined prompts against baseline on historical loans |
| Agent accuracy tracking | Per-specialist accuracy over time with trend indicators |

**Estimated scope:** 3-4 weeks

### Phase 5: Scale (v2.0)

**Goal:** Multi-tenant production platform.

| Task | Details |
|------|---------|
| Multi-tenant | Organization-level isolation, per-org settings |
| Skill-based VA assignment | Route loans to VAs based on program expertise |
| Real-time collaboration | UW + VA on same loan simultaneously (WebSocket) |
| Guideline version management | Each guideline version tracked, decisions pinned to version used |
| Production integration APIs | Webhook for LOS integration, MISMO export |
| SLA monitoring | Alert when loans exceed time-in-queue thresholds |

**Estimated scope:** 6-8 weeks

---

## Technology Additions

| Component | Current | Phase 1 | Phase 2+ |
|-----------|---------|---------|----------|
| Auth | None | Supabase Auth (OAuth) | Same |
| State | In-memory + Supabase persist | Same | Event-sourced Postgres |
| File storage | Supabase Storage | Same | Same |
| Agent | Single Claude Opus | Same | Multi-agent (Opus orchestrator + Sonnet specialists) |
| Real-time | Polling (3s) | Same | WebSocket (Supabase Realtime) |
| Search | None | None | pgvector for guideline RAG |
| Monitoring | Console logs | Structured logging | OpenTelemetry + Grafana |
| CI/CD | Manual Railway deploy | GitHub Actions → Railway | Same + staging environment |

---

## What Makes This Mind-Boggling

1. **AI agents that specialize** — not one generalist, but five domain experts that collaborate, debate, and produce a consensus (or flag disagreement)

2. **A VA that feels like a colleague** — avatar, personality, real-time status updates. The UW doesn't interact with "the system" — they interact with Sofia (or whatever the VA is named), who happens to orchestrate five AI specialists behind the scenes

3. **The learning flywheel** — every UW override makes the AI smarter. Within months, the system adapts to each UW's judgment patterns. A new UW onboards and the system already knows the team's standards

4. **Minority opinions** — when agents disagree, the UW sees the disagreement explicitly. "Income Agent says approve, Risk Agent says suspend because of declining trend." This is more transparent than a human committee

5. **The audit trail is the training data** — every action, every override, every rationale is captured. This is the dataset that makes the next generation of agents better. The platform doesn't just assist underwriting — it accumulates institutional knowledge

6. **Economics** — a VA processing 47 loans/day at 92% auto-approve means one UW reviews only 4 loans that need judgment. Current industry: one UW handles 3-5 loans/day. This is a 10x multiplier on UW capacity

---

*This roadmap transforms the Encompass Digital Twin from a sandbox into a production platform where AI and human expertise amplify each other — the AI handles volume and consistency, the UW provides judgment and accountability, and the system continuously improves from every decision made.*
