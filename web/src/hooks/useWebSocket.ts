import { useEffect, useRef, useCallback, useState } from "react";

export interface WSMessage {
  type: string;
  payload?: unknown;
}

export function useWebSocket() {
  const [isConnected, setIsConnected] = useState(false);
  const [reconnectTrigger, setReconnectTrigger] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const messageHandlersRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());

  const connect = useCallback(() => {
    if (socketRef.current?.readyState === WebSocket.OPEN || socketRef.current?.readyState === WebSocket.CONNECTING)
      return;

    // 현재 호스트 정보를 기반으로 웹소켓 URL 생성
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.host;
    // API v1 경로에 맞춰 설정
    const wsUrl = `${protocol}//${host}/api/v1/ws`;

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
  }, []);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimeoutRef.current) window.clearTimeout(reconnectTimeoutRef.current);
      socketRef.current?.close();
    };
  }, [connect]);

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
