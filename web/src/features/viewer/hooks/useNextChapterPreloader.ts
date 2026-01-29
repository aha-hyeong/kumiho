// 다음 챕터 미리 로딩 훅

import { useEffect, useState, useRef } from "react";
import { chapterAPI } from "../../../api/client";
import { getPageImageUrl } from "../utils/imageUrl";

interface UseNextChapterPreloaderParams {
  nextChapterId: string | null;
  isCurrentChapterLoaded: boolean;
  preloadCount?: number;
}

/**
 * 다음 챕터의 앞부분 이미지를 미리 로딩하여 끊김 없는 전환을 지원하는 훅
 */
export function useNextChapterPreloader({
  nextChapterId,
  isCurrentChapterLoaded,
  preloadCount = 5,
}: UseNextChapterPreloaderParams) {
  const [preloadedChapterId, setPreloadedChapterId] = useState<string | null>(null);
  const isLoadingRef = useRef(false);

  useEffect(() => {
    // 1. 다음 챕터가 없거나, 이미 로딩했으면 중단
    if (!nextChapterId || preloadedChapterId === nextChapterId) return;

    // 2. 현재 챕터 로딩이 아직 안 끝났으면 대기 (네트워크 대역폭 확보)
    if (!isCurrentChapterLoaded) return;

    // 3. 중복 로딩 방지
    if (isLoadingRef.current) return;

    const preloadNextChapter = async () => {
      try {
        isLoadingRef.current = true;
        console.log(`[NextChapterPreloader] Prefetching chapter: ${nextChapterId}`);

        // 챕터 정보 가져오기
        const response = await chapterAPI.get(nextChapterId);
        const chapter = response.data;

        // 앞부분 이미지 프리로드
        const count = Math.min(chapter.page_count, preloadCount);
        const images: HTMLImageElement[] = [];

        for (let i = 1; i <= count; i++) {
          const img = new Image();
          img.src = getPageImageUrl(chapter.id, i);
          images.push(img);
        }

        console.log(`[NextChapterPreloader] Prefetched ${count} images for chapter ${nextChapterId}`);
        setPreloadedChapterId(nextChapterId);
      } catch (err) {
        console.error(`[NextChapterPreloader] Failed to prefetch chapter ${nextChapterId}:`, err);
      } finally {
        isLoadingRef.current = false;
      }
    };

    preloadNextChapter();
  }, [nextChapterId, isCurrentChapterLoaded, preloadedChapterId, preloadCount]);

  return { isPreloaded: preloadedChapterId === nextChapterId };
}
