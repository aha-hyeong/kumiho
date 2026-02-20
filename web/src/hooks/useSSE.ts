import { useEffect, useState, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";

interface SSEMessage {
  type: string;
  payload: unknown;
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
  subscribers.clear();
}

function processMessage(event: MessageEvent) {
  try {
    const data: SSEMessage = JSON.parse(event.data);
    const { type, payload } = data;

    // FORCE_LOGOUT은 일회성 이벤트이므로 캐시하지 않음 (새 구독자에게 과거 이벤트 재전송 방지)
    if (type !== "FORCE_LOGOUT") {
      eventCache.set(type, payload);
    }

    const callbacks = subscribers.get(type);
    if (callbacks) {
      callbacks.forEach((cb) => cb(payload));
    }
  } catch (err) {
    console.error("[SSE] Failed to parse message:", err);
  }
}

export function useSSE() {
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
        // 글로벌 싱글톤이므로 source 쿼리 파라미터는 사용하지 않음
        // (백엔드 SSE Hub가 세션 기반으로 클라이언트를 관리)
        globalEventSource = new EventSource("/api/v1/sse", { withCredentials: true });

        globalEventSource.onopen = () => {
          console.log("[SSE] Connected");
          notifyConnectionChange(true);
        };

        globalEventSource.onmessage = processMessage;

        globalEventSource.onerror = (error) => {
          console.error("[SSE] Connection error:", error);
          notifyConnectionChange(false);
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
