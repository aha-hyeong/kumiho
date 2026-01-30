// 진행도 저장/로드 훅

import { useEffect, useCallback, useRef } from "react";
import { seriesAPI, volumeAPI } from "../../../api/client";
import { PROGRESS_SAVE_INTERVAL } from "../utils/constants";
import { API_BASE_URL } from "../utils/imageUrl";
import type { Chapter } from "../types";

interface UseProgressParams {
  seriesId: string | null;
  chapterId: string | undefined;
  chapter: Chapter | null;
  currentPage: number;
  totalPages: number;
  isLoading: boolean;
  isIncognito: boolean;
  isLastChapterOfVolume: boolean;
  isInitialScrollingRef: React.RefObject<boolean>;
}

interface UseProgressReturn {
  saveProgress: () => Promise<void>;
}

/**
 * 진행도 저장 및 볼륨 완료 처리 훅
 * - 페이지 변경 시 진행도 저장 (Throttle)
 * - 볼륨의 마지막 챕터 마지막 페이지 도달 시 완료 처리
 * - beforeunload 시 진행도 저장
 */
export function useProgress({
  seriesId,
  chapterId,
  chapter,
  currentPage,
  totalPages,
  isLoading,
  isIncognito,
  isLastChapterOfVolume,
  isInitialScrollingRef,
}: UseProgressParams): UseProgressReturn {
  const volumeCompletedRef = useRef(false);
  const lastSaveTimeRef = useRef<number>(0);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 볼륨 완료 처리 함수 (중복 호출 방지 포함)
  const handleVolumeCompletion = useCallback(async () => {
    // 초기 로딩 중이거나 초기 정렬 중이면 절대 완료 처리 하지 않음
    if (isLoading || isInitialScrollingRef.current || !chapter || chapter.id !== chapterId) return;

    // 비정상적인 상태 검사 (totalPages가 0이거나 미달인 경우 무시)
    if (totalPages <= 0 || currentPage !== totalPages || !isLastChapterOfVolume) return;

    // 이미 완료 처리됨
    if (volumeCompletedRef.current) return;

    try {
      await volumeAPI.markComplete(chapter.volume_id);
      volumeCompletedRef.current = true;
      console.log(`볼륨 완료 처리: ${chapter.volume_id}`);
    } catch (completeErr) {
      console.error("볼륨 완료 처리 실패:", completeErr);
    }
  }, [isLoading, chapter, chapterId, currentPage, totalPages, isLastChapterOfVolume, isInitialScrollingRef]);

  const isSavingRef = useRef(false);

  // 진행도 즉시 저장
  const saveProgress = useCallback(async () => {
    // 시크릿 모드인 경우 저장하지 않음
    if (isIncognito) return;

    // 초기 로딩 중이거나 초기 정렬(스크롤 이동) 중이면 절대 저장 안 함
    if (isLoading || isInitialScrollingRef.current || !chapterId || !chapter || !seriesId || totalPages <= 0) return;

    // 현재 URL의 챕터 ID와 렌더링된 데이터가 일치하는지 한 번 더 확인
    if (chapter.id !== chapterId) return;

    // 페이지 번호가 유효 범위를 벗어난 경우 저장 안 함 (레이스 컨디션 방어)
    if (currentPage > totalPages || currentPage < 1) return;

    // 이미 저장 중이면 건너뜀 (네트워크 느린 환경 대응)
    if (isSavingRef.current) return;

    try {
      isSavingRef.current = true;
      await seriesAPI.updateProgress(seriesId, {
        chapter_id: chapterId,
        volume_id: chapter.volume_id,
        current_page: currentPage,
        total_pages: totalPages,
        progress_percent: (currentPage / totalPages) * 100,
      });
      console.log(`진행도 저장: ${currentPage}/${totalPages} 페이지`);

      // 마지막 페이지에 도달한 경우 볼륨 완료 처리
      await handleVolumeCompletion();
    } catch (err) {
      console.error("진행도 저장 실패:", err);
    } finally {
      isSavingRef.current = false;
    }
  }, [
    isLoading,
    isIncognito,
    chapterId,
    chapter,
    seriesId,
    currentPage,
    totalPages,
    handleVolumeCompletion,
    isInitialScrollingRef,
  ]);

  // 챕터 변경 시 완료 상태 리셋
  useEffect(() => {
    volumeCompletedRef.current = false;
  }, [chapterId]);

  // 페이지 변경 시 진행도 저장 (Throttle 처리)
  useEffect(() => {
    if (isLoading || !chapterId) return;

    const now = Date.now();
    const timeSinceLastSave = now - lastSaveTimeRef.current;

    // 이전에 예약된 타이머가 있다면 취소
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    if (timeSinceLastSave >= PROGRESS_SAVE_INTERVAL) {
      // 즉시 저장
      saveProgress();
      lastSaveTimeRef.current = now;
    } else {
      // 남은 시간만큼 대기 후 저장 (Trailing edge)
      saveTimerRef.current = setTimeout(() => {
        saveProgress();
        lastSaveTimeRef.current = Date.now();
      }, PROGRESS_SAVE_INTERVAL - timeSinceLastSave);
    }

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, [currentPage, saveProgress, isLoading, chapterId]);

  // beforeunload 시 진행도 저장
  useEffect(() => {
    const handleBeforeUnload = () => {
      // 시크릿 모드인 경우 저장하지 않음
      if (isIncognito) return;

      // 페이지 종료 시 진행도 저장 (fetch + keepalive + credentials 사용)
      if (seriesId && chapterId) {
        const data = JSON.stringify({
          chapter_id: chapterId,
          volume_id: chapter?.volume_id,
          current_page: currentPage,
          total_pages: totalPages,
          progress_percent: totalPages > 0 ? (currentPage / totalPages) * 100 : 0,
        });

        fetch(`${API_BASE_URL}/series/${seriesId}/progress`, {
          method: "PATCH",
          body: data,
          headers: { "Content-Type": "application/json" },
          credentials: "include", // 쿠키 자동 전송
          keepalive: true, // 페이지 종료 후에도 요청 완료
        }).catch((err) => console.error("Progress save failed:", err));
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [seriesId, chapterId, currentPage, totalPages, chapter, isIncognito]);

  return { saveProgress };
}
