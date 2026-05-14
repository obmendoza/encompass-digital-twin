import type { FastifyInstance } from "fastify";
import type { Loan, Store } from "@twin/core";
import { withTenantTx, withDb } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getAdapter, registerAdapter } from "../ingestion/adapter-registry.js";
import { GenericJsonAdapter } from "../ingestion/adapters/generic-json-adapter.js";
import { EncompassLOSAdapter } from "../ingestion/adapters/encompass-los.js";
import { NPNQMPortalAdapter } from "../ingestion/adapters/npnqm-portal.js";
import { writeExtrasFirstWriteWins } from "../ingestion/loan-context-extras.js";
import { IngestLoanRequestSchema, AdapterConfigSchema } from "@twin/core";
import { randomUUID } from "node:crypto";

// Boot-time adapter registration. Registry is process-global; safe across
// repeat module loads thanks to last-write-wins semantics in the registry.
registerAdapter(new GenericJsonAdapter());
registerAdapter(new EncompassLOSAdapter());
registerAdapter(new NPNQMPortalAdapter());

/**
 * Build a complete Loan object from partial ingested data.
 * Fills missing fields with sensible defaults so the loan renders in the UI.
 */
function buildLoanFromPartial(loanId: string, partial: Partial<Loan>, tenantId: string): Loan {
  const now = new Date().toISOString();
  const borrower = partial.borrower ?? { fullName: "Unknown Borrower", ssnMasked: "xxx-xx-0000", dob: "1990-01-01", maritalStatus: "Unmarried" as const };
  const loanAmount = partial.transaction?.loanAmount ?? 0;
  const appraisedValue = partial.transaction?.appraisedValue ?? loanAmount;
  const noteRate = partial.transaction?.noteRate ?? 7.0;
  const term = partial.transaction?.term ?? 360;
  const r = noteRate / 100 / 12;
  const n = term;
  const piPayment = loanAmount > 0 && r > 0 ? loanAmount * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : 0;
  const monthlyIncome = partial.income?.totalMonthlyIncome ?? 10000;
  const piti = partial.transaction?.piti ?? piPayment * 1.25;

  return {
    id: loanId,
    nqmProgram: partial.nqmProgram ?? "BankStatement12",
    qualifyingMethod: partial.qualifyingMethod ?? "BankStatementDeposits",
    borrower,
    property: partial.property ?? { street: "TBD", city: "TBD", state: "TX", zip: "00000", propertyType: "SFR Det.", units: 1, yearBuilt: 2000 },
    transaction: {
      loanPurpose: partial.transaction?.loanPurpose ?? "Purchase",
      loanAmount,
      salesPrice: partial.transaction?.salesPrice ?? loanAmount,
      appraisedValue,
      ltv: partial.transaction?.ltv ?? (appraisedValue > 0 ? Math.round(loanAmount / appraisedValue * 10000) / 100 : 0),
      cltv: partial.transaction?.cltv ?? partial.transaction?.ltv ?? 0,
      hcltv: partial.transaction?.hcltv ?? partial.transaction?.ltv ?? 0,
      noteRate,
      term,
      amortType: partial.transaction?.amortType ?? "Fixed",
      lienPosition: partial.transaction?.lienPosition ?? 1,
      occupancy: partial.transaction?.occupancy ?? "Primary",
      isInvestmentProperty: partial.transaction?.isInvestmentProperty ?? false,
      piti,
    },
    qualifying: partial.qualifying ?? {
      housingRatio: monthlyIncome > 0 ? Math.round(piti / monthlyIncome * 10000) / 100 : 0,
      totalDti: 0,
      piPayment: Math.round(piPayment * 100) / 100,
      qualifyingRate: noteRate,
    },
    qualifyingWorksheet: partial.qualifyingWorksheet ?? {
      method: "BankStatementDeposits",
      derivedMonthlyIncome: monthlyIncome,
    },
    income: partial.income ?? { totalMonthlyIncome: monthlyIncome },
    assets: partial.assets ?? { totalLiquid: 0, totalRetirement: 0, reservesMonths: 0 },
    credit: partial.credit ?? {
      repScore: null, tradelinesOpen: 0, tradelinesTotal: 0,
      tradelines: [],
      liabilities: { totalMonthlyPayments: 0, revolvingBalance: 0, installmentBalance: 0, mortgageBalance: 0, collectionsBalance: 0, totalBalance: 0 },
    },
    appraisal: partial.appraisal ?? {
      appraisalDate: now.slice(0, 10), appraiserName: "Pending", appraisalType: "Full",
      appraisedValue, marketCondition: "Stable", neighborhoodRating: "Average",
      siteArea: "N/A", grossLivingArea: 0, roomCount: 0, bedroomCount: 0, bathroomCount: 0,
      garageSpaces: 0, condition: "Average", comparables: [],
    },
    conditions: partial.conditions ?? [],
    documents: partial.documents ?? [],
    decision: partial.decision ?? "pending",
    milestones: [{ name: "Ingested", at: now, by: "api-ingest" }],
    compliance: partial.compliance ?? {
      qmStatus: "Non-QM", atrCompliant: true, hpml: false, hoepa: false,
      higherPricedCoveredTransaction: false, stateLicenseRequired: false,
      stateHighCostTest: "N/A", tridToleranceCure: "None",
      totalPointsAndFees: 0, pointsAndFeesThreshold: 0, pointsAndFeesPass: true, flags: [],
    },
    overlay: partial.overlay ?? {
      programName: partial.nqmProgram ?? "BankStatement12",
      investorName: "TBD", maxLTV: 80, minFICO: 620, maxDTI: 50,
      minDSCR: null, minReserves: 6, checks: [],
    },
    tenantId,
  };
}

