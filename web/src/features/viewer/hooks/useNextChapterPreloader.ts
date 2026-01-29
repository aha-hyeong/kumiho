import { useEffect, useState, useRef } from "react";
import { chapterAPI } from "../../../api/client";
import { getPageImageUrl } from "../utils/imageUrl";
import { useViewerStore } from "../../../stores/viewerStore";
import type { Page } from "../../../types/series";

interface UseNextChapterPreloaderParams {
  nextChapterId: string | null;
  currentChapterId: string | undefined; // 현재 챕터 ID (변경 시 상태 리셋용)
  isCurrentChapterLoaded: boolean;
  preloadCount?: number;
}

/**
 * 다음 챕터 데이터(정보 + 페이지)를 미리 로딩하여 스토어에 캐싱
 * - 끊김 없는 즉시 전환 지원
 */
export function useNextChapterPreloader({
  nextChapterId,
  currentChapterId,
  isCurrentChapterLoaded,
  preloadCount = 5,
}: UseNextChapterPreloaderParams) {
  const { setNextChapterData } = useViewerStore();
  const [preloadedChapterId, setPreloadedChapterId] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  // 챕터 변경 시 프리로드 상태 리셋 (이전 챕터의 프리로드 상태가 새 챕터에 영향주지 않도록)
  useEffect(() => {
    setPreloadedChapterId(null);
    isLoadingRef.current = false;
  }, [currentChapterId]);

  useEffect(() => {
    if (!nextChapterId || preloadedChapterId === nextChapterId) return;
    if (!isCurrentChapterLoaded) return;
    if (isLoadingRef.current) return;

    const preloadNextChapter = async () => {
      try {
        isLoadingRef.current = true;

        // 1. 챕터 정보 가져오기
        const chapterRes = await chapterAPI.get(nextChapterId);
        const chapter = chapterRes.data;

        // 2. 페이지 목록 가져오기
        const pagesRes = await chapterAPI.getPages(nextChapterId);
        const pages: Page[] = pagesRes.data.pages || [];

        // 3. 스토어에 캐시 데이터 저장 (useChapterLoader에서 즉시 로딩에 사용)
        setNextChapterData({
          chapterId: nextChapterId,
          chapter,
          pages,
        });

        // 4. 앞부분 이미지 브라우저 캐시 프리로드
        const count = Math.min(chapter.page_count, preloadCount);
        const images: HTMLImageElement[] = [];

        for (let i = 1; i <= count; i++) {
          const img = new Image();
          img.src = getPageImageUrl(chapter.id, i);
          images.push(img);
        }

        console.log(`[NextChapterPreloader] Prefetched chapter ${nextChapterId} (${count} images)`);
        setPreloadedChapterId(nextChapterId);
      } catch (err) {
        console.error(`[NextChapterPreloader] Failed to prefetch chapter ${nextChapterId}:`, err);
      } finally {
        isLoadingRef.current = false;
      }
    };

    preloadNextChapter();
  }, [nextChapterId, isCurrentChapterLoaded, preloadedChapterId, preloadCount, setNextChapterData]);

  return { isPreloaded: preloadedChapterId === nextChapterId };
}
