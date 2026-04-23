import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { onEvent } from "../event-bus.js";
import type { StoreEvent } from "@twin/core";

interface ClientInfo {
  tenantId: string;
  socket: WebSocket;
  subscribedLoans: Set<string>;
}

const clients: Map<WebSocket, ClientInfo> = new Map();

function broadcastEvent(event: StoreEvent): void {
  for (const [, info] of clients) {
    if (info.tenantId !== event.tenantId) continue;
    if (info.subscribedLoans.size > 0 && event.loanId && !info.subscribedLoans.has(event.loanId)) continue;
    try {
      if (info.socket.readyState === info.socket.OPEN) info.socket.send(JSON.stringify(event));
    } catch { /* ignore */ }
  }
}

export function registerWsRoutes(app: FastifyInstance): void {
  app.register(websocket);
  onEvent(broadcastEvent);

  app.get<{ Params: { tenantId: string } }>("/ws/:tenantId", { websocket: true }, (socket, req) => {
    const tenantId = req.params.tenantId;
    const info: ClientInfo = { tenantId, socket, subscribedLoans: new Set() };
    clients.set(socket, info);

    const heartbeat = setInterval(() => {
      if (socket.readyState === socket.OPEN) socket.ping();
    }, 30_000);

    socket.on("message", (msg) => {
      try {
        const data = JSON.parse(msg.toString());
        if (data.action === "subscribe" && data.loanId) info.subscribedLoans.add(data.loanId);
        else if (data.action === "unsubscribe" && data.loanId) info.subscribedLoans.delete(data.loanId);
      } catch { /* ignore */ }
    });

    socket.on("close", () => { clearInterval(heartbeat); clients.delete(socket); });
    socket.on("error", () => { clearInterval(heartbeat); clients.delete(socket); });
  });
}

export function getWsClientCount(): number { return clients.size; }