export function registerIngestionRoutes(app: FastifyInstance, store: Store): void {
  app.post<{ Params: { tenantSlug: string } }>(
    "/api/ingest/:tenantSlug/loans",
    { preHandler: apiKeyAuthHook },
    async (req, reply) => {
      const tenantId = (req as unknown as { tenantId?: string }).tenantId;
      if (!tenantId) return reply.code(401).send({ error_class: "missing_tenant_context" });

      const parsed = IngestLoanRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error_class: "validation_failed", details: parsed.error.flatten() });
      }

      const { source, externalId, loanData } = parsed.data;
      const errorId = randomUUID();

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false, role: "operator" },
        async () => {
          // Idempotency check — explicit tenant_id filter (pooler-bypass-RLS).
          const existing = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ loan_id: string; status: string }>(
              `SELECT loan_id, status FROM ingested_loans
                WHERE tenant_id = $1 AND external_id = $2 LIMIT 1`,
              [tenantId, externalId],
            );
            return rows[0] ?? null;
          });
          if (existing) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }

          // Load mapping — explicit tenant filter (pooler-bypass-RLS).
          const mapping = await withTenantTx(tenantId, async (c) => {
            const { rows } = await c.query<{ adapter_type: string; adapter_config: unknown; field_map: unknown }>(
              `SELECT adapter_type, adapter_config, field_map FROM ingestion_mappings
                WHERE tenant_id = $1 AND source_name = $2 AND active = true LIMIT 1`,
              [tenantId, source],
            );
            return rows[0] ?? null;
          });

          const adapterType = mapping?.adapter_type ?? "generic-json";
          const adapter = getAdapter(adapterType);
          if (!adapter) {
            req.log?.error?.({ tenantId, adapterType, errorId }, "[ingest] unknown adapter_type");
            return reply.code(400).send({ error_id: errorId, error_class: "unknown_adapter_type" });
          }

          const config = AdapterConfigSchema.parse(mapping?.adapter_config ?? {});
          // Backwards compat: merge legacy field_map JSONB into fieldPathOverrides.
          // adapter_config.fieldPathOverrides wins on conflict.
          if (
            mapping?.field_map &&
            typeof mapping.field_map === "object" &&
            Object.keys(mapping.field_map as object).length > 0
          ) {
            config.fieldPathOverrides = {
              ...(mapping.field_map as Record<string, string>),
              ...(config.fieldPathOverrides ?? {}),
            };
          }

          let partialLoan: Partial<Loan>;
          try {
            partialLoan = adapter.transformLoan(loanData, config);
          } catch (e) {
            req.log?.error?.({ err: e, tenantId, adapterType, errorId }, "[ingest] transformLoan threw");
            return reply.code(500).send({ error_id: errorId, error_class: "transform_failed", adapter_type: adapterType });
          }

          const validation = adapter.validateLoan(partialLoan);
          if (!validation.valid) {
            return reply.code(400).send({
              error_id: errorId,
              error_class: "validation_failed",
              adapter_type: adapterType,
              details: validation.errors.map((code) => ({ code })),
            });
          }

          let externalLoanIdFromAdapter: string;
          try {
            externalLoanIdFromAdapter = adapter.extractExternalLoanId(loanData);
          } catch {
            externalLoanIdFromAdapter = externalId; // fall back to the request envelope
          }
          const loanId = `${config.identityPrefix}${externalLoanIdFromAdapter}`;
          const loan = buildLoanFromPartial(loanId, partialLoan, tenantId);

          store.dispatch({ type: "InjectLoan", loan });

          // F2-field closure (first-write-wins).
          try {
            const extras = adapter.deriveContextFields(loan, loanData, config);
            const cleaned = Object.fromEntries(
              Object.entries(extras).filter(([, v]) => v !== undefined),
            );
            if (Object.keys(cleaned).length > 0) {
              await writeExtrasFirstWriteWins(tenantId, loanId, cleaned as never);
            }
          } catch (e) {
            req.log?.warn?.({ err: e, tenantId, loanId }, "[ingest] deriveContextFields failed; continuing without extras");
          }

          // Record in ingested_loans for idempotency — explicit tenant_id filter.
          await withTenantTx(tenantId, async (c) => {
            await c.query(
              `INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, $2, $3, 'queued')`,
              [tenantId, externalId, loanId],
            );
          });

          // Per-ingest audit row — tenant_audit_log has no RLS, use withDb.
          await withDb(async (c) => {
            await c.query(
              `INSERT INTO tenant_audit_log (target_tenant_id, actor_id, action, reason, metadata)
               VALUES ($1, 'api-ingest', 'ingest.loan', $2, $3::jsonb)`,
              [tenantId, `loan ${loanId} ingested via ${adapterType}`,
               JSON.stringify({ adapter_type: adapterType, source_name: source, external_id: externalId, result: "success" })],
            );
          });

          // PC v2 auto-fire — best-effort. Context-builder is now async
          // (Task 10) and merges loan_context_extras populated by the adapter.
          try {
            const { run: runPredictions } = await import("../services/predict-conditions/index.js");
            const { buildLoanContextFromLoan } = await import("./predict-conditions-context-builder.js");
            const ctx = await buildLoanContextFromLoan(loan);
            await runPredictions(tenantId, loanId, ctx, "system:loan-ingest");
          } catch (err) {
            req.log?.error?.({ err, tenantId, loanId, errorId }, "[predict-conditions] auto-fire error");
          }

          return reply.code(201).send({ loanId, tenantId, status: "queued", estimatedProcessingMinutes: 15 });
        },
      );
    },
  );
}
