import type { FastifyInstance } from "fastify";
import type { Loan, Store } from "@twin/core";
import { withTenantTx } from "../db/pool.js";
import { apiKeyAuthHook } from "../middleware/api-key-auth.js";
import { runInTenantContext } from "../tenant-context.js";
import { getTransformer, registerTransformer } from "../ingestion/transformer.js";
import { GenericJsonTransformer } from "../ingestion/generic-json.js";
import { IngestLoanRequestSchema } from "@twin/core";
import { randomUUID } from "node:crypto";

registerTransformer(new GenericJsonTransformer());

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
      if (!tenantId) return reply.code(401).send({ error: "missing tenant context" });
      const parsed = IngestLoanRequestSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { source, externalId, loanData } = parsed.data;

      return runInTenantContext(
        { tenantId, userId: "api-ingest", isSuperAdmin: false },
        async () => {
          // Idempotency check
          const existing = await withTenantTx(tenantId, async (client) => {
            const { rows } = await client.query<{ loan_id: string; status: string }>(
              "SELECT loan_id, status FROM ingested_loans WHERE external_id = $1", [externalId]
            );
            return rows[0] ?? null;
          });
          if (existing) {
            return reply.code(200).send({ loanId: existing.loan_id, tenantId, status: existing.status, duplicate: true });
          }

          // Load mapping + transform
          const mapping = await withTenantTx(tenantId, async (client) => {
            const { rows } = await client.query<{ transformer_type: string; field_map: Record<string, string> | null }>(
              "SELECT transformer_type, field_map FROM ingestion_mappings WHERE source_name = $1 AND active = true LIMIT 1", [source]
            );
            return rows[0] ?? null;
          });

          const transformer = getTransformer(mapping?.transformer_type ?? "generic-json");
          if (!transformer) return reply.code(400).send({ error: `Unknown transformer: ${mapping?.transformer_type}` });

          const fieldMap = mapping?.field_map ?? {};
          const partialLoan = Object.keys(fieldMap).length > 0
            ? transformer.transform(loanData, fieldMap)
            : (loanData as Partial<Loan>);
          const validation = transformer.validate(partialLoan);
          if (!validation.valid) return reply.code(400).send({ error: "Validation failed", details: validation.errors });

          const loanId = `QL-${externalId}`;

          // Build full Loan object and inject into store
          const loan = buildLoanFromPartial(loanId, partialLoan, tenantId);
          store.dispatch({ type: "InjectLoan", loan });

          // Record in ingested_loans for idempotency
          await withTenantTx(tenantId, async (client) => {
            await client.query(
              "INSERT INTO ingested_loans (tenant_id, external_id, loan_id, status) VALUES ($1, $2, $3, 'queued')",
              [tenantId, externalId, loanId]
            );
          });

          return reply.code(201).send({ loanId, tenantId, status: "queued", estimatedProcessingMinutes: 15 });
        }
      );
    }
  );
}
