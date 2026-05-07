// scripts/e2e-harness/workflows/W4-efolder-idp-push.ts
import { ACTORS, http, type HttpOptions } from "../http.js";
import type { AssertionResult, CellResult, FixtureMeta, WorkflowDef } from "../types.js";

export const W4: WorkflowDef = {
  id: "W4_efolder_idp_push",
  name: "eFolder → IDP → Stare & Compare → Push",
  specRefs: ["slice-5-efolder", "slice-4-income"],
  appliesTo: (f) => f.program !== "ForeignNational",
  run: async (fixture, ctx) => {
    const start = Date.now();
    const apiOpts: HttpOptions = { baseUrl: ctx.apiUrl };
    const agentOpts: HttpOptions = { baseUrl: ctx.agentUrl, timeoutMs: 600_000 };
    const assertions: AssertionResult[] = [];

    await http.post(apiOpts, "/world/reset");
    await http.post(apiOpts, "/world/load-scenario", { scenarioId: fixture.id });

    // Generate sample docs (writes uploaded files into the loan's eFolder).
    type GenResp = { documentsGenerated?: number };
    const gen = await http.post<GenResp>(agentOpts, `/api/workshop/generate-docs/${fixture.loanId}`);
    assertions.push({ name: "docs_generated", expected: ">0", actual: gen.documentsGenerated ?? 0, ok: (gen.documentsGenerated ?? 0) > 0 });

    type Doc = { id: string; docType: string; fileKey?: string; extractedData?: Record<string, unknown> };
    type Loan = { qualifyingWorksheet?: Record<string, unknown>; documents?: Doc[] };
    const loan = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const bankDoc = (loan.documents ?? []).find((d) => d.docType === "BankStatement" && d.fileKey);
    assertions.push({ name: "bank_doc_present", expected: "BankStatement w/ fileKey", actual: bankDoc?.id ?? null, ok: !!bankDoc });
    if (!bankDoc) return cell(fixture, start, "fail", "P1", assertions, {}, null, null);

    // Run IDP.
    type IdpResp = { extracted?: Record<string, unknown> };
    const idp = await http.post<IdpResp>(agentOpts, `/api/idp/extract-from-twin/${fixture.loanId}/${bankDoc.id}`);
    assertions.push({ name: "idp_returned_extracted", expected: "object", actual: idp.extracted ? "object" : null, ok: !!idp.extracted });

    // Re-fetch to confirm extractedData persisted on the doc.
    const loanAfter = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const docAfter = (loanAfter.documents ?? []).find((d) => d.id === bankDoc.id);
    const extracted = docAfter?.extractedData ?? {};
    assertions.push({ name: "extractedData_persisted", expected: "non-empty", actual: Object.keys(extracted).length, ok: Object.keys(extracted).length > 0 });

    // Push the total_deposits field into avgDeposits via /qualifying-income.
    const totalDeposits = Number((extracted as Record<string, unknown>).total_deposits ?? 0);
    if (!isFinite(totalDeposits) || totalDeposits <= 0) {
      assertions.push({ name: "extracted_total_deposits_numeric", expected: ">0", actual: totalDeposits, ok: false });
      return cell(fixture, start, "fail", "P1", assertions, { extractedKeys: Object.keys(extracted) }, null, null);
    }

    type WorksheetEnvelope = { worksheet?: Record<string, unknown> };
    const ws = (loanAfter.qualifyingWorksheet ?? {}) as Record<string, unknown>;
    const ef = typeof ws.expenseFactor === "number" ? ws.expenseFactor : 0.5;
    const newWorksheet = { ...ws, avgDeposits: totalDeposits, derivedMonthlyIncome: totalDeposits * (1 - ef) };
    await http.post<WorksheetEnvelope>(apiOpts, `/loans/${fixture.loanId}/qualifying-income`, { worksheet: newWorksheet, actor: ACTORS.human });

    const finalLoan = await http.get<Loan>(apiOpts, `/loans/${fixture.loanId}`);
    const wsFinal = (finalLoan.qualifyingWorksheet ?? {}) as Record<string, unknown>;
    // AC1 marker: this is the assertion that tests the original audit claim that "Push-to-Loan reads but doesn't write."
    assertions.push({ name: "worksheet_avgDeposits_updated", expected: totalDeposits, actual: wsFinal.avgDeposits, ok: wsFinal.avgDeposits === totalDeposits, auditClaim: "AC1" });

    const allOk = assertions.every((a) => a.ok);
    const severity = allOk ? null : (assertions.find((a) => !a.ok && (a.name === "extractedData_persisted" || a.name === "worksheet_avgDeposits_updated")) ? "P0" : "P1");
    return cell(fixture, start, allOk ? "pass" : "fail", severity, assertions, { extractedKeys: Object.keys(extracted) }, null, null);
  },
};

function cell(fixture: FixtureMeta, start: number, status: "pass" | "fail", severity: "P0" | "P1" | "P2" | null, assertions: AssertionResult[], evidence: Record<string, unknown>, errCode: string | null, errMsg: string | null): CellResult {
  return { loanId: fixture.loanId, fixture: fixture.id, workflow: "W4_efolder_idp_push", status, severity, durationMs: Date.now() - start, assertions, evidence, error: errCode ? { code: errCode, message: errMsg ?? "" } : null };
}
