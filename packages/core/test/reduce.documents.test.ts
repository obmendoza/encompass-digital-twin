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
    conditions: [
      { id: "c1", category: "PTD", source: "UW", description: "Test Condition",
        status: "Open", addedBy: "system", addedAt: "2026-04-08T09:00:00.000Z" },
    ],
    documents: [],
    decision: "pending",
    milestones: [],
  };
}

function preload(): WorldState {
  const sc: Record<string, Scenario> = { s: { id: "s", name: "s", description: "", loan: loan() } };
  return reduce({ scenarioId: null, loans: {}, actionLog: [], now },
    { type: "LoadScenario", scenarioId: "s" }, (k) => sc[k]);
}

describe("reduce — documents", () => {
  it("AddDocument appends a Pending doc with auto id", () => {
    const s = preload();
    const next = reduce(s, {
      type: "AddDocument", loanId: "2501000001",
      doc: { name: "W2.pdf", docType: "PayStub" }, actor,
    }, () => undefined);
    const docs = next.loans["2501000001"]!.documents;
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toMatch(/^d\d+$/);
    expect(docs[0]!.name).toBe("W2.pdf");
    expect(docs[0]!.docType).toBe("PayStub");
    expect(docs[0]!.status).toBe("Pending");
    expect(docs[0]!.uploadedBy).toBe("uw1");
  });

  it("LinkDocument links doc to condition", () => {
    const s1 = reduce(preload(), {
      type: "AddDocument", loanId: "2501000001",
      doc: { name: "Bank.pdf", docType: "BankStatement" }, actor,
    }, () => undefined);
    const docId = s1.loans["2501000001"]!.documents[0]!.id;
    const s2 = reduce(s1, {
      type: "LinkDocument", loanId: "2501000001",
      documentId: docId, conditionId: "c1", actor,
    }, () => undefined);
    expect(s2.loans["2501000001"]!.documents[0]!.linkedConditionId).toBe("c1");
  });

  it("LinkDocument with bad docId throws DOCUMENT_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, {
      type: "LinkDocument", loanId: "2501000001",
      documentId: "dXXX", conditionId: "c1", actor,
    }, () => undefined)).toThrow(ActionError);
    expect(() => reduce(s, {
      type: "LinkDocument", loanId: "2501000001",
      documentId: "dXXX", conditionId: "c1", actor,
    }, () => undefined)).toThrow(expect.objectContaining({ code: "DOCUMENT_NOT_FOUND" }));
  });

  it("LinkDocument with bad conditionId throws CONDITION_NOT_FOUND", () => {
    const s1 = reduce(preload(), {
      type: "AddDocument", loanId: "2501000001",
      doc: { name: "Appraisal.pdf", docType: "Appraisal" }, actor,
    }, () => undefined);
    const docId = s1.loans["2501000001"]!.documents[0]!.id;
    expect(() => reduce(s1, {
      type: "LinkDocument", loanId: "2501000001",
      documentId: docId, conditionId: "cXXX", actor,
    }, () => undefined)).toThrow(expect.objectContaining({ code: "CONDITION_NOT_FOUND" }));
  });

  it("UpdateDocumentStatus changes status", () => {
    const s1 = reduce(preload(), {
      type: "AddDocument", loanId: "2501000001",
      doc: { name: "ID.pdf", docType: "ID" }, actor,
    }, () => undefined);
    const docId = s1.loans["2501000001"]!.documents[0]!.id;
    const s2 = reduce(s1, {
      type: "UpdateDocumentStatus", loanId: "2501000001",
      documentId: docId, status: "Received", notes: "looks good", actor,
    }, () => undefined);
    const doc = s2.loans["2501000001"]!.documents[0]!;
    expect(doc.status).toBe("Received");
    expect(doc.notes).toBe("looks good");
  });

  it("UpdateDocumentStatus with bad docId throws DOCUMENT_NOT_FOUND", () => {
    const s = preload();
    expect(() => reduce(s, {
      type: "UpdateDocumentStatus", loanId: "2501000001",
      documentId: "dXXX", status: "Received", actor,
    }, () => undefined)).toThrow(expect.objectContaining({ code: "DOCUMENT_NOT_FOUND" }));
  });
});
