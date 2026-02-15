import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { seriesAPI, volumeAPI } from "../../../api/client";
import type { Chapter } from "../types";

interface ServerProgress {
  volume_number: number;
  chapter_number: number;
  current_page: number;
  chapter_id: string;
  volume_id: string;
}

interface UseProgressSyncParams {
  seriesId: string | null;
  chapter: Chapter | null;
  currentPage: number;
  isLoading: boolean;
}

export function useProgressSync({ seriesId, chapter, currentPage, isLoading }: UseProgressSyncParams) {
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [serverProgress, setServerProgress] = useState<ServerProgress | null>(null);
  const isCheckedRef = useRef(false);
  const navigate = useNavigate();

  const checkSync = useCallback(async () => {
    if (!seriesId || !chapter || isLoading || isCheckedRef.current) return;

    try {
      // 볼륨 번호 가져오기
      const volumeRes = await volumeAPI.get(chapter.volume_id);
      const volumeNumber = volumeRes.data.volume_number;

      const response = await seriesAPI.compareProgress(seriesId, {
        volume_number: volumeNumber,
        chapter_number: chapter.chapter_number,
        current_page: currentPage,
      });

      const { server_ahead, server_progress } = response.data;

      if (server_ahead && server_progress) {
        setServerProgress(server_progress);
        setShowSyncModal(true);
      }

      isCheckedRef.current = true;
    } catch (error) {
      console.error("[useProgressSync] Failed to compare progress:", error);
    }
  }, [seriesId, chapter, currentPage, isLoading]);

  useEffect(() => {
    const triggerSync = async () => {
      // 로딩이 막 끝난 시점에 한 번만 체크
      if (!isLoading && chapter && seriesId && !isCheckedRef.current) {
        await checkSync();
      }
    };

    triggerSync();
  }, [isLoading, chapter, seriesId, checkSync]);

  const handleConfirmSync = useCallback(() => {
    if (!serverProgress) return;

    setShowSyncModal(false);
    // 해당 챕터와 페이지로 이동
    navigate(`/viewer/${serverProgress.chapter_id}?page=${serverProgress.current_page}`);
    // 페이지 이동 시 콤포넌트가 재마운트되거나 훅이 다시 실행되므로 isCheckedRef는 그대로 둬도 됨
  }, [serverProgress, navigate]);

  const handleCloseModal = useCallback(() => {
    setShowSyncModal(false);
  }, []);

  return {
    showSyncModal,
    serverProgress,
    handleConfirmSync,
    handleCloseModal,
  };
}
