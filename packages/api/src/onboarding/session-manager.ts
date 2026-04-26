import { withDb } from "../db/pool.js";
import type { OnboardingSession } from "@twin/core";

/**
 * Create a new onboarding session for a tenant.
 * Returns the session id and initial version.
 */
export async function createOnboardingSession(
  tenantId: string,
  startedBy?: string,
): Promise<{ id: string; version: number }> {
  return withDb(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    try {
      const { rows } = await client.query(
        `INSERT INTO onboarding_sessions (tenant_id, started_by)
         VALUES ($1, $2)
         RETURNING id, version`,
        [tenantId, startedBy ?? null],
      );
      await client.query("COMMIT");
      return { id: rows[0].id, version: rows[0].version };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * Get the latest non-completed onboarding session for a tenant.
 */
export async function getOnboardingSession(
  tenantId: string,
): Promise<OnboardingSession | null> {
  return withDb(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    try {
      const { rows } = await client.query(
        `SELECT id, tenant_id, current_step, step_data, uploaded_documents,
                extraction_results, checklist_results, notes, version,
                started_by, started_at, updated_at, completed_at, abandoned_at
         FROM onboarding_sessions
         WHERE tenant_id = $1 AND completed_at IS NULL AND abandoned_at IS NULL
         ORDER BY started_at DESC
         LIMIT 1`,
        [tenantId],
      );
      await client.query("COMMIT");
      if (rows.length === 0) return null;
      const r = rows[0];
      return {
        id: r.id,
        tenantId: r.tenant_id,
        currentStep: r.current_step,
        stepData: r.step_data,
        uploadedDocuments: r.uploaded_documents,
        extractionResults: r.extraction_results,
        checklistResults: r.checklist_results,
        notes: r.notes ?? undefined,
        version: r.version,
        startedBy: r.started_by ?? undefined,
        startedAt: r.started_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        completedAt: r.completed_at?.toISOString() ?? undefined,
        abandonedAt: r.abandoned_at?.toISOString() ?? undefined,
      };
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * Update an onboarding session with optimistic concurrency control.
 * Returns the new version number, or null if the expected version didn't match.
 */
export async function updateOnboardingSession(
  tenantId: string,
  expectedVersion: number,
  updates: {
    currentStep?: number;
    stepData?: Record<string, unknown>;
    uploadedDocuments?: unknown[];
    extractionResults?: Record<string, unknown>;
    checklistResults?: Record<string, unknown>;
    notes?: string;
  },
): Promise<number | null> {
  return withDb(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    try {
      const setClauses: string[] = ["version = version + 1", "updated_at = NOW()"];
      const values: unknown[] = [];
      let paramIdx = 1;

      if (updates.currentStep !== undefined) {
        setClauses.push(`current_step = $${paramIdx++}`);
        values.push(updates.currentStep);
      }
      if (updates.stepData !== undefined) {
        setClauses.push(`step_data = $${paramIdx++}`);
        values.push(JSON.stringify(updates.stepData));
      }
      if (updates.uploadedDocuments !== undefined) {
        setClauses.push(`uploaded_documents = $${paramIdx++}`);
        values.push(JSON.stringify(updates.uploadedDocuments));
      }
      if (updates.extractionResults !== undefined) {
        setClauses.push(`extraction_results = $${paramIdx++}`);
        values.push(JSON.stringify(updates.extractionResults));
      }
      if (updates.checklistResults !== undefined) {
        setClauses.push(`checklist_results = $${paramIdx++}`);
        values.push(JSON.stringify(updates.checklistResults));
      }
      if (updates.notes !== undefined) {
        setClauses.push(`notes = $${paramIdx++}`);
        values.push(updates.notes);
      }

      values.push(tenantId, expectedVersion);

      const { rowCount } = await client.query(
        `UPDATE onboarding_sessions
         SET ${setClauses.join(", ")}
         WHERE tenant_id = $${paramIdx++}
           AND version = $${paramIdx++}
           AND completed_at IS NULL
           AND abandoned_at IS NULL`,
        values,
      );

      if (rowCount === 0) {
        await client.query("ROLLBACK");
        return null;
      }

      // Read new version
      const { rows } = await client.query(
        `SELECT version FROM onboarding_sessions
         WHERE tenant_id = $1 AND completed_at IS NULL AND abandoned_at IS NULL
         ORDER BY started_at DESC LIMIT 1`,
        [tenantId],
      );
      await client.query("COMMIT");
      return rows[0]?.version ?? null;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}

/**
 * Mark the onboarding session as completed.
 */
export async function completeOnboardingSession(
  tenantId: string,
): Promise<void> {
  return withDb(async (client) => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    try {
      await client.query(
        `UPDATE onboarding_sessions
         SET completed_at = NOW(), updated_at = NOW()
         WHERE tenant_id = $1
           AND completed_at IS NULL
           AND abandoned_at IS NULL`,
        [tenantId],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}
