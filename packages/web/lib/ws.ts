"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface StoreEvent {
  id: string;
  tenantId: string;
  loanId: string;
  type: string;
  payload: unknown;
  timestamp: string;
}

interface UseLiveUpdatesOptions {
  tenantId: string;
  loanId?: string;
  onEvent?: (event: StoreEvent) => void;
}

export function useLiveUpdates({ tenantId, loanId, onEvent }: UseLiveUpdatesOptions) {
  const router = useRouter();
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<StoreEvent | null>(null);
  const seenIds = useRef(new Set<string>());
  const reconnectTimeout = useRef<ReturnType<typeof setTimeout>>();
  const reconnectDelay = useRef(1000);

  const connect = useCallback(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:4000";
    const wsUrl = apiUrl.replace(/^http/, "ws") + `/ws/${tenantId}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        reconnectDelay.current = 1000;
        if (loanId) ws.send(JSON.stringify({ action: "subscribe", loanId }));
      };

      ws.onmessage = (msg) => {
        try {
          const event: StoreEvent = JSON.parse(msg.data);
          if (seenIds.current.has(event.id)) return;
          seenIds.current.add(event.id);
          if (seenIds.current.size > 1000) {
            const ids = Array.from(seenIds.current);
            seenIds.current = new Set(ids.slice(-500));
          }
          setLastEvent(event);
          onEvent?.(event);
          router.refresh();
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        reconnectTimeout.current = setTimeout(() => {
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30_000);
          connect();
        }, reconnectDelay.current);
      };

      ws.onerror = () => { ws.close(); };
    } catch { setConnected(false); }
  }, [tenantId, loanId, onEvent, router]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connect]);

  return { connected, lastEvent };
}
