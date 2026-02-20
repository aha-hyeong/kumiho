import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";

interface SSEMessage {
  type: string;
  payload: unknown;
}

interface SSEOptions {
  source?: string;
}

// Global state for sharing a single EventSource connection across the app
let globalEventSource: EventSource | null = null;
let globalIsConnected = false;
const subscribers = new Map<string, Set<(payload: unknown) => void>>();
const eventCache = new Map<string, unknown>();
const connectionSubscribers = new Set<(connected: boolean) => void>();

function notifyConnectionChange(connected: boolean) {
  globalIsConnected = connected;
  connectionSubscribers.forEach((cb) => cb(connected));
}

/**
 * 로그아웃 시 SSE 연결을 즉시 종료하는 독립 함수.
 * React 컴포넌트 외부(예: authStore)에서도 호출 가능.
 */
export function disconnectSSE() {
  if (globalEventSource) {
    globalEventSource.close();
    globalEventSource = null;
    notifyConnectionChange(false);
  }
  eventCache.clear();
}

function processMessage(event: MessageEvent) {
  try {
    const data: SSEMessage = JSON.parse(event.data);
    const { type, payload } = data;

    eventCache.set(type, payload);

    const callbacks = subscribers.get(type);
    if (callbacks) {
      callbacks.forEach((cb) => cb(payload));
    }
  } catch (err) {
    console.error("[SSE] Failed to parse message:", err);
  }
}

export function useSSE(options?: SSEOptions) {
  const [isConnected, setIsConnected] = useState(globalIsConnected);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    // 1. connection status sync
    const connHandler = (status: boolean) => setIsConnected(status);
    connectionSubscribers.add(connHandler);

    // 2. logic for connecting / disconnecting
    if (!user) {
      if (globalEventSource) {
        globalEventSource.close();
        globalEventSource = null;
        notifyConnectionChange(false);
      }
    } else {
      if (!globalEventSource || globalEventSource.readyState === EventSource.CLOSED) {
        const params = new URLSearchParams();
        if (options?.source) {
          params.set("source", options.source);
        }

        const query = params.toString();
        const sseUrl = query ? `/api/v1/sse?${query}` : "/api/v1/sse";

        globalEventSource = new EventSource(sseUrl, { withCredentials: true });

        globalEventSource.onopen = () => {
          console.log("[SSE] Connected");
          notifyConnectionChange(true);
        };

        globalEventSource.onmessage = processMessage;

        globalEventSource.onerror = (error) => {
          console.error("[SSE] Connection error:", error);
          notifyConnectionChange(false);

          // Simple reconnection logic is typically handled by the browser automatically for standard errors.
          // If it completely fails, we can either let it retry or implement custom backoff.
          // EventSource usually auto-reconnects by default, as long as we don't call close() here.
        };
      }
    }

    return () => {
      connectionSubscribers.delete(connHandler);
    };
  }, [user]);

  // Subscribe function that mimics the old WebSocket interface
  const subscribe = useCallback((type: string, callback: (payload: unknown) => void) => {
    if (!subscribers.has(type)) {
      subscribers.set(type, new Set());
    }
    const set = subscribers.get(type)!;
    set.add(callback);

    // Call immediately with the latest cached payload if available
    if (eventCache.has(type)) {
      callback(eventCache.get(type));
    }

    // Provide an unsubscribe function
    return () => {
      set.delete(callback);
      if (set.size === 0) {
        subscribers.delete(type);
      }
    };
  }, []);

  return { isConnected, subscribe };
}
