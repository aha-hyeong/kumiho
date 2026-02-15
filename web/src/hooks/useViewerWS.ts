import { useEffect, useCallback, useState } from "react";
import { useWebSocket } from "./useWebSocket";
import { useTranslation } from "react-i18next";

interface ViewerWSProps {
  seriesId: string;
  chapterId?: string;
  currentPage: number;
}

export function useViewerWS({ seriesId, chapterId, currentPage }: ViewerWSProps) {
  const { sendMessage, subscribe, isConnected } = useWebSocket();
  const { t } = useTranslation();
  const [terminatedInfo, setTerminatedInfo] = useState<{ isOpen: boolean; reason: string }>({
    isOpen: false,
    reason: "",
  });

  // 1. 강제 종료(FORCE_LOGOUT) 이벤트 구독
  useEffect(() => {
    const unsubscribe = subscribe("FORCE_LOGOUT", (payload) => {
      const data = payload as { reason?: string };
      let message = data.reason || t("viewer.session.force_logout_message");

      // reason 코드가 "DUPLICATE_LOGIN"이면 다국어 메시지 사용
      if (data.reason === "DUPLICATE_LOGIN") {
        message = t("viewer.session.force_logout_message");
      }

      setTerminatedInfo({
        isOpen: true,
        reason: message,
      });
    });

    // 서버 사이드 에러 핸들링 (기록 실패 등)
    const unsubscribeError = subscribe("PROGRESS_UPDATE_ERROR", (payload) => {
      console.error("[WS] Progress update failed on server:", payload);
    });

    return () => {
      unsubscribe();
      unsubscribeError();
    };
  }, [subscribe, t]);

  // 2. 진행도 변경 시 서버에 전송 (이벤트 발생 시 실시간 전송)
  const updateProgress = useCallback(() => {
    if (chapterId && seriesId) {
      sendMessage("UPDATE_PROGRESS", {
        series_id: seriesId,
        chapter_id: chapterId,
        current_page: currentPage,
      });
    }
  }, [sendMessage, seriesId, chapterId, currentPage]);

  // 페이지가 바뀔 때마다 서버에 알림
  useEffect(() => {
    if (isConnected) {
      updateProgress();
    }
  }, [currentPage, isConnected, updateProgress]);

  return { isConnected, terminatedInfo };
}
