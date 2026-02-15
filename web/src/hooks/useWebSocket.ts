import { useEffect, useRef, useCallback, useState, useMemo } from "react";

export interface WSMessage {
  type: string;
  payload?: unknown;
}

export function useWebSocket(queryParams?: Record<string, string>) {
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const messageHandlersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());

  // queryParams가 변경되는지 감시 (객체 참조 대신 문자열로 비교하여 안정적인 참조 유지)
  const queryParamsStr = JSON.stringify(queryParams);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableParams = useMemo(() => queryParams, [queryParamsStr]);

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING)
      return;

    // 현재 호스트 정보를 기반으로 웹소켓 URL 생성
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    let wsUrl = `${protocol}//${host}/api/v1/ws`;

    // 쿼리 파라미터 추가
    if (stableParams) {
      const params = new URLSearchParams(stableParams);
      wsUrl += `?${params.toString()}`;
    }

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected");
      setIsConnected(true);
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };

    socket.onmessage = (event) => {
      try {
        const message: WSMessage = JSON.parse(event.data);
        console.log(`[WS] Received message: ${message.type}`, message.payload);
        const handlers = messageHandlersRef.current.get(message.type);
        if (handlers) {
          handlers.forEach((handler) => handler(message.payload));
        }
      } catch (err) {
        console.error("Failed to parse WebSocket message:", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected");
      setIsConnected(false);
      socketRef.current = null;
      // 재연결 트리거
      setReconnectTrigger((prev) => prev + 1);
    };

    socket.onerror = (err) => {
      console.error("WebSocket error:", err);
      socket.close();
    };
  }, [stableParams]); // stableParams가 바뀌면 새로운 connect 함수 생성

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      socketRef.current?.close();
    };
  }, [connect]); // connect가 바뀌면(즉 queryParamsStr이 바뀌면) 재연결

  // 재연결 로직을 별도 효과로 분리하여 순환 참조 해결
  useEffect(() => {
    if (reconnectTrigger > 0 && !isConnected) {
      reconnectTimeoutRef.current = window.setTimeout(() => {
        connect();
      }, 5000);
      return () => {
        if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      };
    }
  }, [reconnectTrigger, isConnected, connect]);

  const sendMessage = useCallback((type: string, payload?: unknown) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type, payload }));
      return true;
    }
    return false;
  }, []);

  const subscribe = useCallback((type: string, handler: (payload: unknown) => void) => {
    if (!messageHandlersRef.current.has(type)) {
      messageHandlersRef.current.set(type, new Set());
    }
    messageHandlersRef.current.get(type)!.add(handler);

    return () => {
      const handlers = messageHandlersRef.current.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          messageHandlersRef.current.delete(type);
        }
      }
    };
  }, []);

  return { isConnected, sendMessage, subscribe };
}
