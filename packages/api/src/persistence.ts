import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_TENANT_ID, type WorldState, type LoggedAction, type Loan } from "@twin/core";

let client: SupabaseClient | null = null;

export function isEnabled(): boolean {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

function getClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_KEY!,
    );
  }
  return client;
}

export async function initTables(): Promise<void> {
  if (!isEnabled()) {
    console.log("[persistence] Supabase not configured — using in-memory storage");
    return;
  }
  const db = getClient();

  try {
    const { error } = await db.from("world_state").select("id").limit(1);
    if (error && error.code === "42P01") {
      console.log("[persistence] Tables not found. Please create them via Supabase SQL editor.");
      console.log("[persistence] Run this SQL in your Supabase dashboard:");
      console.log(`
CREATE TABLE IF NOT EXISTS world_state (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  scenario_id TEXT,
  loans JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS action_log (
  seq SERIAL PRIMARY KEY,
  logged_at TIMESTAMPTZ NOT NULL,
  action JSONB NOT NULL
);

INSERT INTO world_state (id, loans) VALUES ('singleton', '{}') ON CONFLICT DO NOTHING;
      `);
    } else if (error) {
      console.error("[persistence] Supabase connectivity error:", error.message);
    } else {
      console.log("[persistence] Supabase connected, tables ready.");
    }
  } catch (e) {
    console.error("[persistence] Supabase connection failed:", e);
  }
}

export async function loadState(): Promise<{
  scenarioId: string | null;
  loans: Record<string, Loan>;
  actionLog: LoggedAction[];
} | null> {
  if (!isEnabled()) return null;
  const db = getClient();

  try {
    const { data: stateRow, error: stateErr } = await db
      .from("world_state")
      .select("scenario_id, loans")
      .eq("id", "singleton")
      .single();

    if (stateErr || !stateRow) return null;

    const { data: logRows } = await db
      .from("action_log")
      .select("seq, logged_at, action")
      .order("seq", { ascending: true });

    const actionLog: LoggedAction[] = (logRows ?? []).map((row) => ({
      seq: row.seq,
      at: row.logged_at,
      action: row.action,
    }));

    return {
      scenarioId: stateRow.scenario_id,
      loans: stateRow.loans as Record<string, Loan>,
      actionLog,
    };
  } catch (e) {
    console.error("[persistence] Failed to load state:", e);
    return null;
  }
}

export async function saveState(state: WorldState, tenantId: string = DEFAULT_TENANT_ID): Promise<void> {
  if (!isEnabled()) return;
  const db = getClient();

  try {
    await db.from("world_state").upsert({
      id: "singleton",
      tenant_id: tenantId,
      scenario_id: state.scenarioId,
      loans: state.loans,
      updated_at: new Date().toISOString(),
    });

    const lastSaved = (globalThis as Record<string, number>).__lastSavedSeq ?? 0;
    const newEntries = state.actionLog.filter((e) => e.seq > lastSaved);

    if (newEntries.length > 0) {
      await db.from("action_log").insert(
        newEntries.map((e) => ({
          seq: e.seq,
          tenant_id: tenantId,
          logged_at: e.at,
          action: e.action,
        })),
      );
      (globalThis as Record<string, number>).__lastSavedSeq =
        state.actionLog[state.actionLog.length - 1]?.seq ?? 0;
    }
  } catch (e) {
    console.error("[persistence] Failed to save state:", e);
  }
}

export async function clearState(): Promise<void> {
  if (!isEnabled()) return;
  const db = getClient();

  try {
    await db.from("world_state").upsert({
      id: "singleton",
      scenario_id: null,
      loans: {},
      updated_at: new Date().toISOString(),
    });
    await db.from("action_log").delete().gte("seq", 0);
    (globalThis as Record<string, number>).__lastSavedSeq = 0;
  } catch (e) {
    console.error("[persistence] Failed to clear state:", e);
  }
}
