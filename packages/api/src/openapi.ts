export function buildOpenApiSpec() {
  return {
    openapi: "3.1.0",
    info: {
      title: "Encompass Digital Twin API",
      version: "0.1.0",
      description: "HTTP API for the NQM underwriting digital twin. Agents and humans share the same endpoints.",
    },
    servers: [{ url: "http://localhost:4000" }],
    paths: {
      "/health": {
        get: { summary: "Health check", responses: { "200": { description: "OK", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" } } } } } } } },
      },
      "/scenarios": {
        get: { summary: "List available NQM scenarios", responses: { "200": { description: "Array of scenario summaries" } } },
      },
      "/openapi.json": {
        get: { summary: "This OpenAPI spec", responses: { "200": { description: "OpenAPI 3.1 JSON" } } },
      },
      "/world/load-scenario": {
        post: {
          summary: "Load a scenario into the world state",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["scenarioId"], properties: { scenarioId: { type: "string" } } } } } },
          responses: { "200": { description: "Scenario loaded" }, "400": { description: "SCENARIO_NOT_FOUND" } },
        },
      },
      "/world/load-by-loan": {
        post: {
          summary: "Load the scenario containing a specific loan ID",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["loanId"], properties: { loanId: { type: "string" } } } } } },
          responses: { "200": { description: "Scenario loaded" }, "400": { description: "LOAN_NOT_FOUND" } },
        },
      },
      "/world/reset": {
        post: { summary: "Reset world state (clears all loans)", responses: { "200": { description: "World reset" } } },
      },
      "/loans": {
        get: { summary: "Pipeline — list all loans in current world state", responses: { "200": { description: "Array of pipeline summary rows" } } },
      },
      "/loans/{loanId}": {
        get: {
          summary: "Get full loan object",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Full Loan object" }, "400": { description: "LOAN_NOT_FOUND" } },
        },
      },
      "/loans/{loanId}/audit": {
        get: {
          summary: "Get action audit log",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of LoggedAction entries" } },
        },
      },
      "/loans/{loanId}/conditions": {
        get: {
          summary: "Get conditions for a loan",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of Condition objects" } },
        },
        post: {
          summary: "Add a condition",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["condition", "actor"], properties: {
            condition: { type: "object", required: ["category", "source", "description"], properties: {
              category: { type: "string", enum: ["PTA", "PTD", "PTF", "PTP"] },
              source: { type: "string", enum: ["UW", "AUS", "Compliance", "Investor"] },
              description: { type: "string" },
              status: { type: "string", enum: ["Open", "Requested", "Received", "Cleared", "Waived"] },
            } },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" }, "400": { description: "LOAN_NOT_FOUND or ACTION_FORBIDDEN_IN_DECISION_STATE" } },
        },
      },
      "/loans/{loanId}/conditions/{conditionId}": {
        patch: {
          summary: "Update a condition (partial)",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "conditionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["patch", "actor"], properties: {
            patch: { type: "object" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
        delete: {
          summary: "Remove a condition",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "conditionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["actor"], properties: {
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
      },
      "/loans/{loanId}/conditions/{conditionId}/clear": {
        post: {
          summary: "Clear a condition (transition to Cleared status)",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "conditionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["actor"], properties: {
            notes: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" }, "400": { description: "INVALID_TRANSITION" } },
        },
      },
      "/loans/{loanId}/conditions/{conditionId}/waive": {
        post: {
          summary: "Waive a condition (requires rationale)",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "conditionId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["rationale", "actor"], properties: {
            rationale: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" }, "400": { description: "REQUIRED_FIELD_MISSING" } },
        },
      },
      "/loans/{loanId}/decision": {
        post: {
          summary: "Set underwriting decision (approve/suspend/counter/deny)",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["decision", "rationale", "actor"], properties: {
            decision: { type: "string", enum: ["pending", "approved", "suspended", "counter", "denied"] },
            rationale: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan with new decision" } },
        },
      },
      "/loans/{loanId}/milestone": {
        post: {
          summary: "Advance a milestone",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["milestone", "actor"], properties: {
            milestone: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
      },
      "/loans/{loanId}/qualifying-income": {
        post: {
          summary: "Recalculate qualifying income from a worksheet",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["worksheet", "actor"], properties: {
            worksheet: { type: "object", required: ["method", "derivedMonthlyIncome"], properties: {
              method: { type: "string", enum: ["BankStatementDeposits", "DSCRCoverage", "AssetDepletionMonths", "1099Gross", "PnLCPACertified", "TraditionalDocs"] },
              derivedMonthlyIncome: { type: "number" },
              monthsCovered: { type: "number" }, avgDeposits: { type: "number" }, expenseFactor: { type: "number" },
              nsfCount: { type: "number" }, dscrNumerator: { type: "number" }, dscrDenominator: { type: "number" },
              totalAssets: { type: "number" }, depletionMonths: { type: "number" }, gross1099: { type: "number" },
              cpaCertifiedNetIncome: { type: "number" },
            } },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan with recalculated ratios" }, "400": { description: "INVALID_TRANSITION if derivedMonthlyIncome <= 0" } },
        },
      },
      "/loans/{loanId}/documents": {
        get: {
          summary: "Get documents for a loan",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Array of Document objects" } },
        },
        post: {
          summary: "Add a document",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["doc", "actor"], properties: {
            doc: { type: "object", required: ["name", "docType"], properties: {
              name: { type: "string" },
              docType: { type: "string", enum: ["BankStatement", "TaxReturn", "PayStub", "1099", "PnL", "CPA_Letter", "ID", "Insurance", "Appraisal", "Title", "LeaseAgreement", "LOX", "BKDocs", "CreditReport", "Other"] },
            } },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
      },
      "/loans/{loanId}/documents/{docId}": {
        patch: {
          summary: "Update document status or link to condition",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "docId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["actor"], properties: {
            status: { type: "string", enum: ["Pending", "Received", "Reviewed", "Rejected"] },
            linkedConditionId: { type: "string" },
            notes: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
      },
      "/loans/{loanId}/agent-step": {
        post: {
          summary: "Record an agent reasoning step (no loan mutation, audit-log only)",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["step", "actor"], properties: {
            step: { type: "object", required: ["phase", "content", "at"], properties: {
              phase: { type: "string", enum: ["thinking", "tool_call", "tool_result", "message", "decision"] },
              content: { type: "string" },
              metadata: { type: "object" },
              at: { type: "string" },
            } },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "{ ok: true }" }, "400": { description: "LOAN_NOT_FOUND" } },
        },
      },
      "/loans/{loanId}/recommendation": {
        post: {
          summary: "Stage a pending recommendation from the agent",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["recommendation", "actor"], properties: {
            recommendation: { type: "object", required: ["recommendation", "rationale", "confidence", "conditions", "trace"], properties: {
              recommendation: { type: "string", enum: ["pending", "approved", "suspended", "counter", "denied"] },
              rationale: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              conditions: { type: "array", items: { type: "string" } },
              trace: { type: "array", items: { type: "object" } },
            } },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan with pendingRecommendation set" }, "400": { description: "LOAN_NOT_FOUND" } },
        },
        delete: {
          summary: "Clear pending recommendation without applying it",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["actor"], properties: {
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan with pendingRecommendation cleared" }, "400": { description: "INVALID_TRANSITION if no pending recommendation" } },
        },
      },
      "/loans/{loanId}/recommendation/accept": {
        post: {
          summary: "Accept staged recommendation — converts it to the loan decision",
          parameters: [{ name: "loanId", in: "path", required: true, schema: { type: "string" } }],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["actor"], properties: {
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan with decision set and pendingRecommendation cleared" }, "400": { description: "INVALID_TRANSITION if no pending recommendation" } },
        },
      },
      "/loans/{loanId}/documents/{docId}/link": {
        post: {
          summary: "Link a document to a condition",
          parameters: [
            { name: "loanId", in: "path", required: true, schema: { type: "string" } },
            { name: "docId", in: "path", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["conditionId", "actor"], properties: {
            conditionId: { type: "string" },
            actor: { type: "object", required: ["kind", "id"], properties: { kind: { type: "string", enum: ["human", "agent"] }, id: { type: "string" } } },
          } } } } },
          responses: { "200": { description: "Updated loan" } },
        },
      },
    },
  };
}
