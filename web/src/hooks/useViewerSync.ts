import { useEffect, useCallback, useState } from "react";
import { useSSE } from "./useSSE";
import { useTranslation } from "react-i18next";
import { progressAPI } from "../api/client";

interface ViewerSyncProps {
  seriesId: string;
  chapterId?: string;
  currentPage: number;
}

export function useViewerSync({ seriesId, chapterId, currentPage }: ViewerSyncProps) {
  const { subscribe, isConnected } = useSSE({ source: "viewer" });
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

    return () => {
      unsubscribe();
    };
  }, [subscribe, t]);

  // 2. 진행도 변경 시 서버에 전송 (REST API)
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

  // 페이지가 바뀔 때마다 서버에 알림
  useEffect(() => {
    if (isConnected) {
      updateProgress();
    }
  }, [currentPage, isConnected, updateProgress]);

  return { isConnected, terminatedInfo };
}
