// 이미지 프리로딩 훅

import { useEffect, useLayoutEffect, useState, useCallback, useMemo, useRef } from "react";
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
  displayPages: number[];
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
  displayPages,
}: UseImagePreloaderParams): UseImagePreloaderReturn {
  // 이미지 로딩 상태: undefined = 미시작, true = 로딩중, false = 완료
  const [imageLoadingByChapter, setImageLoadingByChapter] = useState<Record<string, Record<number, boolean>>>({});
  const currentChapterIdRef = useRef<string | undefined>(chapterId);
  // null marks completion until React's loading state has caught up.
  const backgroundLoadsRef = useRef(new Map<string, HTMLImageElement | null>());

  useLayoutEffect(() => {
    currentChapterIdRef.current = chapterId;
    const backgroundLoads = backgroundLoadsRef.current;
    return () => {
      // Do not cancel requests on every loading-state/spread effect rerun.
      // Detach them only when the chapter changes or this hook unmounts.
      backgroundLoads.forEach((img) => {
        if (img) {
          img.onload = null;
          img.onerror = null;
        }
      });
      backgroundLoads.clear();
    };
  }, [chapterId]);

  const pruneChapterLoadingMap = useCallback(
    (
      map: Record<string, Record<number, boolean>>,
      targetChapterId?: string,
    ): Record<string, Record<number, boolean>> => {
      const keepChapterIds = new Set<string>();
      if (currentChapterIdRef.current) keepChapterIds.add(currentChapterIdRef.current);
      if (targetChapterId) keepChapterIds.add(targetChapterId);

      const keys = Object.keys(map);
      if (keys.length === keepChapterIds.size && keys.every((key) => keepChapterIds.has(key))) {
        return map;
      }

      const pruned: Record<string, Record<number, boolean>> = {};
      keepChapterIds.forEach((id) => {
        if (map[id]) {
          pruned[id] = map[id];
        }
      });
      return pruned;
    },
    [],
  );

  const imageLoading = useMemo(
    () => (chapterId ? (imageLoadingByChapter[chapterId] ?? {}) : {}),
    [imageLoadingByChapter, chapterId],
  );

  // 이미지 로드 완료 핸들러
  const handleImageLoad = useCallback(
    (pageNum: number) => {
      if (!chapterId) return;
      if (currentChapterIdRef.current !== chapterId) return;
      setImageLoadingByChapter((prev) => ({
        ...pruneChapterLoadingMap(prev, chapterId),
        [chapterId]: {
          ...(prev[chapterId] ?? {}),
          [pageNum]: false,
        },
      }));
    },
    [chapterId, pruneChapterLoadingMap],
  );

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
    // 순차 로딩된 지점 + 5장, 혹은 현재 보고 있는 페이지 + (preloadCount * 1.5) 중 더 큰 범위까지 렌더링 허용
    // 렌더링 범위를 더 넉넉하게 잡아(기존 +3 -> +5) 세로 모드 스크롤 시 무한 로딩 현상 방지
    return Math.max(sequentialLoaded + 5, currentPage + Math.floor(preloadCount * 1.5));
  }, [readingMode, totalPages, imageLoading, currentPage, preloadCount]);

  // 이미지 프리로딩 - 현재 페이지 주변 이미지를 미리 로드
  useEffect(() => {
    if (!chapter || !chapterId) return;
    const requestChapterId = chapterId;

    const pagesToPreload: number[] = readingMode === "vertical" ? [currentPage] : [currentPage, ...displayPages];

    // 앞뒤로 preloadCount만큼 프리로드
    for (let i = 1; i <= preloadCount; i++) {
      if (currentPage + i <= totalPages) {
        pagesToPreload.push(currentPage + i);
      }
      if (currentPage - i >= 1) {
        pagesToPreload.push(currentPage - i);
      }
    }

    const uniquePagesToPreload = [...new Set(pagesToPreload)];

    // 이미지 프리로드 (Image 객체 사용)
    uniquePagesToPreload.forEach((pageNum) => {
      // [Optimization] 현재 페이지는 백그라운드 Image 객체로 미리 로드하지 않음.
      // 실제 <img> 태그(SmartImageViewer)가 로드하도록 하여 onLoad 신호의 정확도를 높임.
      // (배경 로딩이 먼저 끝나버리면 이미지가 실제 그려지기 전 스피너가 제거될 수 있음)
      // Vertical's displayPages contains the entire chapter, not the viewport.
      const isVisiblePage = readingMode === "vertical" ? pageNum === currentPage : displayPages.includes(pageNum);
      const src = getPageImageUrl(chapter.id, pageNum);
      const backgroundLoads = backgroundLoadsRef.current;
      if (imageLoading[pageNum] === false && backgroundLoads.get(src) === null) {
        backgroundLoads.delete(src);
      }

      if (imageLoading[pageNum] === undefined) {
        // 로딩 시작 표시
        setImageLoadingByChapter((prev) => {
          if (currentChapterIdRef.current !== requestChapterId) return prev;
          const pruned = pruneChapterLoadingMap(prev, requestChapterId);
          const chapterLoading = pruned[requestChapterId] ?? {};
          if (chapterLoading[pageNum] !== undefined) return prev;
          return {
            ...pruned,
            [requestChapterId]: { ...chapterLoading, [pageNum]: true },
          };
        });
      }

      // A previously visible page can be true without a background request.
      // The URL identifies chapter/page; the Map deduplicates actual requests.
      if (!isVisiblePage && imageLoading[pageNum] !== false) {
        if (backgroundLoads.has(src)) return;

        const img = new Image();
        backgroundLoads.set(src, img);
        const settle = () => {
          // An old callback must not settle/delete a new request after A→B→A.
          if (backgroundLoads.get(src) !== img) return;
          // Keep a completion marker through stale passive-effect snapshots.
          backgroundLoads.set(src, null);
          img.onload = null;
          img.onerror = null;
          if (currentChapterIdRef.current !== requestChapterId) return;
          setImageLoadingByChapter((prev) => {
            if (currentChapterIdRef.current !== requestChapterId) return prev;
            const chapterLoading = prev[requestChapterId] ?? {};
            if (chapterLoading[pageNum] === false) return prev;
            return {
              ...pruneChapterLoadingMap(prev, requestChapterId),
              [requestChapterId]: { ...chapterLoading, [pageNum]: false },
            };
          });
        };
        img.onload = settle;
        img.onerror = settle;
        img.src = src;
      }
    });
  }, [currentPage, totalPages, chapter, chapterId, preloadCount, imageLoading, pruneChapterLoadingMap, readingMode, displayPages]);

  return {
    imageLoading,
    handleImageLoad,
    maxAllowedPage,
  };
}
