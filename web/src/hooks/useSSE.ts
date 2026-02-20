import { useEffect, useRef, useState, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";

interface SSEMessage {
  type: string;
  payload: unknown;
}

interface SSEOptions {
  source?: string;
}

export function useSSE(options?: SSEOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  // Store subscribers
  const subscribersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    // If not logged in, do not connect
    if (!user) {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setIsConnected(false);
      }
      return;
    }

    // Optional: Avoid creating multiple connections.
    if (eventSourceRef.current && eventSourceRef.current.readyState === EventSource.OPEN) {
      return;
    }

    let sseUrl = "/api/v1/sse";
    if (options?.source) {
      sseUrl += `?source=${options.source}`;
    }

    const eventSource = new EventSource(sseUrl, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log("[SSE] Connected");
      setIsConnected(true);
    };

    eventSource.onmessage = (event) => {
      try {
        const data: SSEMessage = JSON.parse(event.data);
        const { type, payload } = data;

        // Dispatch to subscribers
        const callbacks = subscribersRef.current.get(type);
        if (callbacks) {
          callbacks.forEach((cb) => cb(payload));
        }
      } catch (err) {
        console.error("[SSE] Failed to parse message:", err);
      }
    };

    eventSource.onerror = (error) => {
      console.error("[SSE] Connection error:", error);
      setIsConnected(false);
      eventSource.close();

      // Simple reconnection logic could be handled by the browser automatically for standard errors
      // But if it completely fails, we can either let it retry or implement custom backoff.
      // EventSource usually auto-reconnects by default.
    };

    return () => {
      console.log("[SSE] Cleaning up connection");
      eventSource.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [user, options?.source]);

  // Subscribe function that mimics the old WebSocket interface
  const subscribe = useCallback((type: string, callback: (payload: unknown) => void) => {
    const map = subscribersRef.current;
    if (!map.has(type)) {
      map.set(type, new Set());
    }
    const set = map.get(type)!;
    set.add(callback);

    // Provide an unsubscribe function
    return () => {
      set.delete(callback);
      if (set.size === 0) {
        map.delete(type);
      }
    };
  }, []);

  return { isConnected, subscribe };
}
