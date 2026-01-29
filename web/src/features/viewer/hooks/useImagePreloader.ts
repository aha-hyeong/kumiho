// 이미지 프리로딩 훅

import { useEffect, useState, useCallback, useMemo } from "react";
import { getPageImageUrl } from "../utils/imageUrl";
import type { Chapter } from "../types";
import type { ReadingMode } from "../../../stores/viewerStore";

interface UseImagePreloaderParams {
  chapter: Chapter | null;
  chapterId: string | undefined;
  currentPage: number;
  totalPages: number;
  preloadCount: number;
  readingMode: ReadingMode;
}

interface UseImagePreloaderReturn {
  imageLoading: Record<number, boolean>;
  handleImageLoad: (pageNum: number) => void;
  maxAllowedPage: number;
}

/**
 * 이미지 프리로딩 및 로딩 상태 관리
 * - 현재 페이지 주변 이미지를 미리 로드
 * - 세로 모드에서 순차 로딩을 위한 최대 허용 페이지 계산
 */
export function useImagePreloader({
  chapter,
  chapterId,
  currentPage,
  totalPages,
  preloadCount,
  readingMode,
}: UseImagePreloaderParams): UseImagePreloaderReturn {
  // 이미지 로딩 상태: undefined = 미시작, true = 로딩중, false = 완료
  const [imageLoading, setImageLoading] = useState<Record<number, boolean>>({});

  // 챕터 변경 시 로딩 상태 초기화 (세로 모드에서 1페이지부터 로딩하도록)
  useEffect(() => {
    queueMicrotask(() => {
      setImageLoading({});
    });
  }, [chapterId]);

  // 이미지 로드 완료 핸들러
  const handleImageLoad = useCallback((pageNum: number) => {
    setImageLoading((prev) => ({ ...prev, [pageNum]: false }));
  }, []);

  // 세로 모드 순차 로딩 최적화: loop 외부에서 한 번만 계산
  const maxAllowedPage = useMemo(() => {
    if (readingMode !== "vertical") return Number.MAX_SAFE_INTEGER;
    let sequentialLoaded = 0;
    for (let i = 1; i <= totalPages; i++) {
      if (imageLoading[i] === false) {
        sequentialLoaded = i;
      } else {
        break;
      }
    }
    // 순차 로딩된 지점 + 3장, 혹은 현재 보고 있는 페이지 + preloadCount 중 더 큰 범위까지 렌더링 허용
    // 이를 통해 뒤쪽 페이지로 점프했을 때 해당 페이지가 렌더링되지 않는 문제 해결
    return Math.max(sequentialLoaded + 3, currentPage + preloadCount);
  }, [readingMode, totalPages, imageLoading, currentPage, preloadCount]);

  // 이미지 프리로딩 - 현재 페이지 주변 이미지를 미리 로드
  useEffect(() => {
    if (!chapter || !chapterId) return;

    const pagesToPreload: number[] = [];

    // 앞뒤로 preloadCount만큼 프리로드
    for (let i = 1; i <= preloadCount; i++) {
      if (currentPage + i <= totalPages) {
        pagesToPreload.push(currentPage + i);
      }
      if (currentPage - i >= 1) {
        pagesToPreload.push(currentPage - i);
      }
    }

    // 이미지 프리로드 (Image 객체 사용)
    pagesToPreload.forEach((pageNum) => {
      if (imageLoading[pageNum] === undefined) {
        // 로딩 시작 표시
        setImageLoading((prev) => ({ ...prev, [pageNum]: true }));

        const img = new Image();
        img.src = getPageImageUrl(chapter.id, pageNum);
        img.onload = () => {
          setImageLoading((prev) => ({ ...prev, [pageNum]: false }));
        };
      }
    });
  }, [currentPage, totalPages, chapter, chapterId, preloadCount, imageLoading]);

  return {
    imageLoading,
    handleImageLoad,
    maxAllowedPage,
  };
}
