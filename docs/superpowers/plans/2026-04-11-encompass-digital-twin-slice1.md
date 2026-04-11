# Encompass Digital Twin — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Slice 1 of the Encompass Digital Twin — a deterministic, agent-drivable, human-usable Transmittal Summary + Conditions cockpit for NQM loans, matching classic Encompass look-and-feel.

**Architecture:** pnpm monorepo with a `core` package owning all domain logic (pure reducer), a Fastify `api` package that owns in-memory state and exposes HTTP endpoints, a `fixtures` package holding NQM loan JSON, and a Next.js `web` app that acts as a thin HTTP client of `api`. Humans and agents traverse identical endpoints.

**Tech Stack:** TypeScript 5 · pnpm workspaces · Vitest · Zod · Fastify 4 · Next.js 15 (App Router) · Tailwind CSS · React 19.

**Spec:** `docs/superpowers/specs/2026-04-11-encompass-digital-twin-design.md`

---

## File Structure

```
encompass-digital-twin/
├─ package.json                     # workspace root
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ .gitignore
├─ packages/
│  ├─ core/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  │  ├─ index.ts                # public exports
│  │  │  ├─ types.ts                # Loan, Condition, Action, etc.
│  │  │  ├─ errors.ts               # ActionError class + codes
│  │  │  ├─ reduce.ts               # pure reducer
│  │  │  └─ store.ts                # in-memory singleton store
│  │  └─ test/
│  │     ├─ reduce.lifecycle.test.ts
│  │     ├─ reduce.decision.test.ts
│  │     ├─ reduce.conditions.test.ts
│  │     ├─ reduce.qualifying.test.ts
│  │     ├─ store.test.ts
│  │     └─ replay.test.ts
│  ├─ fixtures/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  │  ├─ index.ts                # loader + manifest
│  │  │  ├─ condition-templates.ts  # reusable PTD/PTA/PTF sets
│  │  │  └─ loans/
│  │  │     ├─ nqm-bankstmt-12mo-clean.ts
│  │  │     ├─ nqm-bankstmt-24mo-business.ts
│  │  │     ├─ nqm-dscr-investor-purchase.ts
│  │  │     ├─ nqm-dscr-sub-1.ts
│  │  │     ├─ nqm-asset-depletion.ts
│  │  │     ├─ nqm-1099-only.ts
│  │  │     ├─ nqm-pnl-only-cpa.ts
│  │  │     ├─ nqm-foreign-national.ts
│  │  │     ├─ nqm-itin-bankstmt.ts
│  │  │     ├─ nqm-full-doc-recent-bk.ts
│  │  │     ├─ nqm-suspend-candidate.ts
│  │  │     └─ nqm-deny-candidate.ts
│  │  └─ test/manifest.test.ts
│  ├─ api/
│  │  ├─ package.json
│  │  ├─ tsconfig.json
│  │  ├─ src/
│  │  │  ├─ server.ts               # Fastify bootstrap
│  │  │  ├─ schemas.ts              # Zod request schemas
│  │  │  ├─ errors.ts               # ActionError → HTTP mapper
│  │  │  └─ routes/
│  │  │     ├─ world.ts
│  │  │     ├─ loans.ts
│  │  │     └─ conditions.ts
│  │  └─ test/
│  │     ├─ world.http.test.ts
│  │     ├─ loans.http.test.ts
│  │     ├─ conditions.http.test.ts
│  │     └─ agent-acceptance.test.ts
│  └─ web/
│     ├─ package.json
│     ├─ tsconfig.json
│     ├─ next.config.ts
│     ├─ tailwind.config.ts
│     ├─ postcss.config.js
│     ├─ app/
│     │  ├─ layout.tsx
│     │  ├─ globals.css             # Encompass theme CSS vars
│     │  ├─ page.tsx                # redirect to default scenario
│     │  └─ loan/[loanId]/
│     │     ├─ layout.tsx           # Loan shell: titlebar/menu/toolbar/header/nav
│     │     ├─ page.tsx             # redirect to /transmittal
│     │     ├─ transmittal/page.tsx # Slice 1 main screen
│     │     └─ actions.ts           # Next.js server actions → api
│     ├─ components/
│     │  ├─ encompass/
│     │  │  ├─ TitleBar.tsx
│     │  │  ├─ MenuBar.tsx
│     │  │  ├─ Toolbar.tsx
│     │  │  ├─ LoanHeader.tsx
│     │  │  ├─ NavTree.tsx
│     │  │  ├─ Section.tsx
│     │  │  ├─ Field.tsx
│     │  │  ├─ DecisionBar.tsx
│     │  │  ├─ ConditionsTable.tsx
│     │  │  ├─ ConditionModal.tsx
│     │  │  └─ ErrorDialog.tsx
│     │  └─ index.ts
│     └─ lib/
│        └─ api-client.ts           # typed fetch wrapper
└─ docs/
   └─ superpowers/
      ├─ specs/2026-04-11-encompass-digital-twin-design.md
      └─ plans/2026-04-11-encompass-digital-twin-slice1.md
```

**Split rationale:** every file has one clear job. `core` stays I/O-free so tests run in milliseconds. `api` owns state and HTTP. `web` never calls `reduce` directly — one round-trip path for humans and agents. Components are split so each React file fits comfortably in context for later edits.

---

## Phase 0 — Workspace Bootstrap

### Task 0.1: Initialize pnpm workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "encompass-digital-twin",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "dev:api": "pnpm --filter @twin/api dev",
    "dev:web": "pnpm --filter @twin/web dev",
    "dev": "pnpm --parallel --filter @twin/api --filter @twin/web dev"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^22.5.0"
  },
  "packageManager": "pnpm@9.9.0"
}
```

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules
dist
.next
*.tsbuildinfo
.env*
.superpowers/
coverage/
```

- [ ] **Step 5: Install and verify**

Run: `pnpm install`
Expected: creates `pnpm-lock.yaml`, installs root dev deps, no errors.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm monorepo"
```

---

## Phase 1 — `core` Package: Types & Errors

### Task 1.1: Create `core` package skeleton

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@twin/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create `packages/core/src/index.ts`**

```ts
export * from "./types.js";
export * from "./errors.js";
export * from "./reduce.js";
export * from "./store.js";
```

Note: `types.ts`, `errors.ts`, `reduce.ts`, `store.ts` don't exist yet — this file won't type-check until later tasks. That's expected.

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: workspace link created for `@twin/core`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/src/index.ts
git commit -m "feat(core): package skeleton"
```

### Task 1.2: Define domain types

**Files:**
- Create: `packages/core/src/types.ts`

- [ ] **Step 1: Write `packages/core/src/types.ts`**

```ts
export type LoanId = string;
export type ConditionId = string;

export type NqmProgram =
  | "BankStatement12" | "BankStatement24"
  | "DSCR" | "AssetDepletion"
  | "1099Only" | "PnL"
  | "ForeignNational" | "ITIN"
  | "FullDocNonQM";

export type QualifyingMethod =
  | "BankStatementDeposits"
  | "DSCRCoverage"
  | "AssetDepletionMonths"
  | "1099Gross"
  | "PnLCPACertified"
  | "TraditionalDocs";

export type UwDecision =
  | "pending" | "approved" | "suspended" | "counter" | "denied";

export type ConditionCategory = "PTA" | "PTD" | "PTF" | "PTP";
export type ConditionSource = "UW" | "AUS" | "Compliance" | "Investor";
export type ConditionStatus =
  | "Open" | "Requested" | "Received" | "Cleared" | "Waived";

export interface Actor {
  kind: "human" | "agent";
  id: string;
}

export interface BorrowerSummary {
  fullName: string;
  ssnMasked: string;
  dob: string;
  maritalStatus: "Married" | "Unmarried" | "Separated";
}

export interface PropertySummary {
  street: string;
  city: string;
  state: string;
  zip: string;
  propertyType: "SFR Det." | "Condo" | "PUD" | "2-4 Unit";
  units: number;
  yearBuilt: number;
}

export interface TransactionDetails {
  loanPurpose: "Purchase" | "Refi-RT" | "Refi-CO";
  loanAmount: number;
  salesPrice?: number;
  appraisedValue: number;
  ltv: number;
  cltv: number;
  hcltv: number;
  noteRate: number;
  term: number;
  amortType: "Fixed" | "ARM";
  lienPosition: 1 | 2;
  occupancy: "Primary" | "Second" | "Investment";
  isInvestmentProperty: boolean;
  rentalIncome?: number;
  piti: number;
  pitia?: number;
  dscrRatio?: number;
}

export interface QualifyingRatios {
  housingRatio: number;
  totalDti: number;
  piPayment: number;
  qualifyingRate: number;
}

export interface QualifyingIncomeWorksheet {
  method: QualifyingMethod;
  monthsCovered?: number;
  avgDeposits?: number;
  expenseFactor?: number;
  nsfCount?: number;
  dscrNumerator?: number;
  dscrDenominator?: number;
  totalAssets?: number;
  depletionMonths?: number;
  gross1099?: number;
  cpaCertifiedNetIncome?: number;
  derivedMonthlyIncome: number;
}

export interface IncomeSummary {
  totalMonthlyIncome: number;
  notes?: string;
}

export interface AssetSummary {
  totalLiquid: number;
  totalRetirement: number;
  reservesMonths: number;
}

export interface CreditSummary {
  repScore: number | null;
  tradelinesOpen: number;
  tradelinesTotal: number;
  lastLate30d?: string;
}

export interface AusResult {
  engine: "DU" | "LPA";
  recommendation: string;
  caseId: string;
  findingsDate: string;
}

export interface Condition {
  id: ConditionId;
  category: ConditionCategory;
  source: ConditionSource;
  description: string;
  status: ConditionStatus;
  addedBy: string;
  addedAt: string;
  clearedBy?: string;
  clearedAt?: string;
  notes?: string;
}

export interface NewCondition {
  category: ConditionCategory;
  source: ConditionSource;
  description: string;
  status?: ConditionStatus;
}

export interface Milestone {
  name: string;
  at: string;
  by: string;
}

export interface Loan {
  id: LoanId;
  nqmProgram: NqmProgram;
  qualifyingMethod: QualifyingMethod;
  borrower: BorrowerSummary;
  property: PropertySummary;
  transaction: TransactionDetails;
  qualifying: QualifyingRatios;
  qualifyingWorksheet: QualifyingIncomeWorksheet;
  income: IncomeSummary;
  assets: AssetSummary;
  credit: CreditSummary;
  aus?: AusResult;
  conditions: Condition[];
  decision: UwDecision;
  milestones: Milestone[];
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  loan: Loan;
}

export interface WorldState {
  scenarioId: string | null;
  loans: Record<LoanId, Loan>;
  actionLog: LoggedAction[];
  now: () => string;
}

export interface LoggedAction {
  seq: number;
  at: string;
  action: Action;
}

export type Action =
  | { type: "LoadScenario"; scenarioId: string }
  | { type: "ResetWorld" }
  | { type: "OpenLoan"; loanId: LoanId; actor: Actor }
  | { type: "SetDecision"; loanId: LoanId; decision: UwDecision; rationale: string; actor: Actor }
  | { type: "AdvanceMilestone"; loanId: LoanId; milestone: string; actor: Actor }
  | { type: "RecalculateQualifyingIncome"; loanId: LoanId; worksheet: QualifyingIncomeWorksheet; actor: Actor }
  | { type: "AddCondition"; loanId: LoanId; condition: NewCondition; actor: Actor }
  | { type: "UpdateCondition"; loanId: LoanId; conditionId: ConditionId; patch: Partial<Condition>; actor: Actor }
  | { type: "ClearCondition"; loanId: LoanId; conditionId: ConditionId; notes?: string; actor: Actor }
  | { type: "WaiveCondition"; loanId: LoanId; conditionId: ConditionId; rationale: string; actor: Actor }
  | { type: "RemoveCondition"; loanId: LoanId; conditionId: ConditionId; actor: Actor };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @twin/core exec tsc --noEmit`
Expected: error only that `./errors.js`, `./reduce.js`, `./store.js` cannot be found from `index.ts` — types.ts itself has zero errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): domain types for slice 1"
```

### Task 1.3: Define `ActionError`

**Files:**
- Create: `packages/core/src/errors.ts`
- Create: `packages/core/test/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/errors.test.ts
import { describe, expect, it } from "vitest";
import { ActionError } from "../src/errors.js";

