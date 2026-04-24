import pg from "pg";
const { Pool } = pg;

let pool: InstanceType<typeof Pool> | null = null;

export function getPool(): InstanceType<typeof Pool> {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is required for multi-tenant mode");
    pool = new Pool({ connectionString: url, max: 20 });
  }
  return pool;
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Execute a function within a tenant-scoped transaction.
 * Sets app.current_tenant via SET LOCAL so RLS policies enforce isolation.
 * ALL tenant-scoped database access MUST go through this helper.
 */
export async function withTenantTx<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    // SET doesn't support parameterized queries — use escaped string literal
    // tenantId is always a UUID, validated upstream
    await client.query(`SET LOCAL app.current_tenant = '${tenantId.replace(/'/g, "''")}'`);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Execute a function outside tenant scope (for migrations, health checks, tenant listing).
 */
export async function withDb<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
