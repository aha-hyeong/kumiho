import { useEffect, useCallback, useState, useRef } from "react";
import { useSSE } from "./useSSE";
import { useTranslation } from "react-i18next";
import { progressAPI, viewerAPI } from "../api/client";

interface ViewerSyncProps {
  seriesId: string;
  chapterId?: string;
  currentPage: number;
}

export function useViewerSync({ seriesId, chapterId, currentPage }: ViewerSyncProps) {
  const { subscribe } = useSSE();
  const { t } = useTranslation();
  const [terminatedInfo, setTerminatedInfo] = useState<{ isOpen: boolean; reason: string }>({
    isOpen: false,
    reason: "",
  });
  const hasStarted = useRef(false);
  const isInitialMount = useRef(true);

  // 0. 뷰어 진입 시 다른 세션에 FORCE_LOGOUT 전송 (1회만, 재시도 포함)
  useEffect(() => {
    if (seriesId && chapterId && !hasStarted.current) {
      hasStarted.current = true;

      const startWithRetry = async (attempt: number) => {
        try {
          await viewerAPI.start({ series_id: seriesId, chapter_id: chapterId });
        } catch (err) {
          console.error(`[ViewerSync] Failed to notify viewer start (attempt ${attempt}):`, err);
          if (attempt < 3) {
            await startWithRetry(attempt + 1);
          }
        }
      };

      startWithRetry(1);
    }
  }, [seriesId, chapterId]);

  // 1. 강제 종료(FORCE_LOGOUT) 이벤트 구독
  useEffect(() => {
    const unsubscribe = subscribe("FORCE_LOGOUT", (payload) => {
      const data = payload as { reason?: string };

      // 기본 메시지 키 (알 수 없는 reason 포함)
      let messageKey = "viewer.session.force_logout_message";

      // reason 코드별로 다국어 메시지 사용
      if (data.reason === "DUPLICATE_LOGIN") {
        messageKey = "viewer.session.force_logout_message";
      } else if (data.reason === "CONNECTION_LIMIT") {
        messageKey = "viewer.session.connection_limit_message";
      }

      const message = t(messageKey);

      setTerminatedInfo({
        isOpen: true,
        reason: message,
      });
    });

    return () => {
      unsubscribe();
    };
  }, [subscribe, t]);

  // 2. 진행도 변경 시 서버에 전송 (REST API)
  // 초기 마운트 시에는 전송하지 않아 다른 기기의 더 높은 진행도를 덮어쓰는 것을 방지
  const updateProgress = useCallback(async () => {
    if (chapterId && seriesId) {
      try {
        await progressAPI.update({
          series_id: seriesId,
          chapter_id: chapterId,
          current_page: currentPage,
        });
      } catch (err) {
        console.error("[ViewerSync] Progress update failed:", err);
      }
    }
  }, [seriesId, chapterId, currentPage]);

  // 페이지가 바뀔 때마다 서버에 알림 (초기 마운트 제외)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    updateProgress();
  }, [currentPage, updateProgress]);

  return { terminatedInfo };
}