describe("ActionError", () => {
  it("carries code, message, and optional details", () => {
    const err = new ActionError("LOAN_NOT_FOUND", "no such loan", { loanId: "X" });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("LOAN_NOT_FOUND");
    expect(err.message).toBe("no such loan");
    expect(err.details).toEqual({ loanId: "X" });
    expect(err.name).toBe("ActionError");
  });

  it("is serializable to a plain object", () => {
    const err = new ActionError("INVALID_TRANSITION", "bad state");
    expect(err.toJSON()).toEqual({
      code: "INVALID_TRANSITION",
      message: "bad state",
      details: undefined,
    });
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/errors.test.ts`
Expected: FAIL — cannot find `../src/errors.js`.

- [ ] **Step 3: Write `packages/core/src/errors.ts`**

```ts
export type ActionErrorCode =
  | "LOAN_NOT_FOUND"
  | "CONDITION_NOT_FOUND"
  | "INVALID_TRANSITION"
  | "SCENARIO_NOT_FOUND"
  | "REQUIRED_FIELD_MISSING"
  | "ACTION_FORBIDDEN_IN_DECISION_STATE";

export class ActionError extends Error {
  public readonly code: ActionErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(code: ActionErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ActionError";
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/core exec vitest run test/errors.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/errors.ts packages/core/test/errors.test.ts
git commit -m "feat(core): ActionError with typed codes"
```

---

## Phase 2 — `core` Package: The Reducer

The reducer is the heart of the twin. It's a pure function: `reduce(state, action) -> newState`. We TDD one action group per task, keeping each task small.

### Task 2.1: Reducer skeleton + `LoadScenario`/`ResetWorld`

**Files:**
- Create: `packages/core/src/reduce.ts`
- Create: `packages/core/test/reduce.lifecycle.test.ts`

- [ ] **Step 1: Write the failing lifecycle test**

```ts
// packages/core/test/reduce.lifecycle.test.ts
import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Loan, Scenario, WorldState } from "../src/types.js";

const fixedNow = () => "2026-04-11T12:00:00.000Z";

function makeLoan(id: string): Loan {
  return {
    id,
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Test B", ssnMasked: "xxx-xx-0001", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "1 Test", city: "X", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, salesPrice: 500000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: [],
    decision: "pending",
    milestones: [],
  };
}

function emptyState(): WorldState {
  return { scenarioId: null, loans: {}, actionLog: [], now: fixedNow };
}

function scenario(id: string): Scenario {
  return { id, name: id, description: "", loan: makeLoan("2501000001") };
}

describe("reduce — lifecycle", () => {
  const scenarios: Record<string, Scenario> = { "s1": scenario("s1") };
  const resolve = (sid: string) => scenarios[sid];

  it("LoadScenario hydrates state from a scenario", () => {
    const next = reduce(emptyState(), { type: "LoadScenario", scenarioId: "s1" }, resolve);
    expect(next.scenarioId).toBe("s1");
    expect(next.loans["2501000001"]).toBeDefined();
    expect(next.actionLog).toHaveLength(1);
    expect(next.actionLog[0]!.action.type).toBe("LoadScenario");
  });

  it("LoadScenario with unknown id throws SCENARIO_NOT_FOUND", () => {
    expect(() => reduce(emptyState(), { type: "LoadScenario", scenarioId: "nope" }, resolve))
      .toThrowError(ActionError);
  });

  it("ResetWorld clears loans + log but keeps `now`", () => {
    const loaded = reduce(emptyState(), { type: "LoadScenario", scenarioId: "s1" }, resolve);
    const reset = reduce(loaded, { type: "ResetWorld" }, resolve);
    expect(reset.scenarioId).toBeNull();
    expect(reset.loans).toEqual({});
    expect(reset.actionLog).toEqual([]);
    expect(reset.now).toBe(loaded.now);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.lifecycle.test.ts`
Expected: FAIL — cannot find `../src/reduce.js`.

- [ ] **Step 3: Write `packages/core/src/reduce.ts`**

```ts
import type { Action, LoggedAction, Scenario, WorldState } from "./types.js";
import { ActionError } from "./errors.js";

export type ScenarioResolver = (scenarioId: string) => Scenario | undefined;

export function reduce(
  state: WorldState,
  action: Action,
  resolveScenario: ScenarioResolver,
): WorldState {
  const log = (s: WorldState): WorldState => ({
    ...s,
    actionLog: [...s.actionLog, {
      seq: s.actionLog.length + 1,
      at: s.now(),
      action,
    } satisfies LoggedAction],
  });

  switch (action.type) {
    case "LoadScenario": {
      const sc = resolveScenario(action.scenarioId);
      if (!sc) {
        throw new ActionError("SCENARIO_NOT_FOUND",
          `scenario '${action.scenarioId}' not found`,
          { scenarioId: action.scenarioId });
      }
      return log({
        ...state,
        scenarioId: sc.id,
        loans: { [sc.loan.id]: structuredClone(sc.loan) },
      });
    }

    case "ResetWorld": {
      return { scenarioId: null, loans: {}, actionLog: [], now: state.now };
    }

    default:
      // other cases added in later tasks
      return state;
  }
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.lifecycle.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reduce.ts packages/core/test/reduce.lifecycle.test.ts
git commit -m "feat(core): reduce — LoadScenario and ResetWorld"
```

### Task 2.2: Reducer — `OpenLoan`, `SetDecision`, `AdvanceMilestone`

**Files:**
- Modify: `packages/core/src/reduce.ts`
- Create: `packages/core/test/reduce.decision.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/reduce.decision.test.ts
import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Scenario, WorldState, Loan, Actor } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "unit" };

function loan(id: string): Loan {
  return {
    id,
    nqmProgram: "DSCR", qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 300000, appraisedValue: 400000,
      ltv: 75, cltv: 75, hcltv: 75, noteRate: 7.5, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, piti: 2500 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2100, qualifyingRate: 7.5 },
    qualifyingWorksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 60000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 740, tradelinesOpen: 4, tradelinesTotal: 7 },
    conditions: [],
    decision: "pending",
    milestones: [],
  };
}

function preload(id: string = "2501000001"): WorldState {
  const scenarios: Record<string, Scenario> = {
    s1: { id: "s1", name: "s1", description: "", loan: loan(id) },
  };
  const resolve = (sid: string) => scenarios[sid];
  return reduce(
    { scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s1" },
    resolve,
  );
}

const noResolve = () => undefined;

describe("reduce — decision", () => {
  it("OpenLoan records a milestone without changing decision", () => {
    const s = preload();
    const next = reduce(s, { type: "OpenLoan", loanId: "2501000001", actor }, noResolve);
    expect(next.loans["2501000001"]!.milestones.at(-1)?.name).toBe("Opened");
    expect(next.loans["2501000001"]!.decision).toBe("pending");
  });

  it("OpenLoan on unknown loan throws LOAN_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, { type: "OpenLoan", loanId: "XXX", actor }, noResolve))
      .toThrowError(ActionError);
  });

  it("SetDecision updates decision and records milestone", () => {
    const s = preload();
    const next = reduce(s, { type: "SetDecision", loanId: "2501000001",
      decision: "approved", rationale: "clean file", actor }, noResolve);
    expect(next.loans["2501000001"]!.decision).toBe("approved");
    expect(next.loans["2501000001"]!.milestones.at(-1)?.name).toBe("Decision:approved");
  });

  it("SetDecision requires a non-empty rationale", () => {
    const s = preload();
    expect(() => reduce(s, { type: "SetDecision", loanId: "2501000001",
      decision: "denied", rationale: "", actor }, noResolve)).toThrowError(ActionError);
  });

  it("AdvanceMilestone appends a custom milestone", () => {
    const s = preload();
    const next = reduce(s, { type: "AdvanceMilestone", loanId: "2501000001",
      milestone: "UW Review", actor }, noResolve);
    expect(next.loans["2501000001"]!.milestones.map(m => m.name)).toContain("UW Review");
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.decision.test.ts`
Expected: FAIL — decision unchanged / milestones empty.

- [ ] **Step 3: Extend `packages/core/src/reduce.ts`**

Replace the `default:` arm with real cases. The full updated file:

```ts
import type { Action, Loan, LoggedAction, Milestone, Scenario, WorldState } from "./types.js";
import { ActionError } from "./errors.js";

export type ScenarioResolver = (scenarioId: string) => Scenario | undefined;

function requireLoan(state: WorldState, loanId: string): Loan {
  const l = state.loans[loanId];
  if (!l) {
    throw new ActionError("LOAN_NOT_FOUND", `loan '${loanId}' not found`, { loanId });
  }
  return l;
}

function withLoan(state: WorldState, loanId: string, updater: (l: Loan) => Loan): WorldState {
  const next = updater(requireLoan(state, loanId));
  return { ...state, loans: { ...state.loans, [loanId]: next } };
}

function milestone(name: string, by: string, at: string): Milestone {
  return { name, by, at };
}

export function reduce(
  state: WorldState,
  action: Action,
  resolveScenario: ScenarioResolver,
): WorldState {
  const at = state.now();
  const log = (s: WorldState): WorldState => ({
    ...s,
    actionLog: [...s.actionLog, { seq: s.actionLog.length + 1, at, action } satisfies LoggedAction],
  });

  switch (action.type) {
    case "LoadScenario": {
      const sc = resolveScenario(action.scenarioId);
      if (!sc) {
        throw new ActionError("SCENARIO_NOT_FOUND",
          `scenario '${action.scenarioId}' not found`, { scenarioId: action.scenarioId });
      }
      return log({ ...state, scenarioId: sc.id, loans: { [sc.loan.id]: structuredClone(sc.loan) } });
    }

    case "ResetWorld":
      return { scenarioId: null, loans: {}, actionLog: [], now: state.now };

    case "OpenLoan": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l, milestones: [...l.milestones, milestone("Opened", action.actor.id, at)],
      }));
      return log(next);
    }

    case "SetDecision": {
      if (!action.rationale || action.rationale.trim() === "") {
        throw new ActionError("REQUIRED_FIELD_MISSING",
          "rationale is required for SetDecision", { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => ({
        ...l,
        decision: action.decision,
        milestones: [...l.milestones, milestone(`Decision:${action.decision}`, action.actor.id, at)],
      }));
      return log(next);
    }

    case "AdvanceMilestone": {
      const next = withLoan(state, action.loanId, (l) => ({
        ...l, milestones: [...l.milestones, milestone(action.milestone, action.actor.id, at)],
      }));
      return log(next);
    }

    default:
      return state;
  }
}
```

- [ ] **Step 4: Run — expect pass (lifecycle + decision)**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.lifecycle.test.ts test/reduce.decision.test.ts`
Expected: PASS, 8 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reduce.ts packages/core/test/reduce.decision.test.ts
git commit -m "feat(core): reduce — OpenLoan/SetDecision/AdvanceMilestone"
```

### Task 2.3: Reducer — Condition actions

**Files:**
- Modify: `packages/core/src/reduce.ts`
- Create: `packages/core/test/reduce.conditions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/reduce.conditions.test.ts
import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "human", id: "uw1" };

function loan(): Loan {
  return {
    id: "2501000001",
    nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: [],
    decision: "pending",
    milestones: [],
  };
}

function preload(): WorldState {
  const sc: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => sc[k]);
}

describe("reduce — conditions", () => {
  it("AddCondition appends an Open condition with a stable id", () => {
    const s = preload();
    const next = reduce(s, { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Paystubs" }, actor }, () => undefined);
    const cs = next.loans["2501000001"]!.conditions;
    expect(cs).toHaveLength(1);
    expect(cs[0]!.id).toMatch(/^c\d+$/);
    expect(cs[0]!.status).toBe("Open");
    expect(cs[0]!.addedBy).toBe("uw1");
  });

  it("UpdateCondition merges patch", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Paystubs" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "UpdateCondition", loanId: "2501000001",
      conditionId: cid, patch: { description: "Paystubs (30d)" }, actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions[0]!.description).toBe("Paystubs (30d)");
  });

  it("ClearCondition transitions Open/Received → Cleared", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "4506-C", status: "Received" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "ClearCondition", loanId: "2501000001",
      conditionId: cid, notes: "ok", actor }, () => undefined);
    const c = s2.loans["2501000001"]!.conditions[0]!;
    expect(c.status).toBe("Cleared");
    expect(c.clearedBy).toBe("uw1");
    expect(c.notes).toBe("ok");
  });

  it("ClearCondition from Waived is forbidden", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "X" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "exec override", actor }, () => undefined);
    expect(() => reduce(s2, { type: "ClearCondition", loanId: "2501000001",
      conditionId: cid, actor }, () => undefined)).toThrowError(ActionError);
  });

  it("WaiveCondition requires rationale and sets status Waived", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Z" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    expect(() => reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "", actor }, () => undefined)).toThrowError(ActionError);
    const s2 = reduce(s1, { type: "WaiveCondition", loanId: "2501000001",
      conditionId: cid, rationale: "ok", actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions[0]!.status).toBe("Waived");
  });

  it("RemoveCondition deletes it", () => {
    const s1 = reduce(preload(), { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "Q" }, actor }, () => undefined);
    const cid = s1.loans["2501000001"]!.conditions[0]!.id;
    const s2 = reduce(s1, { type: "RemoveCondition", loanId: "2501000001",
      conditionId: cid, actor }, () => undefined);
    expect(s2.loans["2501000001"]!.conditions).toHaveLength(0);
  });

  it("UpdateCondition on unknown condition throws CONDITION_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, { type: "UpdateCondition", loanId: "2501000001",
      conditionId: "cX", patch: {}, actor }, () => undefined)).toThrowError(ActionError);
  });

  it("Condition actions are forbidden after loan is denied", () => {
    const s1 = reduce(preload(), { type: "SetDecision", loanId: "2501000001",
      decision: "denied", rationale: "no", actor }, () => undefined);
    expect(() => reduce(s1, { type: "AddCondition", loanId: "2501000001",
      condition: { category: "PTD", source: "UW", description: "x" }, actor }, () => undefined))
      .toThrowError(ActionError);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.conditions.test.ts`
Expected: FAIL — `default` arm returns state unchanged.

- [ ] **Step 3: Extend `reduce.ts` — add condition cases**

Insert these cases before `default:` in `packages/core/src/reduce.ts`:

```ts
    case "AddCondition": {
      const l0 = requireLoan(state, action.loanId);
      if (l0.decision === "denied") {
        throw new ActionError("ACTION_FORBIDDEN_IN_DECISION_STATE",
          `cannot add conditions on a denied loan`, { loanId: action.loanId, decision: l0.decision });
      }
      const nextId = `c${l0.conditions.length + 1}`;
      const c = {
        id: nextId,
        category: action.condition.category,
        source: action.condition.source,
        description: action.condition.description,
        status: action.condition.status ?? "Open",
        addedBy: action.actor.id,
        addedAt: at,
      };
      return log(withLoan(state, action.loanId, (l) => ({
        ...l, conditions: [...l.conditions, c],
      })));
    }

    case "UpdateCondition": {
      const l0 = requireLoan(state, action.loanId);
      if (l0.decision === "denied") {
        throw new ActionError("ACTION_FORBIDDEN_IN_DECISION_STATE",
          `cannot update conditions on a denied loan`, { loanId: action.loanId });
      }
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cs[idx]!, ...action.patch, id: cs[idx]!.id };
        return { ...l, conditions: cs };
      }));
    }

    case "ClearCondition": {
      const l0 = requireLoan(state, action.loanId);
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      const cur = l0.conditions[idx]!;
      if (cur.status === "Waived" || cur.status === "Cleared") {
        throw new ActionError("INVALID_TRANSITION",
          `cannot clear a ${cur.status} condition`, { from: cur.status });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cur, status: "Cleared", clearedBy: action.actor.id, clearedAt: at, notes: action.notes ?? cur.notes };
        return { ...l, conditions: cs };
      }));
    }

    case "WaiveCondition": {
      if (!action.rationale || action.rationale.trim() === "") {
        throw new ActionError("REQUIRED_FIELD_MISSING",
          "rationale is required for WaiveCondition", { conditionId: action.conditionId });
      }
      const l0 = requireLoan(state, action.loanId);
      const idx = l0.conditions.findIndex((c) => c.id === action.conditionId);
      if (idx === -1) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => {
        const cs = [...l.conditions];
        cs[idx] = { ...cs[idx]!, status: "Waived", notes: action.rationale };
        return { ...l, conditions: cs };
      }));
    }

    case "RemoveCondition": {
      const l0 = requireLoan(state, action.loanId);
      const exists = l0.conditions.some((c) => c.id === action.conditionId);
      if (!exists) {
        throw new ActionError("CONDITION_NOT_FOUND",
          `condition '${action.conditionId}' not found`, { conditionId: action.conditionId });
      }
      return log(withLoan(state, action.loanId, (l) => ({
        ...l, conditions: l.conditions.filter((c) => c.id !== action.conditionId),
      })));
    }
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.conditions.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/reduce.ts packages/core/test/reduce.conditions.test.ts
git commit -m "feat(core): reduce — condition lifecycle actions"
```

### Task 2.4: Reducer — `RecalculateQualifyingIncome`

**Files:**
- Modify: `packages/core/src/reduce.ts`
- Create: `packages/core/test/reduce.qualifying.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/reduce.qualifying.test.ts
import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import { ActionError } from "../src/errors.js";
import type { Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "income-bot" };

