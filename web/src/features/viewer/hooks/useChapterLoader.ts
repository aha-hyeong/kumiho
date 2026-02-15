// 챕터 로딩 훅

import { useEffect, useState, useMemo, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { chapterAPI, volumeAPI, seriesAPI, libraryAPI, settingAPI } from "../../../api/client";
import { useViewerStore } from "../../../stores/viewerStore";
import type { ViewerSettings, ReadingMode, ReadingDirection, FitMode } from "../../../stores/viewerStore";
import type { Chapter, PageMeta } from "../types";
import type { Page } from "../../../types/series";
import { WIDE_RATIO_THRESHOLD } from "../utils/constants";

interface UseChapterLoaderParams {
  chapterId: string | undefined;
}

interface UseChapterLoaderReturn {
  chapter: Chapter | null;
  isLoading: boolean;
  error: string | null;
  seriesId: string | null;
  volumeId: string | null;
  pageMeta: PageMeta[];
  pageMetaMap: Map<number, PageMeta>;
  isInitialScrollingRef: React.RefObject<boolean>;
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

  const { settings, nextChapterData, initPage, initializeSettings, setCurrentSeriesId, setNextChapterData } =
    useViewerStore();

  // 로컬 상태
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [volumeId, setVolumeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageMeta, setPageMeta] = useState<PageMeta[]>([]);

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

  // 로딩 타이머 Ref (브라우저 환경이므로 ReturnType<typeof setTimeout> 사용)
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // readingMode Ref (의존성 배열을 피하기 위해 ref로 관리)
  const readingModeRef = useRef(settings.readingMode);
  useEffect(() => {
    readingModeRef.current = settings.readingMode;
  }, [settings.readingMode]);

  // 시리즈 ID 관리 및 설정 초기화 (언마운트 시 초기화)
  useEffect(() => {
    return () => {
      setCurrentSeriesId(null);
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
  }, [setCurrentSeriesId]);

  // 챕터 정보 로드
  useEffect(() => {
    if (!chapterId) return;

    // 현재 실행 중인 effect의 chapterId를 캡처하여 타이머 콜백에서 검증용으로 사용
    const effectChapterId = chapterId;

    const loadChapter = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setChapter(null);
        if (import.meta.env.DEV) {
          console.log(`[ChapterLoader] 챕터 로드 시작: chapterId=${chapterId}`);
        }

        // 캐시된 데이터가 있는지 확인 (Next Chapter Pre-loading)
        const cachedNextData = nextChapterDataRef.current;
        if (cachedNextData && cachedNextData.chapterId === chapterId) {
          if (import.meta.env.DEV) console.log("[Viewer] 캐시된 챕터 데이터 사용 (Instant Load)");
          const { chapter: cachedChapter, pages: cachedPages } = cachedNextData;

          // 볼륨 ID 설정
          if (cachedChapter.volume_id && cachedChapter.volume_id !== volumeIdRef.current) {
            volumeIdRef.current = cachedChapter.volume_id;
            setVolumeId(cachedChapter.volume_id);
          }

          // 진행도 로드 (URL 파라미터 우선 확인)
          let startPage = 1;
          if (urlPage === "last") {
            startPage = cachedChapter.page_count;
          } else if (urlPage) {
            const parsed = parseInt(urlPage, 10);
            if (!isNaN(parsed)) startPage = parsed;
          } else {
            // URL 파라미터가 없으면 진행도 조회 (캐시 데이터 사용 시에도 진행도는 최신 상태여야 함)
            try {
              const progressRes = await chapterAPI.getProgress(chapterId);
              const progress = progressRes.data.progress;
              if (import.meta.env.DEV) console.log(`[ChapterLoader] Cached load - Progress fetched:`, progress);

              if (progress && progress.current_page > 0) {
                startPage = Math.min(progress.current_page, cachedChapter.page_count);
                if (import.meta.env.DEV)
                  console.log(`[ChapterLoader] StartPage updated to ${startPage} (from progress)`);
              }
            } catch (err) {
              console.warn("[Viewer] 캐시 로드 중 진행도 조회 실패:", err);
            }
          }

          // 즉시 렌더링
          if (import.meta.env.DEV)
            console.log(`[ChapterLoader] Rendering cached chapter: ${cachedChapter.id}, startPage=${startPage}`);
          setChapter(cachedChapter);
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

          // 로딩 상태 및 스크롤 가드 해제 (약간의 지연으로 초기 스크롤 이동 완료 대기)
          if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = setTimeout(() => {
            // Guard: 여전히 같은 챕터를 로딩 중인지 확인
            if (chapterId !== effectChapterId) return;

            setIsLoading(false);
            if (readingModeRef.current !== "vertical") {
              isInitialScrollingRef.current = false;
            }
          }, 150);

          // 부가 정보 로드 (비동기, 백그라운드 처리)
          (async () => {
            try {
              if (cachedChapter.volume_id) {
                const volumeRes = await volumeAPI.get(cachedChapter.volume_id);
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

          return;
        }

        // 1. 챕터 정보 먼저 가져오기
        const response = await chapterAPI.get(chapterId);
        const chapterData = response.data;

        // 볼륨 ID 설정
        if (chapterData.volume_id && chapterData.volume_id !== volumeIdRef.current) {
          volumeIdRef.current = chapterData.volume_id;
          setVolumeId(chapterData.volume_id);
        }

        // 2. 진행도 정보도 미리 가져오기
        let startPage = 1;
        if (urlPage) {
          if (urlPage === "last") {
            startPage = chapterData.page_count;
          } else {
            const parsedPage = parseInt(urlPage, 10);
            if (!isNaN(parsedPage)) {
              startPage = Math.max(1, Math.min(parsedPage, chapterData.page_count));
            }
          }
        } else {
          try {
            const progressRes = await chapterAPI.getProgress(chapterId);
            const progress = progressRes.data.progress;

            if (progress && progress.current_page > 0) {
              startPage = Math.min(progress.current_page, chapterData.page_count);
            }
          } catch (progressErr: unknown) {
            const err = progressErr as { response?: { status: number }; message?: string };
            if (err?.response?.status !== 404) {
              console.warn("진행도 로드 실패:", err?.message || progressErr);
            }
          }
        }

        // 볼륨 정보 로드
        if (chapterData.volume_id) {
          try {
            const volumeRes = await volumeAPI.get(chapterData.volume_id);
            const loadedSeriesId = volumeRes.data.series_id;
            setSeriesId(loadedSeriesId);

            if (loadedSeriesId) {
              // 설정 우선순위 적용
              try {
                // 완독된 볼륨이면 마지막 페이지로 설정
                if (volumeRes.data.is_completed && !urlPage && startPage === 1) {
                  startPage = chapterData.page_count;
                }

                // 1. 전역 기본값 로드
                const globalRes = await settingAPI.list();
                const globalData = (globalRes || {}) as Record<string, string>;

                // 2. 시리즈 정보 로드
                const seriesRes = await seriesAPI.get(loadedSeriesId);
                const seriesData = seriesRes.data;

                // 3. 라이브러리 기본값 로드
                const libRes = await libraryAPI.get(seriesData.library_id);
                const library = libRes.data;

                // 4. 시리즈 개별 설정 로드
                const seriesOverride: Partial<ViewerSettings> = {};
                try {
                  const serverSeriesSettings = await seriesAPI.getViewerSettings(loadedSeriesId);
                  if (serverSeriesSettings && Object.keys(serverSeriesSettings).length > 0) {
                    const mapping: Record<string, keyof ViewerSettings> = {
                      reading_mode: "readingMode",
                      reading_direction: "readingDirection",
                      click_direction: "clickDirection",
                      keyboard_direction: "keyboardDirection",
                      fit_mode: "fitMode",
                      background_color: "backgroundColor",
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
                } catch (err) {
                  console.warn("시리즈 개별 설정 서버 로드 실패, 로컬 설정을 사용합니다:", err);
                }

                // 5. 계층별 병합
                const resolvedSettings: Partial<ViewerSettings> = {};

                resolvedSettings.readingMode = (seriesOverride.readingMode ||
                  library.default_view_mode ||
                  globalData.viewer_reading_mode ||
                  "single") as ReadingMode;

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

                resolvedSettings.fitMode = (seriesOverride.fitMode ||
                  globalData.viewer_fit_mode ||
                  "screen") as FitMode;

                resolvedSettings.backgroundColor = seriesOverride.backgroundColor || "#000000";

                if (globalData.viewer_preload_count)
                  resolvedSettings.preloadCount = parseInt(globalData.viewer_preload_count, 10);
                if (globalData.viewer_pull_threshold)
                  resolvedSettings.pullThreshold = parseInt(globalData.viewer_pull_threshold, 10);
                if (globalData.viewer_pull_sensitivity)
                  resolvedSettings.pullSensitivity = parseFloat(globalData.viewer_pull_sensitivity);
                if (globalData.viewer_show_threshold)
                  resolvedSettings.showThreshold = parseInt(globalData.viewer_show_threshold, 10);

                initializeSettings(resolvedSettings);
                setCurrentSeriesId(loadedSeriesId);

                if (import.meta.env.DEV) {
                  console.log(`[Viewer] Settings initialized for series ${loadedSeriesId}:`, {
                    mode: resolvedSettings.readingMode,
                    dir: resolvedSettings.readingDirection,
                  });
                }
              } catch (err) {
                console.error("설정 계층 병합 로드 실패:", err);
              }
            }
          } catch (volumeErr) {
            console.warn("볼륨 정보 로드 실패:", volumeErr);
          }
        }

        // 3. 상태 업데이트
        setChapter(chapterData);
        isInitialScrollingRef.current = true;
        initPage(startPage, chapterData.page_count);

        // 4. 페이지 메타데이터 로드
        try {
          let pagesRes = await chapterAPI.getPages(chapterId);
          let pages = pagesRes.data.pages || [];

          // 분석이 필요한 페이지가 있는지 확인 (readingModeRef 사용)
          const needsAnalysis =
            readingModeRef.current !== "vertical" &&
            pages.some((page: { width: number; height: number }) => page.width === 0 || page.height === 0);

          if (needsAnalysis) {
            console.log("[Viewer] 이미지 크기 분석 필요, 분석 API 호출 중...");
            try {
              const analyzeRes = await chapterAPI.analyze(chapterId);
              if (import.meta.env.DEV) {
                console.log(
                  `[Viewer] 분석 완료: ${analyzeRes.data.analyzed_count}/${analyzeRes.data.total_pages} 페이지`,
                );
              }

              pagesRes = await chapterAPI.getPages(chapterId);
              pages = pagesRes.data.pages || [];
            } catch (analyzeErr) {
              console.warn("[Viewer] 이미지 분석 실패, 기존 데이터로 진행:", analyzeErr);
            }
          }

          const meta: PageMeta[] = pages.map((page: { page_number: number; width: number; height: number }) => ({
            pageNumber: page.page_number,
            width: page.width || 0,
            height: page.height || 0,
            isWide: page.width > 0 && page.height > 0 && page.width > page.height * WIDE_RATIO_THRESHOLD,
          }));
          setPageMeta(meta);
        } catch (metaErr) {
          console.warn("페이지 메타데이터 로드 실패 (기존 방식으로 동작):", metaErr);
          setPageMeta([]);
        }
        // 5. 완료 후 가드 해제
        if (loadingTimeoutRef.current) clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = setTimeout(() => {
          // Guard: 여전히 같은 챕터를 로딩 중인지 확인
          if (chapterId !== effectChapterId) return;

          setIsLoading(false);
          if (readingModeRef.current !== "vertical") {
            isInitialScrollingRef.current = false;
          }
        }, 100);
      } catch (err) {
        console.error("챕터 로드 실패:", err);
        setError("챕터를 불러올 수 없습니다.");
        setIsLoading(false);
      }
    };

    loadChapter();

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
      }
    };
    // seriesSettings를 의존성에서 제외:
    // 설정 변경 시 챕터 재로드를 방지하기 위함. 초기 로드에만 필요하고 readingMode 변경 시 재로드하면 안됨.
  }, [
    chapterId,
    initPage,
    initializeSettings,
    setCurrentSeriesId,
    urlPage,
    setNextChapterData,
    // 주의: settings.readingMode, seriesSettings를 제거하여 모드 변경 시 챕터 재로드 방지
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
  };
}
