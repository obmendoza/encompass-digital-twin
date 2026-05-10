import { createHmac } from "node:crypto";
import { withDb } from "./db/pool.js";

const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000, 14_400_000];

function signPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export async function processWebhookDeliveries(): Promise<void> {
  await withDb(async (client) => {
    const { rows } = await client.query(
      `SELECT wd.id, wd.tenant_id, wd.webhook_id, wd.event_id, wd.event_type,
              wd.payload, wd.attempts, t.settings
       FROM webhook_deliveries wd JOIN tenants t ON t.id = wd.tenant_id
       WHERE wd.status IN ('pending', 'failed')
       AND (wd.next_retry_at IS NULL OR wd.next_retry_at <= NOW())
       ORDER BY wd.created_at LIMIT 50`
    );

    for (const row of rows) {
      const settings = row.settings as { webhooks?: Array<{ id: string; url: string; secret: string; active: boolean }> };
      const webhook = settings.webhooks?.find((w) => w.id === row.webhook_id);
      if (!webhook || !webhook.active) {
        await client.query("UPDATE webhook_deliveries SET status = 'dead', last_error = 'Webhook not found or inactive' WHERE id = $1", [row.id]);
        continue;
      }

      const body = JSON.stringify(row.payload);
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = signPayload(webhook.secret, timestamp, body);

      try {
        const res = await fetch(webhook.url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Webhook-Timestamp": String(timestamp) },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await client.query("UPDATE webhook_deliveries SET status = 'delivered', attempts = attempts + 1 WHERE id = $1", [row.id]);
        } else {
          await handleRetry(client, row.id, row.attempts, `HTTP ${res.status}`);
        }
      } catch (e) {
        await handleRetry(client, row.id, row.attempts, (e instanceof Error ? e.message : String(e)).slice(0, 500));
      }
    }
  });
}

async function handleRetry(client: import("pg").PoolClient, deliveryId: string, currentAttempts: number, error: string): Promise<void> {
  const nextAttempt = currentAttempts + 1;
  if (nextAttempt >= RETRY_DELAYS_MS.length) {
    await client.query("UPDATE webhook_deliveries SET status = 'dead', attempts = $1, last_error = $2 WHERE id = $3", [nextAttempt, error, deliveryId]);
  } else {
    const delay = RETRY_DELAYS_MS[nextAttempt]! + Math.random() * 10_000;
    const nextRetryAt = new Date(Date.now() + delay).toISOString();
    await client.query("UPDATE webhook_deliveries SET status = 'failed', attempts = $1, last_error = $2, next_retry_at = $3 WHERE id = $4", [nextAttempt, error, nextRetryAt, deliveryId]);
  }
}

export async function queueWebhookDelivery(tenantId: string, eventId: string, eventType: string, payload: Record<string, unknown>, webhookId: string): Promise<void> {
  await withDb(async (client) => {
    await client.query(
      `INSERT INTO webhook_deliveries (tenant_id, webhook_id, event_id, event_type, payload, status) VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [tenantId, webhookId, eventId, eventType, JSON.stringify(payload)]
    );
  });
}
