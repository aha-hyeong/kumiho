import { useCallback, useEffect, useState, useMemo, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useSearchParams } from "react-router-dom";
import { chapterAPI, volumeAPI, viewerAPI } from "../../../api/client";
import { useViewerStore } from "../../../stores/viewerStore";
import type { ViewerSettings, ReadingMode, ReadingDirection, FitMode } from "../../../stores/viewerStore";
import type { Chapter, PageMeta, RestorePosition, ViewStatus } from "../types";
import type { Page, ReadingProgress } from "../../../types/series";
import { WIDE_RATIO_THRESHOLD } from "../utils/constants";

interface UseChapterLoaderParams {
  chapterId: string | undefined;
}

export interface UseChapterLoaderReturn {
  chapter: Chapter | null;
  isLoading: boolean;
  error: string | null;
  seriesId: string | null;
  volumeId: string | null;
  pageMeta: PageMeta[];
  pageMetaMap: Map<number, PageMeta>;
  isInitialScrollingRef: React.RefObject<boolean>;
  restorePosition?: RestorePosition;
  viewStatus?: ViewStatus;
  setViewStatus?: Dispatch<SetStateAction<ViewStatus>>;
}

/**
 * 챕터 데이터 로딩 및 캐싱을 담당하는 커스텀 훅
 * - 챕터 정보 로드
 * - 진행도 로드 및 초기 페이지 설정
 * - 설정 계층 병합 (Global < Library < Series)
 * - 페이지 메타데이터 로드 (wide 페이지 감지용)
 * - Next Chapter Pre-loading 캐시 활용
 */
