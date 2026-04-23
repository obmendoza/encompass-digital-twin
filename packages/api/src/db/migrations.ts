import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { withDb } from "./pool.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  await withDb(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  });

  const applied = await withDb(async (client) => {
    const { rows } = await client.query("SELECT name FROM _migrations ORDER BY name");
    return new Set(rows.map((r: { name: string }) => r.name));
  });

  let files: string[];
  try {
    files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    console.log("[migrations] No migrations directory found — skipping");
    return;
  }

  for (const file of files) {
    if (applied.has(file)) continue;
    console.log(`[migrations] Applying ${file}...`);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    await withDb(async (client) => {
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        console.log(`[migrations] Applied ${file}`);
      } catch (e) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${e}`);
      }
    });
  }
}