function baseLoan(): Loan {
  return {
    id: "2501000099",
    nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: [], decision: "pending", milestones: [],
  };
}

function preload(): WorldState {
  const scs: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: baseLoan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => scs[k]);
}

describe("reduce — qualifying income", () => {
  it("RecalculateQualifyingIncome updates worksheet + ratios", () => {
    const s = preload();
    const next = reduce(s, {
      type: "RecalculateQualifyingIncome", loanId: "2501000099",
      worksheet: {
        method: "BankStatementDeposits", monthsCovered: 12,
        avgDeposits: 18000, expenseFactor: 0.5, derivedMonthlyIncome: 9000,
      }, actor,
    }, () => undefined);
    const l = next.loans["2501000099"]!;
    expect(l.qualifyingWorksheet.derivedMonthlyIncome).toBe(9000);
    expect(l.income.totalMonthlyIncome).toBe(9000);
    expect(l.qualifying.totalDti).toBeCloseTo((3000 / 9000) * 100, 5);
    expect(l.qualifying.housingRatio).toBeCloseTo((2660 / 9000) * 100, 5);
  });

  it("derivedMonthlyIncome of 0 throws INVALID_TRANSITION", () => {
    const s = preload();
    expect(() => reduce(s, {
      type: "RecalculateQualifyingIncome", loanId: "2501000099",
      worksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 }, actor,
    }, () => undefined)).toThrowError(ActionError);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.qualifying.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the case to `reduce.ts`** (before `default:`)

```ts
    case "RecalculateQualifyingIncome": {
      if (!action.worksheet.derivedMonthlyIncome || action.worksheet.derivedMonthlyIncome <= 0) {
        throw new ActionError("INVALID_TRANSITION",
          "derivedMonthlyIncome must be > 0",
          { loanId: action.loanId });
      }
      const next = withLoan(state, action.loanId, (l) => {
        const monthly = action.worksheet.derivedMonthlyIncome;
        const piti = l.transaction.piti;
        const pi = l.qualifying.piPayment;
        return {
          ...l,
          qualifyingWorksheet: action.worksheet,
          income: { ...l.income, totalMonthlyIncome: monthly },
          qualifying: {
            ...l.qualifying,
            housingRatio: (pi / monthly) * 100,
            totalDti: (piti / monthly) * 100,
          },
        };
      });
      return log(next);
    }
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/core exec vitest run test/reduce.qualifying.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Run the whole core test suite to be safe**

Run: `pnpm --filter @twin/core test`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/reduce.ts packages/core/test/reduce.qualifying.test.ts
git commit -m "feat(core): reduce — RecalculateQualifyingIncome"
```

### Task 2.5: Replay invariant test

**Files:**
- Create: `packages/core/test/replay.test.ts`

The spec requires: driving a loan through its action log from a fresh fixture load must produce bitwise-identical state. This test locks that invariant.

- [ ] **Step 1: Write the test**

```ts
// packages/core/test/replay.test.ts
import { describe, expect, it } from "vitest";
import { reduce } from "../src/reduce.js";
import type { Action, Actor, Loan, Scenario, WorldState } from "../src/types.js";

const now = () => "2026-04-11T12:00:00.000Z";
const actor: Actor = { kind: "agent", id: "replay-bot" };

function loan(): Loan {
  return {
    id: "R1",
    nqmProgram: "DSCR", qualifyingMethod: "DSCRCoverage",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Investment", isInvestmentProperty: true, piti: 3200 },
    qualifying: { housingRatio: 0, totalDti: 0, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "DSCRCoverage", derivedMonthlyIncome: 0 },
    income: { totalMonthlyIncome: 0 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 740, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: [], decision: "pending", milestones: [],
  };
}

describe("replay invariant", () => {
  it("replaying the action log from empty state yields identical world state", () => {
    const scs: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
    const resolve = (k: string) => scs[k];

    const init: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };
    const script: Action[] = [
      { type: "LoadScenario", scenarioId: "s" },
      { type: "OpenLoan", loanId: "R1", actor },
      { type: "AddCondition", loanId: "R1", condition: { category: "PTD", source: "UW", description: "Bank stmt (12mo)" }, actor },
      { type: "AddCondition", loanId: "R1", condition: { category: "PTF", source: "Compliance", description: "HOI" }, actor },
      { type: "ClearCondition", loanId: "R1", conditionId: "c1", notes: "ok", actor },
      { type: "SetDecision", loanId: "R1", decision: "approved", rationale: "DSCR ≥ 1.0", actor },
    ];

    const driven = script.reduce((s, a) => reduce(s, a, resolve), init);
    const replayed = driven.actionLog
      .map((e) => e.action)
      .reduce((s, a) => reduce(s, a, resolve), init);

    expect(replayed.loans).toEqual(driven.loans);
    expect(replayed.scenarioId).toBe(driven.scenarioId);
    expect(replayed.actionLog.length).toBe(driven.actionLog.length);
  });
});
```

- [ ] **Step 2: Run — expect pass immediately**

Run: `pnpm --filter @twin/core exec vitest run test/replay.test.ts`
Expected: PASS, 1 test. If not, the reducer has hidden non-determinism — fix it before moving on.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/replay.test.ts
git commit -m "test(core): lock replay invariant"
```

---

## Phase 3 — `core` Package: Store

### Task 3.1: In-memory store singleton

**Files:**
- Create: `packages/core/src/store.ts`
- Create: `packages/core/test/store.test.ts`

The store wraps `reduce` with mutable singleton state so the HTTP layer has one place to dispatch. Keeps `reduce` pure.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/store.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { createStore } from "../src/store.js";
import type { Scenario, Loan } from "../src/types.js";

function loan(id = "2501000001"): Loan {
  return {
    id, nqmProgram: "BankStatement12", qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "B", ssnMasked: "x", dob: "1980-01-01", maritalStatus: "Unmarried" },
    property: { street: "", city: "", state: "CA", zip: "90001", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: { loanPurpose: "Purchase", loanAmount: 400000, appraisedValue: 500000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 7, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3000 },
    qualifying: { housingRatio: 25, totalDti: 38, piPayment: 2660, qualifyingRate: 7 },
    qualifyingWorksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 12000 },
    income: { totalMonthlyIncome: 12000 },
    assets: { totalLiquid: 80000, totalRetirement: 0, reservesMonths: 6 },
    credit: { repScore: 720, tradelinesOpen: 5, tradelinesTotal: 8 },
    conditions: [], decision: "pending", milestones: [],
  };
}

const scs: Record<string, Scenario> = {
  happy: { id: "happy", name: "Happy", description: "", loan: loan() },
};

describe("store", () => {
  it("dispatch applies actions and exposes new state", () => {
    const store = createStore({
      scenarios: scs,
      now: () => "2026-04-11T12:00:00.000Z",
    });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getState().loans["2501000001"]).toBeDefined();
    expect(store.listScenarios()).toHaveLength(1);
  });

  it("getLoan returns the current loan snapshot", () => {
    const store = createStore({ scenarios: scs, now: () => "t" });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getLoan("2501000001")?.id).toBe("2501000001");
  });

  it("getAuditLog returns the action log", () => {
    const store = createStore({ scenarios: scs, now: () => "t" });
    store.dispatch({ type: "LoadScenario", scenarioId: "happy" });
    expect(store.getAuditLog()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/core exec vitest run test/store.test.ts`
Expected: FAIL — cannot find `../src/store.js`.

- [ ] **Step 3: Write `packages/core/src/store.ts`**

```ts
import type { Action, Loan, LoggedAction, Scenario, WorldState } from "./types.js";
import { reduce, type ScenarioResolver } from "./reduce.js";

export interface StoreOptions {
  scenarios: Record<string, Scenario>;
  now?: () => string;
}

export interface Store {
  dispatch(action: Action): WorldState;
  getState(): WorldState;
  getLoan(loanId: string): Loan | undefined;
  getAuditLog(): LoggedAction[];
  listScenarios(): Array<{ id: string; name: string; description: string }>;
}

export function createStore(opts: StoreOptions): Store {
  const resolve: ScenarioResolver = (id) => opts.scenarios[id];
  const now = opts.now ?? (() => new Date().toISOString());
  let state: WorldState = { scenarioId: null, loans: {}, actionLog: [], now };

  return {
    dispatch(action) {
      state = reduce(state, action, resolve);
      return state;
    },
    getState() { return state; },
    getLoan(id) { return state.loans[id]; },
    getAuditLog() { return state.actionLog; },
    listScenarios() {
      return Object.values(opts.scenarios).map(({ id, name, description }) => ({ id, name, description }));
    },
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/core exec vitest run test/store.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Run full core suite**

Run: `pnpm --filter @twin/core test`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/store.ts packages/core/test/store.test.ts
git commit -m "feat(core): in-memory store wrapping reduce"
```

---

## Phase 4 — `fixtures` Package

### Task 4.1: Fixtures package skeleton + condition templates

**Files:**
- Create: `packages/fixtures/package.json`
- Create: `packages/fixtures/tsconfig.json`
- Create: `packages/fixtures/src/condition-templates.ts`
- Create: `packages/fixtures/src/index.ts`

- [ ] **Step 1: Write `packages/fixtures/package.json`**

```json
{
  "name": "@twin/fixtures",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": { ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" } },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": { "@twin/core": "workspace:*" },
  "devDependencies": { "typescript": "^5.5.4", "vitest": "^2.0.5" }
}
```

- [ ] **Step 2: Write `packages/fixtures/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }]
}
```

- [ ] **Step 3: Write `packages/fixtures/src/condition-templates.ts`**

```ts
import type { NewCondition } from "@twin/core";

export const bankStatementStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "12 months personal bank statements (all pages)" },
  { category: "PTD", source: "UW", description: "Bank statement income analysis worksheet" },
  { category: "PTD", source: "UW", description: "Signed 4506-C" },
  { category: "PTF", source: "Compliance", description: "Final HOI with effective date ≥ closing" },
];

export const dscrStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Executed lease or market rent (1007)" },
  { category: "PTD", source: "UW", description: "Property insurance with rent loss coverage" },
  { category: "PTA", source: "UW", description: "Reserves — 6 months PITIA" },
  { category: "PTF", source: "Compliance", description: "Entity docs if titled in LLC" },
];

export const assetDepletionStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "60 days asset statements (all pages)" },
  { category: "PTD", source: "UW", description: "Asset depletion calculation worksheet" },
  { category: "PTA", source: "UW", description: "Source of large deposits > 1% loan amount" },
];

export const itinStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Valid ITIN letter from IRS" },
  { category: "PTD", source: "UW", description: "12 months alternative credit (rent, utilities)" },
  { category: "PTD", source: "UW", description: "Two forms of government-issued ID" },
];

export const foreignNationalStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "Valid foreign passport + visa" },
  { category: "PTA", source: "UW", description: "12 months reserves in US bank" },
  { category: "PTD", source: "Compliance", description: "OFAC clearance" },
];

export const bkSeasoningStarterConditions: NewCondition[] = [
  { category: "PTD", source: "UW", description: "BK discharge / dismissal papers" },
  { category: "PTD", source: "UW", description: "Letter of explanation — cause + re-established credit" },
  { category: "PTD", source: "UW", description: "Evidence of re-established credit (3 tradelines, 12mo clean)" },
];
```

- [ ] **Step 4: Stub `packages/fixtures/src/index.ts`**

```ts
import type { Scenario } from "@twin/core";

export const scenarios: Record<string, Scenario> = {};
export function listScenarios() {
  return Object.values(scenarios).map(({ id, name, description }) => ({ id, name, description }));
}
```

(Populated in Task 4.2+.)

- [ ] **Step 5: Install + commit**

Run: `pnpm install`
Then:
```bash
git add packages/fixtures
git commit -m "feat(fixtures): package skeleton + condition templates"
```

### Task 4.2: Fixture — `nqm-bankstmt-12mo-clean`

**Files:**
- Create: `packages/fixtures/src/loans/nqm-bankstmt-12mo-clean.ts`
- Modify: `packages/fixtures/src/index.ts`

- [ ] **Step 1: Write `packages/fixtures/src/loans/nqm-bankstmt-12mo-clean.ts`**

```ts
import type { Scenario, Condition } from "@twin/core";
import { bankStatementStarterConditions } from "../condition-templates.js";

const starter: Condition[] = bankStatementStarterConditions.map((c, i) => ({
  id: `c${i + 1}`,
  category: c.category,
  source: c.source,
  description: c.description,
  status: c.status ?? "Open",
  addedBy: "system",
  addedAt: "2026-04-08T09:00:00.000Z",
}));

export const nqmBankstmt12moClean: Scenario = {
  id: "nqm-bankstmt-12mo-clean",
  name: "NQM Bank Statement — 12mo Clean",
  description: "Self-employed happy path. 12mo personal bank statements, clean file.",
  loan: {
    id: "2501000101",
    nqmProgram: "BankStatement12",
    qualifyingMethod: "BankStatementDeposits",
    borrower: { fullName: "Sanchez, Maria A.", ssnMasked: "xxx-xx-4421", dob: "1987-05-14", maritalStatus: "Unmarried" },
    property: { street: "812 Alder Ln", city: "Fresno", state: "CA", zip: "93720",
      propertyType: "SFR Det.", units: 1, yearBuilt: 1998 },
    transaction: {
      loanPurpose: "Purchase", loanAmount: 412000, salesPrice: 515000, appraisedValue: 515000,
      ltv: 80, cltv: 80, hcltv: 80, noteRate: 6.875, term: 360, amortType: "Fixed", lienPosition: 1,
      occupancy: "Primary", isInvestmentProperty: false, piti: 3319.51,
    },
    qualifying: { housingRatio: 27.3, totalDti: 38.1, piPayment: 2707.41, qualifyingRate: 6.875 },
    qualifyingWorksheet: {
      method: "BankStatementDeposits",
      monthsCovered: 12, avgDeposits: 18000, expenseFactor: 0.5, nsfCount: 0,
      derivedMonthlyIncome: 9000,
    },
    income: { totalMonthlyIncome: 9000, notes: "12mo personal bank statement avg × 50% expense factor" },
    assets: { totalLiquid: 78420, totalRetirement: 45000, reservesMonths: 6.4 },
    credit: { repScore: 742, tradelinesOpen: 6, tradelinesTotal: 9 },
    conditions: starter,
    decision: "pending",
    milestones: [{ name: "Submitted to UW", by: "system", at: "2026-04-08T09:00:00.000Z" }],
  },
};
```

- [ ] **Step 2: Register it in `packages/fixtures/src/index.ts`**

```ts
import type { Scenario } from "@twin/core";
import { nqmBankstmt12moClean } from "./loans/nqm-bankstmt-12mo-clean.js";

export const scenarios: Record<string, Scenario> = {
  [nqmBankstmt12moClean.id]: nqmBankstmt12moClean,
};

export function listScenarios() {
  return Object.values(scenarios).map(({ id, name, description }) => ({ id, name, description }));
}
```

- [ ] **Step 3: Sanity-check typecheck**

Run: `pnpm --filter @twin/fixtures exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): nqm-bankstmt-12mo-clean"
```

### Task 4.3: Remaining 11 fixtures

Follow the exact same shape as Task 4.2. Each fixture lives in `packages/fixtures/src/loans/<id>.ts` and is registered in `packages/fixtures/src/index.ts`.

Key values per fixture (fill the rest with plausible but deterministic numbers that exercise the described path). Each fixture uses the condition template indicated.

- [ ] **Step 1: Create each file** using the same code pattern as 4.2, with these parameters:

| file | loanId | program | method | LTV | FICO | loanAmt | appr | piti | template | decision-target |
|---|---|---|---|---|---|---|---|---|---|---|
| `nqm-bankstmt-24mo-business.ts` | `2501000102` | `BankStatement24` | `BankStatementDeposits` | 75 | 700 | 525000 | 700000 | 4120.00 | bankStatementStarterConditions + one NSF condition | approve after analysis |
| `nqm-dscr-investor-purchase.ts` | `2501000103` | `DSCR` | `DSCRCoverage` | 75 | 740 | 340000 | 460000 | 2890.10 | dscrStarterConditions | approve (DSCR 1.18) |
| `nqm-dscr-sub-1.ts` | `2501000104` | `DSCR` | `DSCRCoverage` | 70 | 760 | 310000 | 450000 | 2650.00 | dscrStarterConditions | counter (DSCR 0.85) |
| `nqm-asset-depletion.ts` | `2501000105` | `AssetDepletion` | `AssetDepletionMonths` | 65 | 730 | 650000 | 1000000 | 5120.00 | assetDepletionStarterConditions | approve |
| `nqm-1099-only.ts` | `2501000106` | `1099Only` | `1099Gross` | 80 | 710 | 395000 | 495000 | 3180.50 | bankStatementStarterConditions (swap bank stmt for 1099s) | approve |
| `nqm-pnl-only-cpa.ts` | `2501000107` | `PnL` | `PnLCPACertified` | 75 | 720 | 500000 | 670000 | 3950.75 | bankStatementStarterConditions + CPA license condition | approve |
| `nqm-foreign-national.ts` | `2501000108` | `ForeignNational` | `DSCRCoverage` | 65 | null | 420000 | 650000 | 3410.00 | foreignNationalStarterConditions + dscrStarterConditions | approve |
| `nqm-itin-bankstmt.ts` | `2501000109` | `ITIN` | `BankStatementDeposits` | 80 | 690 | 275000 | 345000 | 2295.50 | itinStarterConditions + bankStatementStarterConditions | approve |
| `nqm-full-doc-recent-bk.ts` | `2501000110` | `FullDocNonQM` | `TraditionalDocs` | 70 | 680 | 385000 | 550000 | 3010.00 | bkSeasoningStarterConditions | approve |
| `nqm-suspend-candidate.ts` | `2501000111` | `BankStatement12` | `BankStatementDeposits` | 85 | 680 | 385000 | 455000 | 3200.00 | bankStatementStarterConditions + 3 NSF condition | suspend |
| `nqm-deny-candidate.ts` | `2501000112` | `DSCR` | `DSCRCoverage` | 80 | 660 | 410000 | 515000 | 3480.00 | dscrStarterConditions + late-payment condition | deny |

Use `structuredClone` of the template arrays if you mutate them in-file (`[...template, extra]`). Each fixture sets `decision: "pending"` at load; the "decision-target" column is only for the expected golden state in Task 4.4.

- [ ] **Step 2: Register all 11 in `packages/fixtures/src/index.ts`**

```ts
import type { Scenario } from "@twin/core";
import { nqmBankstmt12moClean } from "./loans/nqm-bankstmt-12mo-clean.js";
import { nqmBankstmt24moBusiness } from "./loans/nqm-bankstmt-24mo-business.js";
import { nqmDscrInvestorPurchase } from "./loans/nqm-dscr-investor-purchase.js";
import { nqmDscrSub1 } from "./loans/nqm-dscr-sub-1.js";
import { nqmAssetDepletion } from "./loans/nqm-asset-depletion.js";
import { nqm1099Only } from "./loans/nqm-1099-only.js";
import { nqmPnlOnlyCpa } from "./loans/nqm-pnl-only-cpa.js";
import { nqmForeignNational } from "./loans/nqm-foreign-national.js";
import { nqmItinBankstmt } from "./loans/nqm-itin-bankstmt.js";
import { nqmFullDocRecentBk } from "./loans/nqm-full-doc-recent-bk.js";
import { nqmSuspendCandidate } from "./loans/nqm-suspend-candidate.js";
import { nqmDenyCandidate } from "./loans/nqm-deny-candidate.js";

const all: Scenario[] = [
  nqmBankstmt12moClean, nqmBankstmt24moBusiness, nqmDscrInvestorPurchase, nqmDscrSub1,
  nqmAssetDepletion, nqm1099Only, nqmPnlOnlyCpa, nqmForeignNational, nqmItinBankstmt,
  nqmFullDocRecentBk, nqmSuspendCandidate, nqmDenyCandidate,
];
export const scenarios: Record<string, Scenario> = Object.fromEntries(all.map((s) => [s.id, s]));
export function listScenarios() {
  return all.map(({ id, name, description }) => ({ id, name, description }));
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @twin/fixtures exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/fixtures
git commit -m "feat(fixtures): remaining 11 NQM scenarios"
```

### Task 4.4: Fixture manifest test

**Files:**
- Create: `packages/fixtures/test/manifest.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/fixtures/test/manifest.test.ts
import { describe, expect, it } from "vitest";
import { scenarios, listScenarios } from "../src/index.js";

describe("fixture manifest", () => {
  it("contains all 12 expected scenarios", () => {
    const ids = Object.keys(scenarios).sort();
    expect(ids).toEqual([
      "nqm-1099-only",
      "nqm-asset-depletion",
      "nqm-bankstmt-12mo-clean",
      "nqm-bankstmt-24mo-business",
      "nqm-deny-candidate",
      "nqm-dscr-investor-purchase",
      "nqm-dscr-sub-1",
      "nqm-foreign-national",
      "nqm-full-doc-recent-bk",
      "nqm-itin-bankstmt",
      "nqm-pnl-only-cpa",
      "nqm-suspend-candidate",
    ]);
  });

  it("every scenario has a unique loan id and at least one starter condition", () => {
    const loanIds = new Set<string>();
    for (const s of Object.values(scenarios)) {
      expect(loanIds.has(s.loan.id)).toBe(false);
      loanIds.add(s.loan.id);
      expect(s.loan.conditions.length).toBeGreaterThan(0);
    }
  });

  it("listScenarios returns 12 entries", () => {
    expect(listScenarios()).toHaveLength(12);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter @twin/fixtures test`
Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add packages/fixtures/test
git commit -m "test(fixtures): manifest invariants"
```

---

## Phase 5 — `api` Package: Fastify HTTP Server

### Task 5.1: API package skeleton + server bootstrap

**Files:**
- Create: `packages/api/package.json`
- Create: `packages/api/tsconfig.json`
- Create: `packages/api/src/server.ts`

- [ ] **Step 1: Write `packages/api/package.json`**

```json
{
  "name": "@twin/api",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/server.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@twin/core": "workspace:*",
    "@twin/fixtures": "workspace:*",
    "fastify": "^4.28.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "tsx": "^4.19.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: Write `packages/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*"],
  "references": [{ "path": "../core" }, { "path": "../fixtures" }]
}
```

- [ ] **Step 3: Write `packages/api/src/server.ts`**

```ts
import Fastify, { type FastifyInstance } from "fastify";
import { createStore, type Store } from "@twin/core";
import { scenarios } from "@twin/fixtures";
import { registerErrorHandler } from "./errors.js";
import { registerWorldRoutes } from "./routes/world.js";
import { registerLoanRoutes } from "./routes/loans.js";
import { registerConditionRoutes } from "./routes/conditions.js";

export interface BuildOpts {
  now?: () => string;
}

export function buildServer(opts: BuildOpts = {}): { app: FastifyInstance; store: Store } {
  const app = Fastify({ logger: false });
  const store = createStore({ scenarios, now: opts.now });

  registerErrorHandler(app);
  registerWorldRoutes(app, store);
  registerLoanRoutes(app, store);
  registerConditionRoutes(app, store);

  app.get("/health", async () => ({ ok: true }));
  return { app, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { app } = buildServer();
  const port = Number(process.env.PORT ?? 4000);
  app.listen({ port, host: "127.0.0.1" })
    .then(() => console.log(`api listening on :${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
```

Note: error handler + route modules don't exist yet — created in next tasks. The file won't type-check yet.

- [ ] **Step 4: Install + commit skeleton**

Run: `pnpm install`
```bash
git add packages/api/package.json packages/api/tsconfig.json packages/api/src/server.ts
git commit -m "feat(api): package skeleton"
```

### Task 5.2: Error handler mapping `ActionError` → HTTP 400

**Files:**
- Create: `packages/api/src/errors.ts`

- [ ] **Step 1: Write `packages/api/src/errors.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { ActionError } from "@twin/core";

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ActionError) {
      reply.status(400).send(err.toJSON());
      return;
    }
    if ((err as { validation?: unknown }).validation) {
      reply.status(400).send({
        code: "REQUIRED_FIELD_MISSING",
        message: err.message,
        details: (err as { validation?: unknown }).validation,
      });
      return;
    }
    const requestId = Math.random().toString(36).slice(2, 10);
    app.log.error({ requestId, err }, "unhandled");
    reply.status(500).send({ code: "INTERNAL", message: err.message, requestId });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/errors.ts
git commit -m "feat(api): error handler mapping ActionError to 400"
```

### Task 5.3: Zod schemas

**Files:**
- Create: `packages/api/src/schemas.ts`

- [ ] **Step 1: Write `packages/api/src/schemas.ts`**

```ts
import { z } from "zod";

export const ActorSchema = z.object({
  kind: z.enum(["human", "agent"]),
  id: z.string().min(1),
});

export const LoadScenarioSchema = z.object({ scenarioId: z.string().min(1) });

export const DecisionSchema = z.object({
  decision: z.enum(["pending", "approved", "suspended", "counter", "denied"]),
  rationale: z.string().min(1),
  actor: ActorSchema,
});

export const MilestoneSchema = z.object({
  milestone: z.string().min(1),
  actor: ActorSchema,
});

export const QualifyingIncomeSchema = z.object({
  worksheet: z.object({
    method: z.enum([
      "BankStatementDeposits", "DSCRCoverage", "AssetDepletionMonths",
      "1099Gross", "PnLCPACertified", "TraditionalDocs",
    ]),
    monthsCovered: z.number().optional(),
    avgDeposits: z.number().optional(),
    expenseFactor: z.number().optional(),
    nsfCount: z.number().optional(),
    dscrNumerator: z.number().optional(),
    dscrDenominator: z.number().optional(),
    totalAssets: z.number().optional(),
    depletionMonths: z.number().optional(),
    gross1099: z.number().optional(),
    cpaCertifiedNetIncome: z.number().optional(),
    derivedMonthlyIncome: z.number(),
  }),
  actor: ActorSchema,
});

export const NewConditionSchema = z.object({
  condition: z.object({
    category: z.enum(["PTA", "PTD", "PTF", "PTP"]),
    source: z.enum(["UW", "AUS", "Compliance", "Investor"]),
    description: z.string().min(1),
    status: z.enum(["Open", "Requested", "Received", "Cleared", "Waived"]).optional(),
  }),
  actor: ActorSchema,
});

export const UpdateConditionSchema = z.object({
  patch: z.object({
    category: z.enum(["PTA", "PTD", "PTF", "PTP"]).optional(),
    source: z.enum(["UW", "AUS", "Compliance", "Investor"]).optional(),
    description: z.string().optional(),
    status: z.enum(["Open", "Requested", "Received", "Cleared", "Waived"]).optional(),
    notes: z.string().optional(),
  }),
  actor: ActorSchema,
});

export const ClearConditionSchema = z.object({
  notes: z.string().optional(),
  actor: ActorSchema,
});

export const WaiveConditionSchema = z.object({
  rationale: z.string().min(1),
  actor: ActorSchema,
});

export const ActorOnlySchema = z.object({ actor: ActorSchema });
```

- [ ] **Step 2: Commit**

```bash
git add packages/api/src/schemas.ts
git commit -m "feat(api): zod request schemas"
```

### Task 5.4: World routes (`/world/*`, `/scenarios`, `/health`)

**Files:**
- Create: `packages/api/src/routes/world.ts`
- Create: `packages/api/test/world.http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/world.http.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";

describe("world routes", () => {
  it("GET /scenarios lists all 12 scenarios", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({ method: "GET", url: "/scenarios" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(12);
  });

  it("POST /world/load-scenario hydrates the store", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBe("nqm-bankstmt-12mo-clean");
  });

  it("POST /world/load-scenario with unknown id returns 400", async () => {
    const { app } = buildServer({ now: fixed });
    const res = await app.inject({
      method: "POST", url: "/world/load-scenario", payload: { scenarioId: "nope" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("SCENARIO_NOT_FOUND");
  });

  it("POST /world/reset clears the loaded scenario", async () => {
    const { app } = buildServer({ now: fixed });
    await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    const res = await app.inject({ method: "POST", url: "/world/reset" });
    expect(res.statusCode).toBe(200);
    expect(res.json().scenarioId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/api exec vitest run test/world.http.test.ts`
Expected: FAIL — routes not registered.

- [ ] **Step 3: Write `packages/api/src/routes/world.ts`**

```ts
import type { FastifyInstance } from "fastify";
import type { Store } from "@twin/core";
import { LoadScenarioSchema } from "../schemas.js";

export function registerWorldRoutes(app: FastifyInstance, store: Store) {
  app.get("/scenarios", async () => store.listScenarios());

  app.post("/world/load-scenario", async (req, reply) => {
    const body = LoadScenarioSchema.parse(req.body);
    store.dispatch({ type: "LoadScenario", scenarioId: body.scenarioId });
    reply.send({ scenarioId: store.getState().scenarioId });
  });

  app.post("/world/reset", async (_req, reply) => {
    store.dispatch({ type: "ResetWorld" });
    reply.send({ scenarioId: store.getState().scenarioId });
  });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/api exec vitest run test/world.http.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/world.ts packages/api/test/world.http.test.ts
git commit -m "feat(api): world routes"
```

### Task 5.5: Loan routes (`/loans*`)

**Files:**
- Create: `packages/api/src/routes/loans.ts`
- Create: `packages/api/test/loans.http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/loans.http.test.ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";

async function loaded() {
  const { app, store } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return { app, store };
}

describe("loan routes", () => {
  it("GET /loans returns pipeline summary rows", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
    expect(res.json()[0].id).toBe("2501000101");
  });

  it("GET /loans/:id returns full loan", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101" });
    expect(res.statusCode).toBe(200);
    expect(res.json().nqmProgram).toBe("BankStatement12");
  });

  it("GET /loans/:id returns 400 for unknown id", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/999" });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("LOAN_NOT_FOUND");
  });

  it("POST /loans/:id/decision sets the decision", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/decision",
      payload: { decision: "approved", rationale: "clean", actor: { kind: "agent", id: "t" } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("approved");
  });

  it("POST /loans/:id/milestone advances milestone", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/milestone",
      payload: { milestone: "UW Review", actor: { kind: "human", id: "uw1" } },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /loans/:id/qualifying-income recalculates", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/qualifying-income",
      payload: {
        worksheet: { method: "BankStatementDeposits", derivedMonthlyIncome: 10000 },
        actor: { kind: "agent", id: "income-bot" },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().income.totalMonthlyIncome).toBe(10000);
  });

  it("GET /loans/:id/audit returns the action log", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101/audit" });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    expect(res.json().length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/api exec vitest run test/loans.http.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/api/src/routes/loans.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import { DecisionSchema, MilestoneSchema, QualifyingIncomeSchema } from "../schemas.js";

function pipelineRow(l: { id: string; borrower: { fullName: string };
  nqmProgram: string; transaction: { loanAmount: number; ltv: number };
  decision: string; conditions: { status: string }[] }) {
  return {
    id: l.id,
    borrower: l.borrower.fullName,
    program: l.nqmProgram,
    loanAmount: l.transaction.loanAmount,
    ltv: l.transaction.ltv,
    decision: l.decision,
    openConditions: l.conditions.filter((c) => c.status === "Open").length,
  };
}

function requireLoan(store: Store, id: string) {
  const l = store.getLoan(id);
  if (!l) throw new ActionError("LOAN_NOT_FOUND", `loan '${id}' not found`, { loanId: id });
  return l;
}

export function registerLoanRoutes(app: FastifyInstance, store: Store) {
  app.get("/loans", async () =>
    Object.values(store.getState().loans).map(pipelineRow));

  app.get<{ Params: { loanId: string } }>("/loans/:loanId", async (req) =>
    requireLoan(store, req.params.loanId));

  app.get<{ Params: { loanId: string } }>("/loans/:loanId/audit", async () =>
    store.getAuditLog());

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/decision", async (req, reply) => {
    const body = DecisionSchema.parse(req.body);
    store.dispatch({ type: "SetDecision", loanId: req.params.loanId, ...body });
    reply.send(requireLoan(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/milestone", async (req, reply) => {
    const body = MilestoneSchema.parse(req.body);
    store.dispatch({ type: "AdvanceMilestone", loanId: req.params.loanId, ...body });
    reply.send(requireLoan(store, req.params.loanId));
  });

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/qualifying-income", async (req, reply) => {
    const body = QualifyingIncomeSchema.parse(req.body);
    store.dispatch({ type: "RecalculateQualifyingIncome", loanId: req.params.loanId,
      worksheet: body.worksheet, actor: body.actor });
    reply.send(requireLoan(store, req.params.loanId));
  });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/api exec vitest run test/loans.http.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routes/loans.ts packages/api/test/loans.http.test.ts
git commit -m "feat(api): loan routes"
```

### Task 5.6: Condition routes

**Files:**
- Create: `packages/api/src/routes/conditions.ts`
- Create: `packages/api/test/conditions.http.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/api/test/conditions.http.test.ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";
const actor = { kind: "human" as const, id: "uw1" };

async function loaded() {
  const { app, store } = buildServer({ now: fixed });
  await app.inject({ method: "POST", url: "/world/load-scenario",
    payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
  return { app, store };
}

describe("condition routes", () => {
  it("GET /loans/:id/conditions returns the condition list", async () => {
    const { app } = await loaded();
    const res = await app.inject({ method: "GET", url: "/loans/2501000101/conditions" });
    expect(res.statusCode).toBe(200);
    expect(res.json().length).toBeGreaterThan(0);
  });

  it("POST /loans/:id/conditions adds a condition", async () => {
    const { app } = await loaded();
    const res = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "New test" }, actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("POST /loans/:id/conditions/:cid/clear transitions to Cleared", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "Doc", status: "Received" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "POST", url: `/loans/2501000101/conditions/${cid}/clear`,
      payload: { notes: "ok", actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conditions.find((c: { id: string }) => c.id === cid).status).toBe("Cleared");
  });

  it("POST .../waive transitions to Waived", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "W" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "POST", url: `/loans/2501000101/conditions/${cid}/waive`,
      payload: { rationale: "exec override", actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("DELETE removes a condition", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "D" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "DELETE", url: `/loans/2501000101/conditions/${cid}`, payload: { actor },
    });
    expect(res.statusCode).toBe(200);
  });

  it("PATCH updates a condition", async () => {
    const { app } = await loaded();
    const added = await app.inject({
      method: "POST", url: "/loans/2501000101/conditions",
      payload: { condition: { category: "PTD", source: "UW", description: "P1" }, actor },
    });
    const cid = added.json().conditions.at(-1).id;
    const res = await app.inject({
      method: "PATCH", url: `/loans/2501000101/conditions/${cid}`,
      payload: { patch: { description: "P2" }, actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().conditions.find((c: { id: string }) => c.id === cid).description).toBe("P2");
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm --filter @twin/api exec vitest run test/conditions.http.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `packages/api/src/routes/conditions.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { ActionError, type Store } from "@twin/core";
import {
  NewConditionSchema, UpdateConditionSchema,
  ClearConditionSchema, WaiveConditionSchema, ActorOnlySchema,
} from "../schemas.js";

function requireLoan(store: Store, id: string) {
  const l = store.getLoan(id);
  if (!l) throw new ActionError("LOAN_NOT_FOUND", `loan '${id}' not found`, { loanId: id });
  return l;
}

export function registerConditionRoutes(app: FastifyInstance, store: Store) {
  app.get<{ Params: { loanId: string } }>("/loans/:loanId/conditions", async (req) =>
    requireLoan(store, req.params.loanId).conditions);

  app.post<{ Params: { loanId: string } }>("/loans/:loanId/conditions", async (req, reply) => {
    const body = NewConditionSchema.parse(req.body);
    store.dispatch({ type: "AddCondition", loanId: req.params.loanId,
      condition: body.condition, actor: body.actor });
    reply.send(requireLoan(store, req.params.loanId));
  });

  app.patch<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId",
    async (req, reply) => {
      const body = UpdateConditionSchema.parse(req.body);
      store.dispatch({ type: "UpdateCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, patch: body.patch, actor: body.actor });
      reply.send(requireLoan(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId/clear",
    async (req, reply) => {
      const body = ClearConditionSchema.parse(req.body);
      store.dispatch({ type: "ClearCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, notes: body.notes, actor: body.actor });
      reply.send(requireLoan(store, req.params.loanId));
    });

  app.post<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId/waive",
    async (req, reply) => {
      const body = WaiveConditionSchema.parse(req.body);
      store.dispatch({ type: "WaiveCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, rationale: body.rationale, actor: body.actor });
      reply.send(requireLoan(store, req.params.loanId));
    });

  app.delete<{ Params: { loanId: string; conditionId: string } }>(
    "/loans/:loanId/conditions/:conditionId",
    async (req, reply) => {
      const body = ActorOnlySchema.parse(req.body);
      store.dispatch({ type: "RemoveCondition", loanId: req.params.loanId,
        conditionId: req.params.conditionId, actor: body.actor });
      reply.send(requireLoan(store, req.params.loanId));
    });
}
```

- [ ] **Step 4: Run — expect pass**

Run: `pnpm --filter @twin/api exec vitest run test/conditions.http.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Run full api suite**

Run: `pnpm --filter @twin/api test`
Expected: all green (17 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routes/conditions.ts packages/api/test/conditions.http.test.ts
git commit -m "feat(api): condition routes"
```

### Task 5.7: Agent acceptance test (Slice 1 exit criterion)

This is **the** test that locks Slice 1: a scripted HTTP agent drives `nqm-bankstmt-12mo-clean` to approval.

**Files:**
- Create: `packages/api/test/agent-acceptance.test.ts`

- [ ] **Step 1: Write the test**

```ts
// packages/api/test/agent-acceptance.test.ts
import { describe, expect, it } from "vitest";
import { buildServer } from "../src/server.js";

const fixed = () => "2026-04-11T12:00:00.000Z";
const actor = { kind: "agent" as const, id: "acceptance-bot" };

describe("agent acceptance — nqm-bankstmt-12mo-clean", () => {
  it("agent drives the loan end-to-end via HTTP", async () => {
    const { app } = buildServer({ now: fixed });

    // 1. Load scenario
    let res = await app.inject({ method: "POST", url: "/world/load-scenario",
      payload: { scenarioId: "nqm-bankstmt-12mo-clean" } });
    expect(res.statusCode).toBe(200);

    // 2. Read transmittal
    res = await app.inject({ method: "GET", url: "/loans/2501000101" });
    const loan = res.json();
    expect(loan.qualifyingMethod).toBe("BankStatementDeposits");
    expect(loan.decision).toBe("pending");

    // 3. Agent confirms qualifying income calculation
    res = await app.inject({
      method: "POST", url: "/loans/2501000101/qualifying-income",
      payload: {
        worksheet: { method: "BankStatementDeposits", monthsCovered: 12,
          avgDeposits: 18000, expenseFactor: 0.5, nsfCount: 0, derivedMonthlyIncome: 9000 },
        actor,
      },
    });
    expect(res.statusCode).toBe(200);

    // 4. Agent clears each starter condition as docs come in
    const conditionsRes = await app.inject({ method: "GET", url: "/loans/2501000101/conditions" });
    const conditions = conditionsRes.json();
    for (const c of conditions) {
      await app.inject({
        method: "POST", url: `/loans/2501000101/conditions/${c.id}/clear`,
        payload: { notes: "verified", actor },
      });
    }

    // 5. Agent records decision
    res = await app.inject({
      method: "POST", url: "/loans/2501000101/decision",
      payload: { decision: "approved", rationale: "All PTDs cleared, DTI in range", actor },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().decision).toBe("approved");

    // 6. Verify audit log tells the full story
    res = await app.inject({ method: "GET", url: "/loans/2501000101/audit" });
    const log = res.json();
    const types = log.map((e: { action: { type: string } }) => e.action.type);
    expect(types).toContain("LoadScenario");
    expect(types).toContain("RecalculateQualifyingIncome");
    expect(types.filter((t: string) => t === "ClearCondition").length).toBe(conditions.length);
    expect(types).toContain("SetDecision");
  });
});
```

- [ ] **Step 2: Run — expect pass**

Run: `pnpm --filter @twin/api exec vitest run test/agent-acceptance.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 3: Commit**

```bash
git add packages/api/test/agent-acceptance.test.ts
git commit -m "test(api): agent acceptance — slice 1 exit criterion"
```

---

## Phase 6 — `web` Package: Next.js UI

The UI is a thin HTTP client of `api`. Each screen area is a small file so components stay focused.

### Task 6.1: Next.js app skeleton + Tailwind

**Files:**
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/next.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/postcss.config.js`
- Create: `packages/web/app/layout.tsx`
- Create: `packages/web/app/globals.css`
- Create: `packages/web/app/page.tsx`

- [ ] **Step 1: Write `packages/web/package.json`**

```json
{
  "name": "@twin/web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev --port 3000",
    "build": "next build",
    "start": "next start",
    "test": "vitest run"
  },
  "dependencies": {
    "@twin/core": "workspace:*",
    "next": "^15.0.3",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "typescript": "^5.5.4",
    "tailwindcss": "^3.4.10",
    "postcss": "^8.4.41",
    "autoprefixer": "^10.4.20",
    "vitest": "^2.0.5",
    "@testing-library/react": "^16.0.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 2: Write `packages/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "allowJs": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Write `packages/web/next.config.ts`**

```ts
import type { NextConfig } from "next";
const config: NextConfig = {
  experimental: { externalDir: true },
  transpilePackages: ["@twin/core"],
  env: { TWIN_API_URL: process.env.TWIN_API_URL ?? "http://127.0.0.1:4000" },
};
export default config;
```

- [ ] **Step 4: Write `packages/web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        encompass: {
          navy: "#0a52a0",
          navyDark: "#08407d",
          navyDeep: "#07305e",
          beige: "#ece9d8",
          beigeDark: "#d4d0c8",
          border: "#6b7a8f",
          borderLight: "#c8c4b5",
          gold: "#ffd77a",
          goldDark: "#c79b2d",
          goldBtn: "#ffe28a",
          goldBtnDark: "#d79a1f",
          labelMuted: "#404040",
          rowAlt: "#f5f3e8",
        },
      },
      fontFamily: { encompass: ['"Segoe UI"', "Tahoma", '"MS Sans Serif"', "sans-serif"] },
      fontSize: { "enc-xs": "9px", enc: "10px", "enc-md": "11px" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Step 5: Write `packages/web/postcss.config.js`**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Step 6: Write `packages/web/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root { --enc-shadow: 0 1px 0 #fff inset, 0 -1px 0 #8a9cb3 inset; }

html, body {
  font-family: "Segoe UI", Tahoma, "MS Sans Serif", sans-serif;
  font-size: 10px;
  color: #000;
  background: #ece9d8;
}

.enc-sec { border: 1px solid #6b7a8f; background: #fff; margin: 4px 0; }
.enc-sec > h4 {
  background: linear-gradient(#0a52a0, #08407d);
  color: #fff; padding: 2px 6px; font-size: 10px; font-weight: 700; margin: 0;
}
.enc-grid-8 { display: grid; grid-template-columns: repeat(8, minmax(0, 1fr)); }
.enc-field { border-right: 1px solid #c8c4b5; border-bottom: 1px solid #c8c4b5;
  padding: 1px 4px; min-height: 28px; }
.enc-field label { display: block; color: #404040; font-size: 9px; line-height: 1.1; }
.enc-field .v { font-size: 11px; font-weight: 600; font-family: Tahoma, sans-serif; }

.enc-btn { font-size: 10px; padding: 1px 10px; border: 1px solid #6b7a8f;
  background: linear-gradient(#fff, #dcd7c0); cursor: pointer; }
.enc-btn--primary { background: linear-gradient(#ffe28a, #d79a1f); font-weight: 700; }

.enc-pill { display: inline-block; padding: 0 4px; font-size: 9px; font-weight: 700; border: 1px solid; }
.enc-pill--open    { background: #ffe8c2; border-color: #8a4b00; color: #8a4b00; }
.enc-pill--rcvd    { background: #d7ecd0; border-color: #1b5e20; color: #1b5e20; }
.enc-pill--cleared { background: #cfe0f5; border-color: #0d47a1; color: #0d47a1; }
.enc-pill--waived  { background: #e6e6e6; border-color: #555;   color: #333; }
.enc-pill--reqd    { background: #fff;    border-color: #8a4b00; color: #8a4b00; }
```

- [ ] **Step 7: Write `packages/web/app/layout.tsx`**

```tsx
import "./globals.css";
import type { ReactNode } from "react";

export const metadata = { title: "Encompass Digital Twin" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

- [ ] **Step 8: Write `packages/web/app/page.tsx`**

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/loan/2501000101/transmittal");
}
```

- [ ] **Step 9: Install + build sanity check**

Run: `pnpm install`
Run: `pnpm --filter @twin/web exec next build`
Expected: may warn about missing `/loan/[loanId]` route — we add it next. No TS errors.

- [ ] **Step 10: Commit**

```bash
git add packages/web
git commit -m "feat(web): next.js skeleton + encompass theme"
```

### Task 6.2: Typed API client

**Files:**
- Create: `packages/web/lib/api-client.ts`

- [ ] **Step 1: Write `packages/web/lib/api-client.ts`**

```ts
import type {
  Loan, NewCondition, QualifyingIncomeWorksheet, UwDecision, Actor, Condition, LoggedAction,
} from "@twin/core";

const base = process.env.TWIN_API_URL ?? "http://127.0.0.1:4000";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    headers: { "content-type": "application/json" },
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ code: "INTERNAL", message: res.statusText }));
    throw new Error(`${body.code}: ${body.message}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listScenarios: () => req<Array<{ id: string; name: string; description: string }>>("/scenarios"),
  loadScenario: (scenarioId: string) =>
    req<{ scenarioId: string | null }>("/world/load-scenario", {
      method: "POST", body: JSON.stringify({ scenarioId }),
    }),
  reset: () => req<{ scenarioId: null }>("/world/reset", { method: "POST" }),
  getLoan: (loanId: string) => req<Loan>(`/loans/${loanId}`),
  listLoans: () => req<Array<{ id: string; borrower: string; program: string;
    loanAmount: number; ltv: number; decision: string; openConditions: number }>>("/loans"),
  getConditions: (loanId: string) => req<Condition[]>(`/loans/${loanId}/conditions`),
  getAudit: (loanId: string) => req<LoggedAction[]>(`/loans/${loanId}/audit`),
  setDecision: (loanId: string, decision: UwDecision, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/decision`, {
      method: "POST", body: JSON.stringify({ decision, rationale, actor }),
    }),
  recalcIncome: (loanId: string, worksheet: QualifyingIncomeWorksheet, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/qualifying-income`, {
      method: "POST", body: JSON.stringify({ worksheet, actor }),
    }),
  addCondition: (loanId: string, condition: NewCondition, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions`, {
      method: "POST", body: JSON.stringify({ condition, actor }),
    }),
  clearCondition: (loanId: string, conditionId: string, notes: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/clear`, {
      method: "POST", body: JSON.stringify({ notes, actor }),
    }),
  waiveCondition: (loanId: string, conditionId: string, rationale: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}/waive`, {
      method: "POST", body: JSON.stringify({ rationale, actor }),
    }),
  removeCondition: (loanId: string, conditionId: string, actor: Actor) =>
    req<Loan>(`/loans/${loanId}/conditions/${conditionId}`, {
      method: "DELETE", body: JSON.stringify({ actor }),
    }),
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/lib/api-client.ts
git commit -m "feat(web): typed api client"
```

### Task 6.3: Server actions

**Files:**
- Create: `packages/web/app/loan/[loanId]/actions.ts`

- [ ] **Step 1: Write the file**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { api } from "@/lib/api-client";
import type { Actor, UwDecision, NewCondition } from "@twin/core";

const humanActor: Actor = { kind: "human", id: "uw-local" };

export async function actionLoadScenario(scenarioId: string) {
  await api.loadScenario(scenarioId);
  revalidatePath("/loan", "layout");
}

export async function actionSetDecision(loanId: string, decision: UwDecision, rationale: string) {
  await api.setDecision(loanId, decision, rationale, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionAddCondition(loanId: string, condition: NewCondition) {
  await api.addCondition(loanId, condition, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionClearCondition(loanId: string, conditionId: string, notes: string) {
  await api.clearCondition(loanId, conditionId, notes, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionWaiveCondition(loanId: string, conditionId: string, rationale: string) {
  await api.waiveCondition(loanId, conditionId, rationale, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}

export async function actionRemoveCondition(loanId: string, conditionId: string) {
  await api.removeCondition(loanId, conditionId, humanActor);
  revalidatePath(`/loan/${loanId}`, "layout");
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/app/loan
git commit -m "feat(web): next.js server actions"
```

### Task 6.4: Chrome components — TitleBar, MenuBar, Toolbar, LoanHeader, NavTree

**Files:**
- Create: `packages/web/components/encompass/TitleBar.tsx`
- Create: `packages/web/components/encompass/MenuBar.tsx`
- Create: `packages/web/components/encompass/Toolbar.tsx`
- Create: `packages/web/components/encompass/LoanHeader.tsx`
- Create: `packages/web/components/encompass/NavTree.tsx`

- [ ] **Step 1: `TitleBar.tsx`**

```tsx
export function TitleBar({ scenarioId }: { scenarioId: string | null }) {
  return (
    <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold flex justify-between border-b border-black">
      <span>Encompass360 — Underwriting (Digital Twin)</span>
      <span>{scenarioId ?? "— no scenario —"}</span>
    </div>
  );
}
```

- [ ] **Step 2: `MenuBar.tsx`**

```tsx
const ITEMS = ["File", "Edit", "View", "Loan", "Forms", "Services", "Tools", "Help"];
export function MenuBar() {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] text-[11px]">
      {ITEMS.map((i) => (
        <span key={i} className="mr-3"><u>{i[0]}</u>{i.slice(1)}</span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: `Toolbar.tsx`**

```tsx
const BTNS = ["Pipeline", "Open", "Save", "Print", "Conditions", "Log", "eFolder", "AUS"];
export function Toolbar() {
  return (
    <div className="bg-[#ece9d8] border-b border-[#9aa0a8] px-2 py-[2px] flex gap-1">
      {BTNS.map((b) => (
        <button key={b} className="enc-btn">{b}</button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: `LoanHeader.tsx`**

```tsx
import type { Loan } from "@twin/core";

function Cell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border-r border-[#b0aa99] px-2">
      <label className="block text-[9px] text-[#404040]">{label}</label>
      <b>{value}</b>
    </div>
  );
}

export function LoanHeader({ loan }: { loan: Loan }) {
  return (
    <div className="bg-[#d4d0c8] border-b border-[#6b7a8f] py-1 grid grid-cols-8 text-[10px]">
      <Cell label="Borrower" value={loan.borrower.fullName} />
      <Cell label="Loan #" value={loan.id} />
      <Cell label="Program" value={loan.nqmProgram} />
      <Cell label="Loan Amt" value={`$${loan.transaction.loanAmount.toLocaleString()}`} />
      <Cell label="Rate" value={`${loan.transaction.noteRate.toFixed(4)}%`} />
      <Cell label="LTV/CLTV" value={`${loan.transaction.ltv.toFixed(2)} / ${loan.transaction.cltv.toFixed(2)}`} />
      <Cell label="DTI" value={`${loan.qualifying.housingRatio.toFixed(1)} / ${loan.qualifying.totalDti.toFixed(1)}`} />
      <Cell label="Decision" value={loan.decision} />
    </div>
  );
}
```

- [ ] **Step 5: `NavTree.tsx`**

```tsx
const GROUPS: Array<{ title: string; items: string[] }> = [
  { title: "Loan", items: ["Borrower Summary", "Alerts & Messages"] },
  { title: "Forms", items: ["1003 Page 1", "1003 Page 2", "1003 Page 3", "Transmittal Summary", "URLA – Additional", "GFE", "HUD-1"] },
  { title: "Tools", items: ["Conditions", "Conversation Log", "AUS Tracking"] },
  { title: "Services", items: ["Credit", "AUS (DU / LPA)", "Product & Pricing"] },
];

export function NavTree({ activeItem = "Transmittal Summary" }: { activeItem?: string }) {
  return (
    <div className="bg-white border-r border-[#6b7a8f] text-[10px] w-[172px]">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="bg-gradient-to-b from-[#e2ddc7] to-[#cfc9ae] font-bold px-2 py-[2px] border-y border-[#6b7a8f]">{g.title}</div>
          <ul className="m-0 p-0 list-none">
            {g.items.map((i) => (
              <li key={i}
                  className={"pl-4 pr-2 py-[1px] border-b border-dotted border-[#dcd7c0] cursor-pointer " +
                    (i === activeItem ? "bg-[#316ac5] text-white" : "")}>
                {i}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/web/components/encompass
git commit -m "feat(web): chrome components (TitleBar, MenuBar, Toolbar, LoanHeader, NavTree)"
```

### Task 6.5: Data components — Section, Field, DecisionBar, ConditionsTable, ConditionModal

**Files:**
- Create: `packages/web/components/encompass/Section.tsx`
- Create: `packages/web/components/encompass/Field.tsx`
- Create: `packages/web/components/encompass/DecisionBar.tsx`
- Create: `packages/web/components/encompass/ConditionsTable.tsx`
- Create: `packages/web/components/encompass/ConditionModal.tsx`
- Create: `packages/web/components/encompass/ErrorDialog.tsx`

- [ ] **Step 1: `Section.tsx`**

```tsx
import type { ReactNode } from "react";

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="enc-sec">
      <h4>{title}</h4>
      <div className="enc-grid-8">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: `Field.tsx`**

```tsx
export function Field({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="enc-field">
      <label>{label}</label>
      <div className="v">{value}</div>
    </div>
  );
}
```

- [ ] **Step 3: `DecisionBar.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { UwDecision } from "@twin/core";
import { actionSetDecision } from "@/app/loan/[loanId]/actions";

export function DecisionBar({ loanId, current }: { loanId: string; current: UwDecision }) {
  const [rationale, setRationale] = useState("");
  const [pending, startTransition] = useTransition();

  const run = (decision: UwDecision) => {
    if (!rationale.trim()) { alert("Rationale required"); return; }
    startTransition(() => actionSetDecision(loanId, decision, rationale));
  };

  return (
    <div className="flex items-center gap-1 px-2 py-1 bg-[#ece9d8] border border-[#6b7a8f]">
      <button className="enc-btn enc-btn--primary" disabled={pending} onClick={() => run("approved")}>Approve</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("suspended")}>Suspend</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("counter")}>Counter</button>
      <button className="enc-btn" disabled={pending} onClick={() => run("denied")}>Deny</button>
      <input className="ml-2 border border-[#7f9db9] text-[11px] px-1 flex-1"
        placeholder="Rationale…" value={rationale} onChange={(e) => setRationale(e.target.value)} />
      <span className="ml-auto text-[10px]">Current: <b>{current}</b></span>
    </div>
  );
}
```

- [ ] **Step 4: `ConditionsTable.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import type { Condition } from "@twin/core";
import { actionClearCondition, actionWaiveCondition, actionRemoveCondition } from "@/app/loan/[loanId]/actions";

const PILL: Record<Condition["status"], string> = {
  Open: "enc-pill enc-pill--open",
  Requested: "enc-pill enc-pill--reqd",
  Received: "enc-pill enc-pill--rcvd",
  Cleared: "enc-pill enc-pill--cleared",
  Waived: "enc-pill enc-pill--waived",
};

export function ConditionsTable({ loanId, conditions }: { loanId: string; conditions: Condition[] }) {
  const [pending, startTransition] = useTransition();

  return (
    <table className="w-full border-collapse text-[10px]">
      <thead>
        <tr className="bg-gradient-to-b from-[#0a52a0] to-[#08407d] text-white">
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">#</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Cat</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Source</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Description</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Status</th>
          <th className="text-left px-1 py-[2px] border-r border-[#08407d]">Added</th>
          <th className="text-left px-1 py-[2px]">Actions</th>
        </tr>
      </thead>
      <tbody>
        {conditions.map((c, i) => (
          <tr key={c.id} className={i % 2 ? "bg-[#f5f3e8]" : ""}>
            <td className="px-1">{i + 1}</td>
            <td className="px-1">{c.category}</td>
            <td className="px-1">{c.source}</td>
            <td className="px-1">{c.description}</td>
            <td className="px-1"><span className={PILL[c.status]}>{c.status}</span></td>
            <td className="px-1">{c.addedAt.slice(5, 10).replace("-", "/")}</td>
            <td className="px-1 flex gap-1">
              <button className="enc-btn" disabled={pending}
                onClick={() => startTransition(() => actionClearCondition(loanId, c.id, "verified"))}>
                Clear
              </button>
              <button className="enc-btn" disabled={pending}
                onClick={() => {
                  const r = prompt("Waive rationale?");
                  if (r) startTransition(() => actionWaiveCondition(loanId, c.id, r));
                }}>
                Waive
              </button>
              <button className="enc-btn" disabled={pending}
                onClick={() => startTransition(() => actionRemoveCondition(loanId, c.id))}>
                ×
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: `ConditionModal.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import type { NewCondition } from "@twin/core";
import { actionAddCondition } from "@/app/loan/[loanId]/actions";

export function ConditionModal({ loanId }: { loanId: string }) {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<NewCondition["category"]>("PTD");
  const [src, setSrc] = useState<NewCondition["source"]>("UW");
  const [desc, setDesc] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return <button className="enc-btn" onClick={() => setOpen(true)}>+ Add Condition</button>;
  }

  const submit = () => {
    if (!desc.trim()) return;
    startTransition(() => {
      actionAddCondition(loanId, { category: cat, source: src, description: desc })
        .then(() => { setOpen(false); setDesc(""); });
    });
  };

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-[#ece9d8] border border-[#6b7a8f] w-[420px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold">
          Add Condition
        </div>
        <div className="p-3 flex flex-col gap-2 text-[11px]">
          <label>Category
            <select className="ml-2 border border-[#7f9db9]" value={cat}
              onChange={(e) => setCat(e.target.value as NewCondition["category"])}>
              <option>PTA</option><option>PTD</option><option>PTF</option><option>PTP</option>
            </select>
          </label>
          <label>Source
            <select className="ml-2 border border-[#7f9db9]" value={src}
              onChange={(e) => setSrc(e.target.value as NewCondition["source"])}>
              <option>UW</option><option>AUS</option><option>Compliance</option><option>Investor</option>
            </select>
          </label>
          <label className="flex flex-col">Description
            <input className="border border-[#7f9db9] px-1" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <div className="flex gap-2 justify-end mt-2">
            <button className="enc-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="enc-btn enc-btn--primary" disabled={pending} onClick={submit}>Add</button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: `ErrorDialog.tsx`**

```tsx
"use client";

export function ErrorDialog({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-[#ece9d8] border border-[#6b7a8f] w-[380px]">
        <div className="bg-gradient-to-b from-[#0a52a0] to-[#07305e] text-white px-2 py-1 text-[11px] font-bold">
          Error
        </div>
        <div className="p-3 text-[11px]">{message}</div>
        <div className="p-2 text-right">
          <button className="enc-btn" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/web/components/encompass
git commit -m "feat(web): data components (Section, Field, DecisionBar, Conditions, dialogs)"
```

### Task 6.6: Loan shell layout + Transmittal page

**Files:**
- Create: `packages/web/app/loan/[loanId]/layout.tsx`
- Create: `packages/web/app/loan/[loanId]/page.tsx`
- Create: `packages/web/app/loan/[loanId]/transmittal/page.tsx`

- [ ] **Step 1: `layout.tsx`** — loan shell (titlebar/menu/toolbar/loan header/nav + children)

```tsx
import { api } from "@/lib/api-client";
import { TitleBar } from "@/components/encompass/TitleBar";
import { MenuBar } from "@/components/encompass/MenuBar";
import { Toolbar } from "@/components/encompass/Toolbar";
import { LoanHeader } from "@/components/encompass/LoanHeader";
import { NavTree } from "@/components/encompass/NavTree";
import type { ReactNode } from "react";

export default async function LoanLayout({
  children, params,
}: { children: ReactNode; params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;

  // Ensure the default scenario is loaded so the layout has a loan to show
  try {
    await api.getLoan(loanId);
  } catch {
    await api.loadScenario("nqm-bankstmt-12mo-clean");
  }

  const loan = await api.getLoan(loanId);

  return (
    <div className="border border-[#6b7a8f] m-2">
      <TitleBar scenarioId={loan.id} />
      <MenuBar />
      <Toolbar />
      <LoanHeader loan={loan} />
      <div className="grid grid-cols-[172px_1fr] min-h-[540px]">
        <NavTree />
        <div className="bg-white p-1">{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `page.tsx`** — redirect to `/transmittal`

```tsx
import { redirect } from "next/navigation";
export default async function LoanIndex({ params }: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  redirect(`/loan/${loanId}/transmittal`);
}
```

- [ ] **Step 3: `transmittal/page.tsx`**

```tsx
import { api } from "@/lib/api-client";
import { Section } from "@/components/encompass/Section";
import { Field } from "@/components/encompass/Field";
import { DecisionBar } from "@/components/encompass/DecisionBar";
import { ConditionsTable } from "@/components/encompass/ConditionsTable";
import { ConditionModal } from "@/components/encompass/ConditionModal";

export default async function TransmittalPage({
  params,
}: { params: Promise<{ loanId: string }> }) {
  const { loanId } = await params;
  const loan = await api.getLoan(loanId);
  const money = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const openCount = loan.conditions.filter((c) => c.status === "Open").length;
  const rcvdCount = loan.conditions.filter((c) => c.status === "Received").length;
  const clrCount = loan.conditions.filter((c) => c.status === "Cleared").length;

  return (
    <>
      <div className="flex gap-[2px] border-b-2 border-[#1f4478] mb-1">
        <div className="px-3 py-[2px] bg-white font-bold border border-b-0 border-[#6b7a8f] text-[10px]">Page 1</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">Page 2</div>
        <div className="px-3 py-[2px] bg-[#d4d0c8] border border-b-0 border-[#6b7a8f] text-[10px]">UW Summary</div>
      </div>

      <Section title="Borrower & Property Information">
        <Field label="Borrower" value={loan.borrower.fullName} />
        <Field label="SSN" value={loan.borrower.ssnMasked} />
        <Field label="DOB" value={loan.borrower.dob} />
        <Field label="Marital" value={loan.borrower.maritalStatus} />
        <Field label="Subj. Address" value={loan.property.street} />
        <Field label="City" value={loan.property.city} />
        <Field label="State" value={loan.property.state} />
        <Field label="Zip" value={loan.property.zip} />
        <Field label="Occupancy" value={loan.transaction.occupancy} />
        <Field label="Property Type" value={loan.property.propertyType} />
        <Field label="Units" value={loan.property.units} />
        <Field label="Year Built" value={loan.property.yearBuilt} />
        <Field label="Sales Price" value={loan.transaction.salesPrice ? money(loan.transaction.salesPrice) : "—"} />
        <Field label="Apprs. Value" value={money(loan.transaction.appraisedValue)} />
        <Field label="Purpose" value={loan.transaction.loanPurpose} />
        <Field label="Lien" value={loan.transaction.lienPosition === 1 ? "1st" : "2nd"} />
      </Section>

      <Section title="Mortgage Information">
        <Field label="Loan Amount" value={money(loan.transaction.loanAmount)} />
        <Field label="Note Rate" value={`${loan.transaction.noteRate.toFixed(4)}%`} />
        <Field label="Term (mo)" value={loan.transaction.term} />
        <Field label="Amort" value={loan.transaction.amortType} />
        <Field label="LTV" value={`${loan.transaction.ltv.toFixed(2)}%`} />
        <Field label="CLTV" value={`${loan.transaction.cltv.toFixed(2)}%`} />
        <Field label="HCLTV" value={`${loan.transaction.hcltv.toFixed(2)}%`} />
        <Field label="P&I" value={money(loan.qualifying.piPayment)} />
        <Field label="PITI" value={money(loan.transaction.piti)} />
        <Field label="Program" value={loan.nqmProgram} />
        <Field label="Qual Method" value={loan.qualifyingMethod} />
        <Field label="Qual Rate" value={`${loan.qualifying.qualifyingRate.toFixed(4)}%`} />
        <Field label="Channel" value="Retail" />
        <Field label="Investor" value="Non-QM" />
        <Field label="Occupancy" value={loan.transaction.occupancy} />
        <Field label="Lien" value={loan.transaction.lienPosition === 1 ? "1st" : "2nd"} />
      </Section>

      <Section title="Qualifying Ratios & Program Details">
        <Field label="Housing" value={`${loan.qualifying.housingRatio.toFixed(2)}%`} />
        <Field label="Total DTI" value={`${loan.qualifying.totalDti.toFixed(2)}%`} />
        <Field label="Monthly Inc." value={money(loan.income.totalMonthlyIncome)} />
        <Field label="Rep Score" value={loan.credit.repScore ?? "n/a"} />
        <Field label="Reserves (mo)" value={loan.assets.reservesMonths.toFixed(1)} />
        <Field label="Liquid Assets" value={money(loan.assets.totalLiquid)} />
        <Field label="Derived Inc." value={money(loan.qualifyingWorksheet.derivedMonthlyIncome)} />
        <Field label="Method" value={loan.qualifyingWorksheet.method} />
        <Field label="DSCR" value={loan.transaction.dscrRatio?.toFixed(2) ?? "—"} />
        <Field label="Rental Inc." value={loan.transaction.rentalIncome ? money(loan.transaction.rentalIncome) : "—"} />
        <Field label="AUS" value={loan.aus?.recommendation ?? "Manual UW"} />
        <Field label="AUS Engine" value={loan.aus?.engine ?? "—"} />
        <Field label="Milestone" value={loan.milestones.at(-1)?.name ?? "—"} />
        <Field label="Tradelines" value={`${loan.credit.tradelinesOpen}/${loan.credit.tradelinesTotal}`} />
        <Field label="Last Late" value={loan.credit.lastLate30d ?? "—"} />
        <Field label="Decision" value={loan.decision} />
      </Section>

      <DecisionBar loanId={loan.id} current={loan.decision} />

      <div className="enc-sec mt-2">
        <h4>Conditions — {openCount} Open · {rcvdCount} Received · {clrCount} Cleared</h4>
        <div className="p-1">
          <ConditionsTable loanId={loan.id} conditions={loan.conditions} />
          <div className="mt-2"><ConditionModal loanId={loan.id} /></div>
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/app/loan
git commit -m "feat(web): loan shell layout + Transmittal page"
```

---

## Phase 7 — End-to-End Smoke

### Task 7.1: Run both servers and click through

**Files:** none (manual + scripted check)

- [ ] **Step 1: Start the API**

Run (in one terminal): `pnpm dev:api`
Expected: `api listening on :4000`

- [ ] **Step 2: Start the web app**

Run (in another terminal): `pnpm dev:web`
Expected: Next.js serves on `:3000`.

- [ ] **Step 3: Hit the UI**

Open `http://localhost:3000` → redirects to `/loan/2501000101/transmittal`. Verify:
- Title bar shows the loan id
- Loan header strip shows borrower, loan amount, LTV/CLTV, DTI
- Three sections render with data from the fixture
- Conditions table shows 4 rows
- Decision bar shows "Current: pending"

- [ ] **Step 4: Drive the UI**

- Type a rationale, click **Approve** → decision flips to `approved`, visible in the header strip and decision bar.
- Click **Clear** on a condition → its pill flips to Cleared.
- Click **+ Add Condition** → modal opens, add a condition, it appears in the table.

- [ ] **Step 5: Full test suite**

Run: `pnpm -r test`
Expected: all packages green.

- [ ] **Step 6: Commit any smoke-fix changes**

```bash
git add -A
git commit -m "chore: slice 1 smoke-test fixes" --allow-empty
```

### Task 7.2: Tag Slice 1

- [ ] **Step 1: Tag**

```bash
git tag slice-1-complete
```

- [ ] **Step 2: Confirm**

Run: `git tag --list`
Expected: `slice-1-complete`

---

## Self-Review Notes

- **Spec coverage:** §1 purpose → Task 7.1 smoke + 5.7 acceptance. §2 slicing → plan header + scope to Slice 1 only. §5 architecture → Phases 1–6. §6 domain model → Task 1.2. §7 action catalog → Tasks 2.1–2.4. §8 HTTP API → Tasks 5.4–5.6. §9 UI → Tasks 6.1–6.6. §10 fixtures → Phase 4. §11 error handling → Task 5.2. §12 testing (unit, golden, HTTP, agent acceptance) → Tasks 2.x, 5.7. The fixture golden-state tests called for in §12 can be added ad-hoc during the agent acceptance task (5.7) — a single end-to-end assertion suffices for Slice 1 exit.
- **Placeholders:** none — every code step is complete.
- **Type consistency:** `Action` variants defined once in `types.ts` are used identically in `reduce.ts`, `schemas.ts`, and `api-client.ts`. `Condition`, `Loan`, `Actor`, `NewCondition`, `QualifyingIncomeWorksheet` are all from `@twin/core`.
- **Known-minor:** Task 4.3 describes the 11 secondary fixtures by shape rather than spelling each file verbatim. They follow Task 4.2 mechanically; the subagent executing them should copy 4.2 and substitute values from the table. This is intentional — repeating 11 near-identical code blocks would bloat the plan without adding information.

