import { randomUUID } from "node:crypto";
import type { StoreEvent, Action } from "@twin/core";
import { isRedisEnabled, getRedisPub, getRedisSub } from "./redis.js";

type EventHandler = (event: StoreEvent) => void;
const handlers: EventHandler[] = [];

function actionToEventType(actionType: string): string | null {
  const map: Record<string, string> = {
    RecordAgentStep: "agent.step",
    SetDecision: "decision.made",
    AcceptRecommendation: "decision.made",
    OverrideDecision: "decision.made",
    StageRecommendation: "recommendation.staged",
    AddCondition: "condition.changed",
    ClearCondition: "condition.changed",
    WaiveCondition: "condition.changed",
    RemoveCondition: "condition.changed",
    AddDocument: "document.updated",
    UpdateDocumentStatus: "document.updated",
    AssignLoan: "assignment.changed",
    UpdateAssignmentStatus: "assignment.changed",
    UnassignLoan: "assignment.changed",
  };
  return map[actionType] ?? null;
}

export async function publishAction(tenantId: string, action: Action): Promise<void> {
  const eventType = actionToEventType(action.type);
  if (!eventType) return;
  const loanId = "loanId" in action ? (action as { loanId: string }).loanId : "";
  const event: StoreEvent = {
    id: randomUUID(),
    tenantId,
    loanId,
    type: eventType,
    payload: { actionType: action.type },
    timestamp: new Date().toISOString(),
  };
  if (isRedisEnabled()) {
    await getRedisPub().publish(`tenant:${tenantId}:events`, JSON.stringify(event));
  }
  for (const handler of handlers) {
    try { handler(event); } catch { /* ignore */ }
  }
}

export async function publishEvent(event: StoreEvent): Promise<void> {
  if (isRedisEnabled()) {
    await getRedisPub().publish(`tenant:${event.tenantId}:events`, JSON.stringify(event));
  }
  for (const handler of handlers) {
    try { handler(event); } catch { /* ignore */ }
  }
}

export function onEvent(handler: EventHandler): () => void {
  handlers.push(handler);
  return () => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  };
}

export async function subscribeToRedisEvents(): Promise<void> {
  if (!isRedisEnabled()) return;
  const redisSub = getRedisSub();
  redisSub.on("message", (_channel: string, message: string) => {
    try {
      const event: StoreEvent = JSON.parse(message);
      for (const handler of handlers) {
        try { handler(event); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  });
  await redisSub.psubscribe("tenant:*:events");
  console.log("[event-bus] Subscribed to Redis tenant events");
}
