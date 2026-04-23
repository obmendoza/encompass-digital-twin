import type { FastifyInstance } from "fastify";
import { withTenantTx } from "../db/pool.js";
import { getTenantId } from "../tenant-context.js";
import { GuidelineRulesSchema } from "@twin/core";
import { randomUUID } from "node:crypto";

export function registerGuidelineRoutes(app: FastifyInstance): void {
  app.get("/guidelines", async () => {
    const tenantId = getTenantId();
    return withTenantTx(tenantId, async (client) => {
      const { rows } = await client.query(
        "SELECT id, program, version, active, rules, created_at FROM tenant_guidelines ORDER BY program, version DESC"
      );
      return rows;
    });
  });

  app.get<{ Params: { program: string } }>("/guidelines/:program", async (req, reply) => {
    const tenantId = getTenantId();
    const { program } = req.params;
    return withTenantTx(tenantId, async (client) => {
      const { rows } = await client.query(
        "SELECT id, program, version, active, rules, created_at FROM tenant_guidelines WHERE program = $1 AND active = true ORDER BY version DESC LIMIT 1",
        [program]
      );
      if (rows.length === 0) return reply.code(404).send({ error: "No active guideline for program" });
      return rows[0];
    });
  });

  app.post<{ Params: { program: string } }>("/guidelines/:program", async (req, reply) => {
    const tenantId = getTenantId();
    const { program } = req.params;
    const parsed = GuidelineRulesSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    return withTenantTx(tenantId, async (client) => {
      const { rows: versionRows } = await client.query(
        "SELECT COALESCE(MAX(version), 0) AS max_ver FROM tenant_guidelines WHERE program = $1", [program]
      );
      const nextVersion = (versionRows[0].max_ver as number) + 1;
      await client.query("UPDATE tenant_guidelines SET active = false WHERE program = $1 AND active = true", [program]);
      const id = randomUUID();
      const { rows } = await client.query(
        `INSERT INTO tenant_guidelines (id, tenant_id, program, version, active, rules) VALUES ($1, $2, $3, $4, true, $5) RETURNING id, program, version, active, created_at`,
        [id, tenantId, program, nextVersion, JSON.stringify(parsed.data)]
      );
      return reply.code(201).send(rows[0]);
    });
  });

  app.get<{ Params: { program: string } }>("/guidelines/:program/history", async (req) => {
    const tenantId = getTenantId();
    const { program } = req.params;
    return withTenantTx(tenantId, async (client) => {
      const { rows } = await client.query(
        "SELECT id, version, active, created_at FROM tenant_guidelines WHERE program = $1 ORDER BY version DESC", [program]
      );
      return rows;
    });
  });
}
