import { useEffect, useRef, useState, useCallback } from "react";
import { statsAPI } from "../api/client";

const IDLE_TIMEOUT_MS = 60 * 1000; // 60초
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30초마다 서버 전송

/**
 * 사용자의 읽기 시간을 측정하여 주기적으로 서버에 전송하는 훅
 * @param seriesId 측정할 시리즈 ID (없으면 측정 안 함)
 * @param isActive 뷰어가 활성화 상태인지 여부 (탭 비활성화 등 외부 요인)
 */
export function useReadingTime(seriesId?: string, isActive: boolean = true) {
  const [isIdle, setIsIdle] = useState(false);
  const [startTime] = useState(() => Date.now());
  const lastActivityTime = useRef<number>(startTime);
  const accumulatedSeconds = useRef<number>(0);
  const idleTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);

  // 활동 감지 핸들러
  const handleActivity = useCallback(() => {
    lastActivityTime.current = Date.now();
    setIsIdle((prev) => (prev ? false : prev));
  }, []);

  // 1. 활동 모니터링 등록 (마우스, 터치, 스크롤, 키보드)
  const lastThrottleTime = useRef<number>(0);
  useEffect(() => {
    if (!seriesId || !isActive) return;

    const events = ["mousedown", "mousemove", "keydown", "scroll", "touchstart"];

    const throttledHandler = () => {
      const now = Date.now();
      if (now - lastThrottleTime.current > 1000) {
        lastThrottleTime.current = now;
        handleActivity();
      }
    };

    events.forEach((event) => window.addEventListener(event, throttledHandler));
    return () => {
      events.forEach((event) => window.removeEventListener(event, throttledHandler));
    };
  }, [seriesId, isActive, handleActivity]);

  // 2. Idle 상태 체크 (1초마다 체크)
  useEffect(() => {
    if (!seriesId || !isActive) return;

    const checkIdle = setInterval(() => {
      const now = Date.now();
      const timeSinceLastActivity = now - lastActivityTime.current;

      if (timeSinceLastActivity > IDLE_TIMEOUT_MS) {
        if (!isIdle) setIsIdle(true);
      } else {
        // Idle이 아니면 시간 누적
        accumulatedSeconds.current += 1;
      }
    }, 1000);

    idleTimerRef.current = checkIdle as unknown as number;

    return () => {
      if (idleTimerRef.current) clearInterval(idleTimerRef.current);
    };
  }, [seriesId, isActive, isIdle]);

  // 3. Heartbeat (서버 전송)
  const sendHeartbeat = useCallback(async () => {
    const secondsToSend = accumulatedSeconds.current;
    if (secondsToSend > 0) {
      // 읽기와 초기화를 동기적으로 처리하여 누적 시간 손실 방지
      accumulatedSeconds.current = 0;
      try {
        await statsAPI.heartbeat(seriesId!, secondsToSend);
      } catch (error) {
        console.error("Failed to send reading time heartbeat:", error);
        // 실패 시 이전에 전송하려던 값을 다시 누적하여 다음 주기에 합산해서 재시도
        accumulatedSeconds.current += secondsToSend;
      }
    }
  }, [seriesId]);

  useEffect(() => {
    if (!seriesId) return;

    const interval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    heartbeatTimerRef.current = interval as unknown as number;

    // 페이지 이탈/종료 시 마지막 하트비트 시도 (pagehide가 beforeunload보다 모바일에서 안정적)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        void sendHeartbeat();
      }
    };

    window.addEventListener("pagehide", sendHeartbeat);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (heartbeatTimerRef.current) clearInterval(heartbeatTimerRef.current);
      window.removeEventListener("pagehide", sendHeartbeat);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // 언마운트 시점에 남은 시간 전송 시도
      void sendHeartbeat();
    };
  }, [seriesId, sendHeartbeat]);

  return { isIdle };
}
