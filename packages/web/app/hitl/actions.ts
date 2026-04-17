"use server";

import { revalidatePath } from "next/cache";

const AGENT_URL = process.env.AGENT_SERVICE_URL ?? "http://localhost:8000";

export interface HITLTicket {
  ticket_id: string;
  loan_id: string;
  program: string | null;
  reason: string;
  summary: string;
  fields: Record<string, unknown>;
  status: "pending" | "approved" | "rejected";
  approver: string | null;
  approver_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export async function fetchTickets(status?: string): Promise<HITLTicket[]> {
  try {
    const url = status
      ? `${AGENT_URL}/api/hitl/tickets?status=${status}`
      : `${AGENT_URL}/api/hitl/tickets`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    return await res.json();
  } catch {
    return [];
  }
}

export async function resolveTicket(
  ticketId: string,
  decision: "approve" | "reject",
  approver: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(`${AGENT_URL}/api/hitl/tickets/${ticketId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, approver, note }),
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: text.slice(0, 200) };
    }
    revalidatePath("/hitl", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