export function useChapterLoader({ chapterId }: UseChapterLoaderParams): UseChapterLoaderReturn {
  const [searchParams] = useSearchParams();
  const urlPage = searchParams.get("page");
  const urlAnchor = searchParams.get("anchor");
  const urlOffset = searchParams.get("offset");

  const { settings, nextChapterData, initPage, initializeSettings, setCurrentSeriesId, setNextChapterData } =
    useViewerStore();

  // 로컬 상태
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta[]>([]);
  const [viewStatus, setViewStatus] = useState<ViewStatus>("loading");
  const [restorePosition, setRestorePosition] = useState<RestorePosition>({
    currentPage: 1,
    anchorPage: 1,
    offsetRatio: 0,
  });

  // 페이지 메타데이터 Map (O(1) 조회용)
  const pageMetaMap = useMemo(() => new Map(pageMeta.map((p) => [p.pageNumber, p])), [pageMeta]);

  // 다음 챕터 데이터 캐시를 Ref로 관리
  const nextChapterDataRef = useRef(nextChapterData);
  useEffect(() => {
    nextChapterDataRef.current = nextChapterData;
  }, [nextChapterData]);

  // 초기 스크롤 가드 Ref
  const isInitialScrollingRef = useRef(false);

  // 볼륨 ID Ref
  const volumeIdRef = useRef<string | null>(null);
  // page_count <= 0 (예: 0=미확정/빈 문서, -1=PDF 페이지 수 추출 실패 sentinel)인 경우
  // "last" 페이지는 안전하게 1페이지로 폴백한다.
  const resolveLastPage = (pageCount: number) => {
    if (pageCount <= 0) return 1;
    return pageCount;
  };
  const clampPageByPageCount = (page: number, pageCount: number) => {
    if (pageCount <= 0) return Math.max(1, page);
    return Math.max(1, Math.min(page, pageCount));
  };
  const clampOffsetRatio = (offsetRatio: number | undefined) => {
    if (typeof offsetRatio !== "number" || Number.isNaN(offsetRatio)) return 0;
    return Math.max(0, Math.min(1, offsetRatio));
  };
  const resolveRestorePosition = useCallback(
    (pageCount: number, shouldUseOffsetRestore: boolean, progress?: ReadingProgress | null): RestorePosition => {
      if (urlPage === "last") {
        const page = resolveLastPage(pageCount);
        return { currentPage: page, anchorPage: page, offsetRatio: 0 };
      }

      if (urlPage) {
        const parsed = parseInt(urlPage, 10);
        if (!Number.isNaN(parsed)) {
          const page = clampPageByPageCount(parsed, pageCount);
          const parsedAnchor = urlAnchor ? parseInt(urlAnchor, 10) : page;
          const parsedOffset = urlOffset ? parseFloat(urlOffset) : 0;
          return {
            currentPage: page,
            anchorPage: clampPageByPageCount(Number.isNaN(parsedAnchor) ? page : parsedAnchor, pageCount),
            offsetRatio: shouldUseOffsetRestore ? clampOffsetRatio(parsedOffset) : 0,
          };
        }
      }

      const currentPage = clampPageByPageCount(progress?.current_page || 1, pageCount);
      const anchorPage = clampPageByPageCount(progress?.anchor_page || currentPage, pageCount);
      return {
        currentPage,
        anchorPage,
        offsetRatio: shouldUseOffsetRestore ? clampOffsetRatio(progress?.offset_ratio) : 0,
      };
    },
    [urlAnchor, urlOffset, urlPage],
  );
  const finishChapterLoad = () => {
    setIsLoading(false);
    if (readingModeRef.current === "vertical") {
      setViewStatus("hydrating");
      isInitialScrollingRef.current = true;
      return;
    }
    // [Fix] 단일/두쪽 보기 모드에서도 뷰어가 실제 이미지 로드 완료 전까지 스피너를 유지하도록 "rendering" 상태를 거친다.
    // 기존에는 즉시 "ready"로 바뀌어 스피너가 먼저 사라졌음.
    setViewStatus("rendering");
    isInitialScrollingRef.current = false;
  };

  // 시리즈 ID 관리 및 설정 초기화 (언마운트 시 초기화)
  useEffect(() => {
    return () => {
      setCurrentSeriesId(null);
    };
  }, [setCurrentSeriesId]);

  const readingModeRef = useRef(settings.readingMode);
  useEffect(() => {
    readingModeRef.current = settings.readingMode;
  }, [settings.readingMode]);

  // 챕터 정보 로드
  useEffect(() => {
    if (!chapterId) return;

    let cancelled = false;
    let rafId: number | null = null;

    const loadChapter = async () => {
      try {
        const readingModeAtLoad = readingModeRef.current;
        const shouldUseOffsetRestore = readingModeAtLoad !== "vertical";
        setIsLoading(true);
        setViewStatus("loading");
        setError(null);
        setChapter(null);
        setSeriesId(null);
        setVolumeId(null);
        setRestorePosition({ currentPage: 1, anchorPage: 1, offsetRatio: 0 });
        volumeIdRef.current = null;
        setCurrentSeriesId(null);
        // [Fix] 새 챕터 로딩 시 기존 상태 초기화 (Stale Data 방지)
        initPage(1, 0);

        // [Debug] 로깅 추가
        console.log(`[ChapterLoader] 챕터 로드 시작: chapterId=${chapterId}`);

        // 캐시된 데이터가 있는지 확인 (Next Chapter Pre-loading)
        const cachedNextData = nextChapterDataRef.current;
        if (cachedNextData && cachedNextData.chapterId === chapterId) {
          console.log("[ChapterLoader] 캐시된 챕터 데이터 사용 (Instant Load)", {
            id: cachedNextData.chapter.id,
            pages: cachedNextData.chapter.page_count,
          });
          const { chapter: cachedChapter, pages: cachedPages } = cachedNextData;

          // 볼륨 ID 설정
          if (cachedChapter.volume_id && cachedChapter.volume_id !== volumeIdRef.current) {
            volumeIdRef.current = cachedChapter.volume_id;
            if (!cancelled) setVolumeId(cachedChapter.volume_id);
          }

          if (cachedNextData.seriesId) {
            setSeriesId(cachedNextData.seriesId);
            setCurrentSeriesId(cachedNextData.seriesId);
          }

          let progress: ReadingProgress | null = null;
          if (!urlPage) {
            try {
              const progressRes = await chapterAPI.getProgress(chapterId);
              if (cancelled) return;
              progress = progressRes.data.progress as ReadingProgress | null;
            } catch (err) {
              console.warn("[Viewer] 캐시 로드 중 진행도 조회 실패:", err);
            }
          }

          const nextRestorePosition = resolveRestorePosition(
            cachedChapter.page_count,
            shouldUseOffsetRestore,
            progress,
          );
          const startPage = nextRestorePosition.currentPage;

          if (cancelled) return;

          // 즉시 렌더링
          console.log(
            `[ChapterLoader] Rendering cached chapter: ${cachedChapter.id}, startPage=${startPage}, total=${cachedChapter.page_count}`,
          );
          setChapter(cachedChapter);
          setRestorePosition(nextRestorePosition);
          isInitialScrollingRef.current = true;
          initPage(startPage, cachedChapter.page_count);

          // 메타데이터 설정
          const meta: PageMeta[] = cachedPages.map((page: Page) => ({
            pageNumber: page.page_number,
            width: page.width || 0,
            height: page.height || 0,
            isWide:
              (page.width || 0) > 0 &&
              (page.height || 0) > 0 &&
              (page.width || 0) > (page.height || 0) * WIDE_RATIO_THRESHOLD,
          }));
          setPageMeta(meta);

          // 캐시 데이터 초기화
          setNextChapterData(null);

          // 로딩 상태 및 스크롤 가드 해제 — 다음 페인트 사이클까지만 대기
          rafId = requestAnimationFrame(() => {
            if (cancelled) return;
            finishChapterLoad();
          });

          // 부가 정보 로드 (비동기, 백그라운드 처리)
          if (!cachedNextData.seriesId) {
            (async () => {
              try {
                if (cachedChapter.volume_id) {
                  const volumeRes = await volumeAPI.get(cachedChapter.volume_id);
                  if (cancelled) return;
                  const loadedSeriesId = volumeRes.data.series_id;
                  setSeriesId(loadedSeriesId);
                  if (loadedSeriesId) {
                    setCurrentSeriesId(loadedSeriesId);
                  }
                }
              } catch (e) {
                console.warn("부가 정보 로드 실패", e);
              }
            })();
          }

          return;
        }

        // 1. 단일 API 호출로 뷰어 초기 데이터 전체 로드 (Waterfall 방지)
        const initRes = await viewerAPI.getInitData(chapterId);
        if (cancelled) return;

        const {
          chapter: chapterData,
          volume: volumeData,
          series: seriesData,
          library,
          progress,
          user_settings: serverSeriesSettings,
          pages: initPages,
          server_settings: globalData,
        } = initRes.data;

        console.log(`[ChapterLoader] Init API Loaded: ${chapterData.id}, pages=${chapterData.page_count}`);

        // 볼륨 ID 및 시리즈 ID 설정
        if (chapterData.volume_id && chapterData.volume_id !== volumeIdRef.current) {
          volumeIdRef.current = chapterData.volume_id;
          setVolumeId(chapterData.volume_id);
        }
        setSeriesId(seriesData.id);

        let nextRestorePosition = resolveRestorePosition(chapterData.page_count, shouldUseOffsetRestore, progress);
        let startPage = nextRestorePosition.currentPage;

        // 설정 우선순위 적용 (Series Override -> Library Default -> Global Default)
        try {
          // 완독된 볼륨이면 마지막 페이지로 설정
          if (volumeData.is_completed && !urlPage && startPage === 1) {
            startPage = chapterData.page_count;
            nextRestorePosition = {
              currentPage: chapterData.page_count,
              anchorPage: chapterData.page_count,
              offsetRatio: 0,
            };
          }

          // 시리즈 개별 설정 매핑
          const seriesOverride: Partial<ViewerSettings> = {};
          if (serverSeriesSettings) {
            const mapping: Record<string, keyof ViewerSettings> = {
              reading_mode: "readingMode",
              reading_direction: "readingDirection",
              click_direction: "clickDirection",
              keyboard_direction: "keyboardDirection",
              wheel_direction: "wheelDirection",
              swipe_direction: "swipeDirection",
              fit_mode: "fitMode",
              background_color: "backgroundColor",
              page_transition: "pageTransition",
              show_pdf_zoom_controls: "showPdfZoomControls",
              preload_count: "preloadCount",
              pull_threshold: "pullThreshold",
              pull_sensitivity: "pullSensitivity",
              show_threshold: "showThreshold",
            };

            Object.entries(serverSeriesSettings).forEach(([key, value]) => {
              const camelKey = mapping[key];
              if (camelKey && value !== undefined && value !== null) {
                (seriesOverride as Record<string, unknown>)[camelKey] = value;
              }
            });
          }

          // 계층별 병합
          const resolvedSettings: Partial<ViewerSettings> = {};

          resolvedSettings.readingMode = (seriesOverride.readingMode ||
            library.default_view_mode ||
            globalData.viewer_reading_mode ||
            "vertical") as ReadingMode;

          resolvedSettings.readingDirection = (seriesOverride.readingDirection ||
            library.default_read_direction ||
            globalData.viewer_reading_direction ||
            "ltr") as ReadingDirection;

          resolvedSettings.clickDirection = (seriesOverride.clickDirection ||
            globalData.viewer_click_direction ||
            globalData.viewer_reading_direction ||
            "ltr") as ReadingDirection;

          resolvedSettings.keyboardDirection = (seriesOverride.keyboardDirection ||
            globalData.viewer_keyboard_direction ||
            "ltr") as ReadingDirection;

          resolvedSettings.wheelDirection = (seriesOverride.wheelDirection ||
            globalData.viewer_wheel_direction ||
            "down") as ViewerSettings["wheelDirection"];

          resolvedSettings.swipeDirection = (seriesOverride.swipeDirection ||
            globalData.swipe_direction ||
            "ltr") as ReadingDirection;

          resolvedSettings.fitMode = (seriesOverride.fitMode || globalData.viewer_fit_mode || "screen") as FitMode;

          resolvedSettings.backgroundColor = seriesOverride.backgroundColor || "#000000";
          resolvedSettings.pageTransition = (seriesOverride.pageTransition ||
            globalData.viewer_page_transition ||
            "slide") as ViewerSettings["pageTransition"];
          resolvedSettings.showPdfZoomControls =
            seriesOverride.showPdfZoomControls ??
            (globalData.viewer_show_pdf_zoom_controls ? globalData.viewer_show_pdf_zoom_controls === "true" : true);

          if (globalData.viewer_preload_count)
            resolvedSettings.preloadCount = parseInt(globalData.viewer_preload_count, 10);
          if (globalData.viewer_pull_threshold)
            resolvedSettings.pullThreshold = parseInt(globalData.viewer_pull_threshold, 10);
          if (globalData.viewer_pull_sensitivity)
            resolvedSettings.pullSensitivity = parseFloat(globalData.viewer_pull_sensitivity);
          if (globalData.viewer_show_threshold)
            resolvedSettings.showThreshold = parseInt(globalData.viewer_show_threshold, 10);

          initializeSettings(resolvedSettings);
          // initializeSettings는 동기적으로 스토어를 업데이트하지만,
          // readingModeRef는 useEffect로 갱신되어 rAF 콜백 시점에 아직 옛 값일 수 있다.
          // finishChapterLoad가 올바른 모드로 분기하도록 즉시 동기화한다.
          if (resolvedSettings.readingMode) {
            readingModeRef.current = resolvedSettings.readingMode;
          }
          setCurrentSeriesId(seriesData.id);

          if (import.meta.env.DEV) {
            console.log(`[Viewer] Settings initialized for series ${seriesData.id}:`, {
              mode: resolvedSettings.readingMode,
              dir: resolvedSettings.readingDirection,
            });
          }
        } catch (err) {
          console.error("설정 적용 실패:", err);
        }

        if (cancelled) return;

        // 상태 업데이트
        setChapter(chapterData);
        setRestorePosition(nextRestorePosition);
        isInitialScrollingRef.current = true;
        console.log(`[ChapterLoader] Initializing page: start=${startPage}, total=${chapterData.page_count}`);
        initPage(startPage, chapterData.page_count);

        // 페이지 메타데이터 처리
        try {
          let pages = initPages || [];

          // 분석이 필요한 페이지가 있는지 확인
          const needsAnalysis =
            readingModeAtLoad !== "vertical" &&
            pages.some((page: Page) => (page.width || 0) === 0 || (page.height || 0) === 0);

          if (needsAnalysis) {
            console.log("[Viewer] 이미지 크기 분석 필요, 분석 API 호출 중...");
            try {
              const analyzeRes = await chapterAPI.analyze(chapterId);
              if (cancelled) return;
              if (import.meta.env.DEV) {
                console.log(
                  `[Viewer] 분석 완료: ${analyzeRes.data.analyzed_count}/${analyzeRes.data.total_pages} 페이지`,
                );
              }

              const pagesRes = await chapterAPI.getPages(chapterId);
              if (cancelled) return;
              pages = pagesRes.data.pages || [];
            } catch (analyzeErr) {
              console.warn("[Viewer] 이미지 분석 실패, 기존 데이터로 진행:", analyzeErr);
            }
          }

          const meta: PageMeta[] = pages.map((page: Page) => ({
            pageNumber: page.page_number,
            width: page.width || 0,
            height: page.height || 0,
            isWide:
              (page.width || 0) > 0 &&
              (page.height || 0) > 0 &&
              (page.width || 0) > (page.height || 0) * WIDE_RATIO_THRESHOLD,
          }));
          setPageMeta(meta);
        } catch (metaErr) {
          if (cancelled) return;
          console.warn("페이지 메타데이터 로드 실패 (기존 방식으로 동작):", metaErr);
          setPageMeta([]);
        }

        if (cancelled) return;

        // 5. 완료 후 가드 해제 — 다음 페인트 사이클까지만 대기 (React 18 자동 배칭으로 충분)
        rafId = requestAnimationFrame(() => {
          if (cancelled) return;
          finishChapterLoad();
        });
      } catch (err) {
        if (cancelled) return;
        console.error("챕터 로드 실패:", err);
        setError("챕터를 불러올 수 없습니다.");
        setIsLoading(false);
        setViewStatus("ready");
      }
    };

    loadChapter();

    return () => {
      cancelled = true;
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
    };
    // seriesSettings를 의존성에서 제외:
    // 설정 변경 시 챕터 재로드를 방지하기 위함. 초기 로드에만 필요하고 readingMode 변경 시 재로드하면 안됨.
  }, [
    chapterId,
    initPage,
    initializeSettings,
    resolveRestorePosition,
    setCurrentSeriesId,
    setNextChapterData,
    urlAnchor,
    urlOffset,
    urlPage,
  ]);

  // 세로 모드 -> 다른 모드로 변경 시 이미지 분석 로직
  useEffect(() => {
    if (isLoading || !chapterId || settings.readingMode === "vertical") return;

    const hasIncompleteMeta = pageMeta.some((p) => p.width === 0 || p.height === 0);
    if (!hasIncompleteMeta) return;

    console.log("[ChapterLoader] 모드 변경 감지(vertical -> non-vertical), 메타데이터 재분석 시도...");

    // 분석 API 호출
    (async () => {
      try {
        const analyzeRes = await chapterAPI.analyze(chapterId);
        if (import.meta.env.DEV) {
          console.log(
            `[ChapterLoader] 재분석 완료: ${analyzeRes.data.analyzed_count}/${analyzeRes.data.total_pages} 페이지`,
          );
        }

        // 페이지 정보 다시 가져와서 업데이트
        const pagesRes = await chapterAPI.getPages(chapterId);
        const pages = pagesRes.data.pages || [];

        const meta: PageMeta[] = pages.map((page: { page_number: number; width: number; height: number }) => ({
          pageNumber: page.page_number,
          width: page.width || 0,
          height: page.height || 0,
          isWide: page.width > 0 && page.height > 0 && page.width > page.height * WIDE_RATIO_THRESHOLD,
        }));
        setPageMeta(meta);
      } catch (e) {
        console.warn("[ChapterLoader] 재분석 실패:", e);
      }
    })();
  }, [settings.readingMode, chapterId, isLoading, pageMeta]);

  return {
    chapter,
    isLoading,
    error,
    seriesId,
    volumeId,
    pageMeta,
    pageMetaMap,
    isInitialScrollingRef,
    restorePosition,
    viewStatus,
    setViewStatus,
  };
}
