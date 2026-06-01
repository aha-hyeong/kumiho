import { useEffect, useCallback, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  normalizeEpubLineHeightScale,
  useEpubViewerStore,
  EPUB_FONT_SIZE_DEFAULT,
  type EpubFontFamily,
  type EpubFlow,
  type EpubRenderMode,
  type EpubViewerSettings,
} from "../stores/epubViewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { isMobile } from "../utils/device";
import { getValidNumber } from "../utils/number";
import { startChapterSwitching } from "../stores/fullscreenSwitchStore";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { EpubViewer } from "./EpubViewer";
import { api, epubProgressAPI, libraryAPI, seriesAPI, settingAPI } from "../api/client";
import type { EpubTOCItem } from "../features/epub-viewer/components/EpubChapterViewer";
import type { UserSeriesSetting } from "../types/series";
import { AlertModal } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import {
  useAdjacentChapters,
  useExitFullscreenOnViewerUnmount,
  useRestoreFullscreenAfterChapterSwitch,
  useBGM,
} from "../features/viewer";
import { usePreventBrowserZoom } from "../features/viewer/hooks/usePreventBrowserZoom";
import { useViewerSync } from "../hooks/useViewerSync";
import { buildViewerRouteState } from "../utils/viewerRouteState";

interface EpubViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

const toPositionRatio = (position: number, total: number): number => {
  if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 1) return 0;
  return Math.max(0, Math.min(1, position / (total - 1)));
};

const toPageRatio = (page: number, total: number): number => {
  if (!Number.isFinite(page) || !Number.isFinite(total) || total <= 1) return 0;
  return Math.max(0, Math.min(1, (page - 1) / (total - 1)));
};

const toPercentPage = (ratio: number, totalPages: number): number => {
  if (!Number.isFinite(totalPages) || totalPages <= 1) return 1;
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  return Math.max(1, Math.min(totalPages, Math.round(clampedRatio * (totalPages - 1)) + 1));
};

const getHeaderValue = (headers: unknown, key: string): string | null => {
  if (!headers || typeof headers !== "object") return null;
  const maybeHeaders = headers as {
    get?: (name: string) => unknown;
    [name: string]: unknown;
  };
  const fromGetter = maybeHeaders.get?.(key);
  if (typeof fromGetter === "string") return fromGetter;
  const lowerKey = key.toLowerCase();
  const fromIndex = maybeHeaders[lowerKey] ?? maybeHeaders[key];
  return typeof fromIndex === "string" ? fromIndex : null;
};

// epub.js의 atEnd는 일부 EPUB에서 섹션 단위로 true가 될 수 있어 직접 위치 기준으로 안정화한다.
// currentPosition은 0-indexed (0 ~ totalPositions-1)
function isLocationAtEnd(location: {
  currentPosition: number;
  totalPositions: number;
  globalRatio: number;
  chapterPage: number;
  chapterTotal: number;
  spineIndex?: number;
  spineLength?: number;
  atEnd?: boolean;
}): boolean {
  if (Number.isFinite(location.totalPositions) && location.totalPositions > 1) {
    // 일부 EPUB은 마지막 spread의 첫 화면에서 이미 마지막 location을 보고할 수 있다.
    // 그래서 마지막 location 도달만으로 종료 처리하지 않고,
    // 실제 마지막 페이지/진행률/epub.js atEnd 중 하나가 함께 확인될 때만 종료로 간주한다.
    if (location.currentPosition >= location.totalPositions - 1) {
      const chapterAtEnd = location.chapterTotal > 0 && location.chapterPage >= location.chapterTotal;
      // epub.js가 마지막 위치에서 1.0 대신 약간 낮은 진행률을 반환하는 경우를 보정한다.
      const ratioAtEnd = Number.isFinite(location.globalRatio) && location.globalRatio >= 0.995;
      return chapterAtEnd || ratioAtEnd || location.atEnd === true;
    }
    return false;
  }

  if (Number.isFinite(location.globalRatio)) {
    // locations 축이 없을 때는 부동소수점 오차를 감안해 99.5% 이상을 마지막으로 본다.
    return location.globalRatio >= 0.995;
  }

  if (location.chapterTotal > 0) {
    return location.chapterPage >= location.chapterTotal;
  }

  return location.atEnd ?? false;
}

function getGeneratedTextProgressRatio(
  isGeneratedFromText: boolean,
  location: {
    chapterPage: number;
    chapterTotal: number;
    spineIndex?: number;
    spineLength?: number;
  },
  atEnd = false,
): number | null {
  if (!isGeneratedFromText) return null;
  if (atEnd) return 1;

  const sectionRatio = toPageRatio(location.chapterPage, location.chapterTotal);
  const spineLength = Number.isFinite(location.spineLength) ? Math.max(0, Math.floor(location.spineLength ?? 0)) : 0;

  if (spineLength > 0) {
    const spineIndex = Number.isFinite(location.spineIndex)
      ? Math.max(0, Math.min(spineLength - 1, Math.floor(location.spineIndex ?? 0)))
      : 0;
    return Math.max(0, Math.min(1, (spineIndex + sectionRatio) / spineLength));
  }

  if (location.chapterTotal > 1) {
    return sectionRatio;
  }

  return null;
}

const TXT_DEFAULTS = {
  theme: "dark" as const,
  fontFamily: "sans-serif" as const,
};

export function EpubViewerRoute({ loaderData }: EpubViewerRouteProps) {
  const { chapterId: routeChapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  usePreventBrowserZoom(true);
  const { chapter, seriesId, volumeId } = loaderData;
  const chapterId = chapter?.id || "";
  const [isInitializing, setIsInitializing] = useState(true);
  const [showSeriesEndModal, setShowSeriesEndModal] = useState(false);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [visiblePage, setVisiblePage] = useState(1);
  const [visibleTotalPages, setVisibleTotalPages] = useState(1);

  // BGM
  const { bgmInfo, isBgmPlaying, setIsBgmPlaying, audioRef } = useBGM({
    volumeId: volumeId || null,
    chapterId,
    isReady: !isInitializing,
  });

  const {
    currentPage,
    totalPages,
    globalProgress,
    isUIVisible,
    isSettingsOpen,
    isTOCOpen,
    isFullscreen,
    isIncognito,
    settings,
    setCurrentCFI,
    setCurrentPage,
    setTotalPages,
    setGlobalProgress,
    setIsAtFirstPage,
    setIsAtLastPage,
    toggleSettings,
    closeSettings,
    toggleTOC,
    closeTOC,
    setFullscreen,

    reset,
    setCurrentSeriesId,
    hideUI,
    showUI,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setTheme,
    setRenderMode,
    setFlow,
    setSpread,
    setWheelDirection,
    setKeyboardDirection,
    setClickDirection,
    isAtFirstPage,
    isAtLastPage,
  } = useEpubViewerStore();

  const [toc, setToc] = useState<EpubTOCItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [epubUrl, setEpubUrl] = useState<string | null>(null);
  const [loadedEpubChapterId, setLoadedEpubChapterId] = useState<string | null>(null);
  const [epubSettingsLoaded, setEpubSettingsLoaded] = useState(false);
  const [isGeneratedFromText, setIsGeneratedFromText] = useState(false);
  const [initialCFI, setInitialCFI] = useState<string | null>(null);
  const [initialProgressRatio, setInitialProgressRatio] = useState<number | null>(null);
  const isInitializingRef = useRef(true);
  const baselineCFIRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const objectUrlRevokeTimerRef = useRef<number | null>(null);
  const isInteractingRef = useRef(false);

  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const routeIsIncognito = location.state?.isIncognito === true;
  const shouldOpenLastPage = new URLSearchParams(location.search).get("page") === "last";
  const effectiveIncognito = isIncognito || routeIsIncognito;
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef<number>(0);
  const initFallbackTimerRef = useRef<number | null>(null);
  const { nextChapterId, prevChapterId, nextChapterTitle, prevChapterTitle, isAdjacentResolved } = useAdjacentChapters({
    volumeId,
    chapterId,
    seriesId,
  });
  const { terminatedInfo } = useViewerSync({
    seriesId: seriesId || "",
    chapterId: chapter?.id,
    currentPage,
    isLoading,
    enablePageProgressSync: false,
    isIncognito: effectiveIncognito,
  });

  const scheduleObjectUrlRevoke = useCallback((objectUrl: string | null, delayMs = 5000) => {
    if (!objectUrl) return;
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl);
    }, delayMs);
  }, []);

  // 초기화: 진행도 로딩 후에만 뷰어 렌더링
  useEffect(() => {
    isInitializingRef.current = true;
    baselineCFIRef.current = null;
    setIsInitializing(true);
    setVisiblePage(1);
    setVisibleTotalPages(1);
    setIsGeneratedFromText(false);
    setEpubUrl(null);
    setInitialCFI(null);
    setInitialProgressRatio(null);
    setToc([]);
    setLoadedEpubChapterId(null);
    setEpubSettingsLoaded(false);
    reset();

    // 초기화 완료 신호가 오지 않을 경우를 대비한 세이프티 폴백 (20초)
    if (initFallbackTimerRef.current) window.clearTimeout(initFallbackTimerRef.current);
    initFallbackTimerRef.current = window.setTimeout(() => {
      if (isInitializingRef.current) {
        console.warn("[EpubViewerRoute] Initialization fallback (Signal timeout)");
        setIsInitializing(false);
        isInitializingRef.current = false;
      }
    }, 20000);

    let cancelled = false;

    const fetchProgress = async () => {
      if (chapterId) {
        if (shouldOpenLastPage) {
          setInitialCFI(null);
          setInitialProgressRatio(1);
          setGlobalProgress(100);
        } else {
          try {
            const chapterRes = await epubProgressAPI.get(chapterId);
            if (cancelled) return;
            const chapterProgress = chapterRes.data.progress;
            const hasSavedCFI =
              typeof chapterProgress?.current_cfi === "string" && chapterProgress.current_cfi.trim().length > 0;

            if (hasSavedCFI) {
              setInitialCFI(chapterProgress.current_cfi);
              setCurrentCFI(chapterProgress.current_cfi);
            } else {
              setInitialCFI(null);
            }

            if (chapterProgress?.progress_percent !== undefined) {
              setGlobalProgress(chapterProgress.progress_percent);
              // current_cfi가 있으면 위치 복원은 CFI를 우선 사용하고,
              // progress_percent는 UI 표시용으로만 유지한다.
              setInitialProgressRatio(
                hasSavedCFI ? null : Math.max(0, Math.min(1, chapterProgress.progress_percent / 100)),
              );
            } else {
              setInitialProgressRatio(null);
            }
          } catch (error) {
            if (cancelled) return;
            console.error("[EpubViewerRoute] Failed to load progress:", error);
            setInitialCFI(null);
            setInitialProgressRatio(null);
          }
        }

        try {
          const response = await api.get(`/chapters/${chapterId}/epub`, { responseType: "blob" });
          if (cancelled) return;
          const sourceFormat = getHeaderValue(response.headers, "x-kumiho-source-format");
          setIsGeneratedFromText(sourceFormat?.toLowerCase() === "txt");
          const objectUrl = URL.createObjectURL(response.data);
          if (objectUrlRevokeTimerRef.current) {
            window.clearTimeout(objectUrlRevokeTimerRef.current);
            objectUrlRevokeTimerRef.current = null;
          }
          if (objectUrlRef.current) {
            const previousObjectUrl = objectUrlRef.current;
            objectUrlRevokeTimerRef.current = window.setTimeout(() => {
              URL.revokeObjectURL(previousObjectUrl);
              if (objectUrlRevokeTimerRef.current) {
                objectUrlRevokeTimerRef.current = null;
              }
            }, 5000);
          }
          objectUrlRef.current = objectUrl;
          setEpubUrl(objectUrl);
          setLoadedEpubChapterId(chapterId);
        } catch (error) {
          if (cancelled) return;
          console.error("[EpubViewerRoute] Failed to load epub blob:", error);
          setEpubUrl(null);
          setLoadedEpubChapterId(null);
        } finally {
          if (!cancelled) {
            setIsLoading(false);
          }
        }
      } else {
        setInitialCFI(null);
        setEpubUrl(null);
        setLoadedEpubChapterId(null);
        setIsLoading(false);
        setIsInitializing(false);
        isInitializingRef.current = false;
      }
    };

    fetchProgress();

    return () => {
      cancelled = true;
      if (objectUrlRevokeTimerRef.current) {
        window.clearTimeout(objectUrlRevokeTimerRef.current);
        objectUrlRevokeTimerRef.current = null;
      }
      if (objectUrlRef.current) {
        scheduleObjectUrlRevoke(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [chapterId, reset, scheduleObjectUrlRevoke, setCurrentCFI, setGlobalProgress, shouldOpenLastPage]);

  // EPUB 뷰어 사용자 설정 로드
  const chapterPath = chapter?.path ?? "";

  useEffect(() => {
    if (!chapterId || loaderData.isLoading) return;
    let cancelled = false;
    setEpubSettingsLoaded(false);

    const loadEpubSettings = async () => {
      try {
        // 시리즈 ID 설정 (이후 사용자 설정 변경 시 시리즈별로 추적)
        setCurrentSeriesId(seriesId || null);

        const userSettings = await settingAPI.list();
        if (cancelled) return;
        const isMobileDevice = isMobile();
        const fontSizeKey = isMobileDevice ? "epub_font_size_mobile" : "epub_font_size";
        const lineHeightKey = isMobileDevice ? "epub_line_height_mobile" : "epub_line_height";
        const globalRenderMode = userSettings.epub_render_mode;
        const fontSize = getValidNumber(userSettings[fontSizeKey] ?? userSettings.epub_font_size);
        const lineHeight = getValidNumber(userSettings[lineHeightKey] ?? userSettings.epub_line_height);
        const fontFamily = userSettings.epub_font_family;
        const theme = userSettings.epub_theme;
        const flow = userSettings.epub_flow;
        const spread = userSettings.epub_spread;
        const wheelDirection = userSettings.epub_wheel_direction;
        const keyboardDirection = userSettings.epub_keyboard_direction;
        const clickDirection = userSettings.epub_click_direction;
        const globalClickDirection = userSettings.viewer_click_direction;
        const legacyWheelNavigation = userSettings.epub_wheel_navigation;
        const legacyKeyboardNavigation = userSettings.epub_keyboard_navigation;

        let libraryDefaults: {
          default_epub_render_mode?: string;
          default_epub_theme?: string;
          default_epub_spread?: string;
          default_epub_wheel_direction?: string;
          default_epub_keyboard_direction?: string;
          default_epub_click_direction?: string;
        } = {};
        let seriesSettings: Partial<UserSeriesSetting> = {};

        // TXT 파일 여부 확인 (TXT 전용 기본값 적용용)
        const isTextFile = chapterPath.toLowerCase().endsWith(".txt");

        if (seriesId) {
          try {
            const seriesRes = await seriesAPI.get(seriesId);
            if (cancelled) return;
            const libraryId = seriesRes?.data?.library_id;
            if (libraryId) {
              const libraryRes = await libraryAPI.get(libraryId);
              if (cancelled) return;
              libraryDefaults = libraryRes?.data || {};
            }
          } catch (libraryError) {
            if (cancelled) return;
            console.warn("[EpubViewerRoute] Failed to load library defaults:", libraryError);
          }

          try {
            seriesSettings = await seriesAPI.getViewerSettings(seriesId);
            if (cancelled) return;
          } catch (seriesError) {
            if (cancelled) return;
            console.warn("[EpubViewerRoute] Failed to load series viewer settings:", seriesError);
          }
        }

        const effectiveRenderMode =
          seriesSettings.epub_render_mode ||
          libraryDefaults.default_epub_render_mode ||
          globalRenderMode ||
          "auto";
        if (effectiveRenderMode === "auto" || effectiveRenderMode === "book" || effectiveRenderMode === "comic") {
          setRenderMode(effectiveRenderMode);
        }

        const effectiveTheme =
          seriesSettings.epub_theme || libraryDefaults.default_epub_theme || theme || (isTextFile ? TXT_DEFAULTS.theme : "light");
        if (effectiveTheme === "light" || effectiveTheme === "dark" || effectiveTheme === "sepia") {
          setTheme(effectiveTheme);
        }

        const effectiveFontSize =
          seriesSettings.epub_font_size ||
          fontSize ||
          EPUB_FONT_SIZE_DEFAULT;
        if (Number.isFinite(effectiveFontSize) && effectiveFontSize >= 50 && effectiveFontSize <= 150) {
          setFontSize(effectiveFontSize);
        }

        const rawLineHeight = seriesSettings.epub_line_height || lineHeight;
        const normalizedLineHeight = normalizeEpubLineHeightScale(rawLineHeight);
        if (normalizedLineHeight != null) {
          setLineHeight(normalizedLineHeight);
        }

        const effectiveFontFamily =
          seriesSettings.epub_font_family ||
          fontFamily ||
          (isTextFile ? TXT_DEFAULTS.fontFamily : "original");
        if (effectiveFontFamily === "original" || effectiveFontFamily === "serif" || effectiveFontFamily === "sans-serif") {
          setFontFamily(effectiveFontFamily);
        }

        const effectiveFlow =
          seriesSettings.epub_flow || flow || "paginated";
        if (effectiveFlow === "paginated" || effectiveFlow === "scrolled") {
          setFlow(effectiveFlow);
        }

        const effectiveSpread =
          seriesSettings.epub_spread ||
          libraryDefaults.default_epub_spread ||
          spread ||
          "auto";
        if (effectiveSpread === "auto" || effectiveSpread === "none") {
          setSpread(effectiveSpread);
        }

        const effectiveWheelDirection =
          seriesSettings.epub_wheel_direction ||
          libraryDefaults.default_epub_wheel_direction ||
          wheelDirection ||
          "down";
        if (effectiveWheelDirection === "down" || effectiveWheelDirection === "up") {
          setWheelDirection(effectiveWheelDirection);
        }

        const effectiveKeyboardDirection =
          seriesSettings.epub_keyboard_direction ||
          libraryDefaults.default_epub_keyboard_direction ||
          keyboardDirection ||
          "right";
        if (effectiveKeyboardDirection === "right" || effectiveKeyboardDirection === "left") {
          setKeyboardDirection(effectiveKeyboardDirection);
        }

        const effectiveClickDirection =
          seriesSettings.epub_click_direction ||
          libraryDefaults.default_epub_click_direction ||
          clickDirection ||
          (globalClickDirection === "ltr" ? "right" : globalClickDirection === "rtl" ? "left" : "right");
        if (effectiveClickDirection === "right" || effectiveClickDirection === "left") {
          setClickDirection(effectiveClickDirection);
        }

        // 하위 호환: 기존 ON/OFF 설정이 있으면 기본 방향으로 매핑
        if (legacyWheelNavigation === "false") {
          setWheelDirection("down");
        }
        if (legacyKeyboardNavigation === "false") {
          setKeyboardDirection("right");
        }

      } catch (error) {
        if (cancelled) return;
        console.warn("[EpubViewerRoute] Failed to load EPUB user settings:", error);
      } finally {
        if (!cancelled) {
          setEpubSettingsLoaded(true);
        }
      }
    };

    void loadEpubSettings();
    return () => {
      cancelled = true;
    };
  }, [
    chapterId,
    chapterPath,
    seriesId,
    loaderData.isLoading,
    setCurrentSeriesId,
    setFontFamily,
    setFontSize,
    setLineHeight,
    setTheme,
    setRenderMode,
    setFlow,
    setSpread,
    setWheelDirection,
    setKeyboardDirection,
    setClickDirection,
  ]);

  // 뷰어 종료 시 시리즈 ID 초기화
  useEffect(() => {
    return () => {
      setCurrentSeriesId(null);
    };
  }, [setCurrentSeriesId]);

  // 전체화면 브라우저 이벤트 동기화
  useEffect(() => {
    const handleFSChange = () => {
      const actual = isDocumentFullscreen();
      if (isFullscreen !== actual) {
        setFullscreen(actual);
      }
    };
    const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange"];
    events.forEach((e) => document.addEventListener(e, handleFSChange));
    return () => {
      events.forEach((e) => document.removeEventListener(e, handleFSChange));
    };
  }, [isFullscreen, setFullscreen]);
  useRestoreFullscreenAfterChapterSwitch(routeChapterId);
  useExitFullscreenOnViewerUnmount();

  // 뷰어 종료 시 타이머 정리
  useEffect(() => {
    return () => {
      if (initFallbackTimerRef.current) window.clearTimeout(initFallbackTimerRef.current);
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
      if (objectUrlRevokeTimerRef.current) {
        window.clearTimeout(objectUrlRevokeTimerRef.current);
        objectUrlRevokeTimerRef.current = null;
      }
    };
  }, []);

  // UI가 표시될 때 시작 시간 기록
  useEffect(() => {
    if (isUIVisible) {
      uiShownTimeRef.current = Date.now();
    }
  }, [isUIVisible]);

  // UI 자동 숨김 타이머
  const resetUITimer = useCallback(() => {
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    if (!isSettingsOpen && !isInteractingRef.current) {
      uiTimerRef.current = window.setTimeout(() => {
        hideUI();
      }, 3000);
    }
  }, [isSettingsOpen, hideUI]);

  const handleInteractionStart = useCallback(() => {
    isInteractingRef.current = true;
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    isInteractingRef.current = false;
    if (isUIVisible) {
      const now = Date.now();
      const elapsed = now - uiShownTimeRef.current;
      // UI_HIDE_DELAY (2000ms 또는 3000ms 등) 이상 이미 노출된 상태에서 호버가 끝났다면 즉시 숨김
      if (elapsed >= 3000) {
        hideUI();
      } else {
        resetUITimer();
      }
    }
  }, [isUIVisible, resetUITimer, hideUI]);

  // 클릭 시 UI 토글
  const toggleUIWithTimer = useCallback(() => {
    if (isUIVisible) {
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
      hideUI();
    } else {
      showUI();
      uiShownTimeRef.current = Date.now();
      resetUITimer();
    }
  }, [isUIVisible, resetUITimer, hideUI, showUI]);

  const handleViewerClick = useCallback(() => {
    toggleUIWithTimer();
  }, [toggleUIWithTimer]);

  // 진행도 저장 (EPUB은 CFI 및 가상 포지션 기반 저장)
  const canSaveProgress = useCallback((location: { currentPosition: number; totalPositions: number }) => {
    const totalPositions = Math.max(0, location.totalPositions);
    if (totalPositions <= 1) {
      return false;
    }

    return true;
  }, []);

  const toPseudoProgressPayload = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
    }) => {
      const fallbackTotalPages = 100;
      let fallbackRatio: number | null = null;

      if (Number.isFinite(location.globalRatio)) {
        fallbackRatio = Math.max(0, Math.min(0.99, location.globalRatio));
      } else if (location.chapterTotal > 1 && location.chapterPage > 0) {
        fallbackRatio = Math.max(0, Math.min(0.99, location.chapterPage / location.chapterTotal));
      }

      if (fallbackRatio === null) {
        return null;
      }

      const currentPage = Math.max(1, Math.min(fallbackTotalPages - 1, Math.round(fallbackRatio * fallbackTotalPages)));
      const progressPercent = (currentPage / fallbackTotalPages) * 100;

      return {
        current_page: currentPage,
        total_pages: fallbackTotalPages,
        progress_percent: progressPercent,
        current_position: 0,
        total_positions: 0,
        current_cfi: location.cfi,
      };
    },
    [],
  );

  const saveProgress = useCallback(
    async (
      location: {
        cfi: string;
        chapterPage: number;
        chapterTotal: number;
        globalRatio: number;
        currentPosition: number;
        totalPositions: number;
        spineIndex?: number;
        spineLength?: number;
      },
      atEnd = false,
    ) => {
      if (isInitializingRef.current || effectiveIncognito) {
        return;
      }

      const generatedTextRatio = getGeneratedTextProgressRatio(isGeneratedFromText, location, atEnd);
      const payload =
        generatedTextRatio !== null
          ? (() => {
              const totalPages = 100;
              const currentPage = atEnd ? totalPages : toPercentPage(generatedTextRatio, totalPages);
              return {
                current_page: currentPage,
                total_pages: totalPages,
                progress_percent: Math.max(0, Math.min(100, generatedTextRatio * 100)),
                current_position: Math.max(0, currentPage - 1),
                total_positions: totalPages,
                current_cfi: location.cfi,
              };
            })()
          : canSaveProgress(location)
            ? (() => {
                const totalPositions = Math.max(0, location.totalPositions);
                // atEnd일 때는 마지막 위치로 보정하여 100% 저장 (완독 처리)
                const currentPosition = atEnd
                  ? Math.max(0, totalPositions - 1)
                  : Math.max(0, Math.min(totalPositions - 1, location.currentPosition));
                const calculatedCurrentPage = currentPosition + 1;
                const calculatedTotalPages = totalPositions;
                const progressPercent = atEnd ? 100 : toPositionRatio(currentPosition, calculatedTotalPages) * 100;

                return {
                  current_page: calculatedCurrentPage,
                  total_pages: calculatedTotalPages,
                  progress_percent: progressPercent,
                  current_position: currentPosition,
                  total_positions: totalPositions,
                  current_cfi: location.cfi,
                };
              })()
            : toPseudoProgressPayload(location);

      if (!payload) {
        return;
      }

      try {
        await epubProgressAPI.update(chapterId, payload);
      } catch (error) {
        console.error("Failed to save progress:", error);
      }
    },
    [canSaveProgress, chapterId, effectiveIncognito, isGeneratedFromText, toPseudoProgressPayload],
  );

  const handleLocationChange = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
      chapterHref: string;
      spineIndex?: number;
      spineLength?: number;
      atStart?: boolean;
      atEnd?: boolean;
    }) => {
      setCurrentCFI(location.cfi);
      setIsAtFirstPage(location.atStart ?? false);
      const atEnd = isLocationAtEnd(location);
      setIsAtLastPage(atEnd);

      const resolvedVisibleTotal =
        location.chapterTotal > 0 ? Math.max(1, location.chapterTotal) : Math.max(1, location.totalPositions || 1);
      const resolvedVisiblePage =
        location.chapterTotal > 0
          ? Math.max(1, Math.min(resolvedVisibleTotal, location.chapterPage || 1))
          : Math.max(1, Math.min(resolvedVisibleTotal, (location.currentPosition || 0) + 1));
      setVisiblePage(resolvedVisiblePage);
      setVisibleTotalPages(resolvedVisibleTotal);

      // isInitializingRef.current 사용으로 stale closure 방지
      if (isInitializingRef.current) {
        return;
      }

      const generatedTextRatio = getGeneratedTextProgressRatio(isGeneratedFromText, location, atEnd);
      // totalPositions가 1 이하면 페이지 축으로는 신뢰하지 않고 chapter 축을 우선 사용한다.
      if (generatedTextRatio !== null) {
        const pseudoTotalPages = 100;
        setCurrentPage(toPercentPage(generatedTextRatio, pseudoTotalPages));
        setTotalPages(pseudoTotalPages);
        setGlobalProgress(Math.max(0, Math.min(100, generatedTextRatio * 100)));
      } else if (location.totalPositions > 1) {
        // atEnd일 때는 마지막 위치로 보정하여 100%로 저장
        const clampedPosition = atEnd
          ? location.totalPositions - 1
          : Math.max(0, Math.min(location.totalPositions - 1, location.currentPosition));
        setCurrentPage(clampedPosition + 1);
        setTotalPages(location.totalPositions);
        setGlobalProgress(atEnd ? 100 : toPositionRatio(clampedPosition, location.totalPositions) * 100);
      } else {
        // locations 축이 신뢰 불가할 때는 section(page) 축보다 globalRatio 축을 우선 사용한다.
        // chapterTotal/chapterPage는 섹션 단위 값이라 조기 "마지막 페이지" 판정을 만들 수 있다.
        if (Number.isFinite(location.globalRatio)) {
          const clampedRatio = atEnd ? 1 : Math.max(0, Math.min(1, location.globalRatio));
          setGlobalProgress(clampedRatio * 100);
          const pseudoTotalPages = 100;
          const pseudoCurrentPage = Math.max(1, Math.round(clampedRatio * pseudoTotalPages));
          setCurrentPage(pseudoCurrentPage);
          setTotalPages(pseudoTotalPages);
        } else if (location.chapterTotal > 0) {
          const clampedChapterTotal = Math.max(1, location.chapterTotal);
          const clampedChapterPage = atEnd
            ? clampedChapterTotal
            : Math.max(1, Math.min(clampedChapterTotal, location.chapterPage || 1));
          const chapterRatio = clampedChapterPage / clampedChapterTotal;
          setCurrentPage(clampedChapterPage);
          setTotalPages(clampedChapterTotal);
          setGlobalProgress(chapterRatio * 100);
        }
      }

      // 초기화 후 첫 위치를 baseline으로 잡고, 같은 CFI에서는 저장하지 않는다.
      // (초기 relocated가 beginning CFI를 반복 전달해 기존 위치를 덮어쓰는 문제 방지)
      if (!baselineCFIRef.current) {
        // 초기 위치 저장 보호: 기존 진행률이 있는데 0% 근처라면 저장하지 않음 (레이스 보호)
        const effectiveProgressRatio = generatedTextRatio ?? location.globalRatio;
        const isAtBeginning = effectiveProgressRatio < 0.02 && location.currentPosition <= 0;
        const hadSavedProgress = initialCFI !== null || (initialProgressRatio !== null && initialProgressRatio > 0.02);
        if (isAtBeginning && hadSavedProgress) {
          return;
        }

        baselineCFIRef.current = location.cfi;
        void saveProgress(location, atEnd);
        return;
      }
      if (baselineCFIRef.current === location.cfi) {
        return;
      }

      void saveProgress(location, atEnd);
    },
    [
      setCurrentCFI,
      setCurrentPage,
      setTotalPages,
      setGlobalProgress,
      setIsAtFirstPage,
      setIsAtLastPage,
      saveProgress,
      initialCFI,
      initialProgressRatio,
      isGeneratedFromText,
    ],
  );

  const handleInitializationComplete = useCallback(() => {
    if (initFallbackTimerRef.current) {
      window.clearTimeout(initFallbackTimerRef.current);
      initFallbackTimerRef.current = null;
    }
    setIsInitializing(false);
    isInitializingRef.current = false;
    loaderData.setViewStatus?.("ready");
  }, [loaderData]);

  const handleReady = useCallback(
    (total: number) => {
      // total=1은 일부 EPUB에서 locations 축이 신뢰 불가한 값일 수 있어
      // relocated의 chapter 축 동기화를 우선 사용한다.
      if (total > 1) setTotalPages(total);
    },
    [setTotalPages],
  );

  const handleTOCLoad = useCallback((loadedTOC: EpubTOCItem[]) => {
    setToc(loadedTOC);
  }, []);

  const runOptimisticUpdate = useCallback(
    <K extends keyof EpubViewerSettings>(
      key: K,
      value: EpubViewerSettings[K],
      setter: (v: EpubViewerSettings[K]) => void,
      apiCall: () => Promise<unknown>,
    ) => {
      const store = useEpubViewerStore.getState();
      const prev = store.settings[key];
      const snapshotSeriesId = seriesId;

      setter(value);

      apiCall().catch((error) => {
        console.warn(`[EpubViewerRoute] Failed to save ${key}, rolling back:`, error);
        
        const currentStore = useEpubViewerStore.getState();
        
        if (snapshotSeriesId) {
          // Revert seriesSettings[snapshotSeriesId] if it hasn't been changed to a newer value
          const seriesConf = currentStore.seriesSettings[snapshotSeriesId];
          if (seriesConf && seriesConf[key] === value) {
            currentStore.updateSeriesSetting(snapshotSeriesId, { [key]: prev });
          }
          
          // Revert active settings in the viewer if the user is still on the same series
          // and the current setting value hasn't been changed to a newer value
          if (currentStore.currentSeriesId === snapshotSeriesId && currentStore.settings[key] === value) {
            setter(prev);
          }
        } else {
          // Global settings rollback: revert only if the active setting matches the optimistic value
          if (currentStore.settings[key] === value) {
            setter(prev);
          }
        }
      });
    },
    [seriesId],
  );

  const handleFontSizeChange = useCallback(
    (size: number) => {
      runOptimisticUpdate(
        "fontSize",
        size,
        setFontSize,
        () => !seriesId
          ? settingAPI.update(isMobile() ? "epub_font_size_mobile" : "epub_font_size", { value: String(size) })
          : seriesAPI.updateViewerSettings(seriesId, { epub_font_size: size })
      );
    },
    [seriesId, setFontSize, runOptimisticUpdate],
  );

  const handleFontFamilyChange = useCallback(
    (family: EpubFontFamily) => {
      runOptimisticUpdate(
        "fontFamily",
        family,
        setFontFamily,
        () => !seriesId
          ? settingAPI.update("epub_font_family", { value: family })
          : seriesAPI.updateViewerSettings(seriesId, { epub_font_family: family })
      );
    },
    [seriesId, setFontFamily, runOptimisticUpdate],
  );

  const handleLineHeightChange = useCallback(
    (height: number) => {
      runOptimisticUpdate(
        "lineHeight",
        height,
        setLineHeight,
        () => !seriesId
          ? settingAPI.update(isMobile() ? "epub_line_height_mobile" : "epub_line_height", { value: String(height) })
          : seriesAPI.updateViewerSettings(seriesId, { epub_line_height: height })
      );
    },
    [seriesId, setLineHeight, runOptimisticUpdate],
  );

  const handleThemeChange = useCallback(
    (themeVal: "light" | "dark" | "sepia") => {
      runOptimisticUpdate(
        "theme",
        themeVal,
        setTheme,
        () => !seriesId
          ? settingAPI.update("epub_theme", { value: themeVal })
          : seriesAPI.updateViewerSettings(seriesId, { epub_theme: themeVal })
      );
    },
    [seriesId, setTheme, runOptimisticUpdate],
  );

  const handleSpreadChange = useCallback(
    (spread: "auto" | "none") => {
      setSpread(spread);
      if (!seriesId) {
        void settingAPI.update("epub_spread", { value: spread }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_spread:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_spread: spread }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_spread:", error);
      });
    },
    [seriesId, setSpread],
  );

  const handleFlowChange = useCallback(
    (flow: EpubFlow) => {
      setFlow(flow);
      if (!seriesId) {
        void settingAPI.update("epub_flow", { value: flow }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_flow:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_flow: flow }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_flow:", error);
      });
    },
    [seriesId, setFlow],
  );

  const handleWheelDirectionChange = useCallback(
    (direction: "down" | "up") => {
      setWheelDirection(direction);
      if (!seriesId) {
        void settingAPI.update("epub_wheel_direction", { value: direction }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_wheel_direction:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_wheel_direction: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_wheel_direction:", error);
      });
    },
    [seriesId, setWheelDirection],
  );

  const handleRenderModeChange = useCallback(
    (mode: EpubRenderMode) => {
      setRenderMode(mode);
      if (!seriesId) {
        void settingAPI.update("epub_render_mode", { value: mode }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_render_mode:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_render_mode: mode }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_render_mode:", error);
      });
    },
    [seriesId, setRenderMode],
  );

  const handleKeyboardDirectionChange = useCallback(
    (direction: "right" | "left") => {
      setKeyboardDirection(direction);
      if (!seriesId) {
        void settingAPI.update("epub_keyboard_direction", { value: direction }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_keyboard_direction:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_keyboard_direction: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_keyboard_direction:", error);
      });
    },
    [seriesId, setKeyboardDirection],
  );

  const handleClickDirectionChange = useCallback(
    (direction: "right" | "left") => {
      setClickDirection(direction);
      if (!seriesId) {
        void settingAPI.update("epub_click_direction", { value: direction }).catch((error) => {
          console.warn("[EpubViewerRoute] Failed to save global epub_click_direction:", error);
        });
        return;
      }
      void seriesAPI.updateViewerSettings(seriesId, { epub_click_direction: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save series epub_click_direction:", error);
      });
    },
    [seriesId, setClickDirection],
  );

  const handleBack = useCallback(() => {
    if (viewerFrom) {
      navigate(viewerFrom, { replace: true });
    } else {
      navigate(-1);
    }
  }, [navigate, viewerFrom]);

  const handleReachedSeriesEnd = useCallback(() => {
    if (isAdjacentResolved) {
      setShowSeriesEndModal(true);
    }
  }, [isAdjacentResolved]);

  const handleNextAtEnd = useCallback(() => {
    if (nextChapterId) {
      startChapterSwitching(isDocumentFullscreen());
      navigate(`/viewer/${nextChapterId}`, {
        state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
      });
      return;
    }
    handleReachedSeriesEnd();
  }, [nextChapterId, navigate, handleReachedSeriesEnd, viewerFrom, routeIsIncognito]);

  const handlePrevAtStart = useCallback(() => {
    if (prevChapterId) {
      startChapterSwitching(isDocumentFullscreen());
      navigate(`/viewer/${prevChapterId}?page=last`, {
        state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
      });
    }
  }, [prevChapterId, navigate, viewerFrom, routeIsIncognito]);

  const handleTerminatedConfirm = useCallback(() => {
    if (viewerFrom) {
      navigate(viewerFrom, { replace: true });
      return;
    }
    navigate("/");
  }, [navigate, viewerFrom]);

  const handleToggleFullscreen = useCallback(() => {
    try {
      if (!isDocumentFullscreen()) {
        enterFullscreen().catch(() => {});
      } else {
        exitFullscreen().catch(() => {});
      }
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    }
  }, []);

  // 챕터 정보/진행도 로딩까지만 대기하고, 이후 뷰어 초기화는 컴포넌트 내부에서 진행
  if (isLoading || !chapter || !epubUrl || loadedEpubChapterId !== chapterId || !epubSettingsLoaded) {
    return (
      <div style={{ width: "100%", height: "100vh" }}>
        <LoadingSpinner
          fullScreen
          text={t("epub_viewer.loading")}
        />
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh" }}>
      {isInitializing && (
        <LoadingSpinner
          fullScreen
          text={t("epub_viewer.loading")}
        />
      )}
      <div
        style={{
          opacity: isInitializing ? 0 : 1,
          pointerEvents: isInitializing ? "none" : "auto",
          height: "100%",
        }}
      >
        {bgmInfo?.exists && bgmInfo.url && (
          <audio
            ref={audioRef}
            src={bgmInfo.url}
            playsInline
          />
        )}
        <EpubViewer
          key={chapterId}
          chapterTitle={chapter?.title || ""}
          chapterId={chapterId}
          epubUrl={epubUrl}
          initialCFI={initialCFI}
          initialProgressRatio={initialProgressRatio}
          initialOpenMode={shouldOpenLastPage ? "last" : "default"}
          currentPage={currentPage}
          totalPages={totalPages}
          visiblePage={visiblePage}
          visibleTotalPages={visibleTotalPages}
          globalProgress={globalProgress}
          isUIVisible={isUIVisible}
          isSettingsOpen={isSettingsOpen}
          isTOCOpen={isTOCOpen}
          isFullscreen={isFullscreen}
          isIncognito={effectiveIncognito}
          isAtFirstPage={isAtFirstPage}
          isAtLastPage={isAtLastPage}
          toc={toc}
          settings={settings}
          onBack={handleBack}
          onToggleSettings={toggleSettings}
          onCloseSettings={closeSettings}
          onToggleTOC={toggleTOC}
          onCloseTOC={closeTOC}
          onToggleFullscreen={handleToggleFullscreen}
          onReady={handleReady}
          onTOCLoad={handleTOCLoad}
          onLocationChange={handleLocationChange}
          onViewerClick={handleViewerClick}
          onInitializationComplete={handleInitializationComplete}
          onFontSizeChange={handleFontSizeChange}
          onFontFamilyChange={handleFontFamilyChange}
          onLineHeightChange={handleLineHeightChange}
          onThemeChange={handleThemeChange}
          onRenderModeChange={handleRenderModeChange}
          onFlowChange={handleFlowChange}
          hideChapterPageInfo={isGeneratedFromText}
          onWheelDirectionChange={handleWheelDirectionChange}
          onKeyboardDirectionChange={handleKeyboardDirectionChange}
          onClickDirectionChange={handleClickDirectionChange}
          onSpreadChange={handleSpreadChange}
          onReachedEndNext={handleNextAtEnd}
          isEndNavigationReady={isAdjacentResolved}
          onReachedStartPrev={prevChapterId ? handlePrevAtStart : undefined}
          isStartNavigationReady={isAdjacentResolved}
          nextChapterTitle={nextChapterTitle}
          prevChapterTitle={prevChapterTitle}
          bgmInfo={bgmInfo}
          isBgmPlaying={isBgmPlaying}
          onToggleBgm={() => setIsBgmPlaying((prev) => !prev)}
          seriesId={seriesId || ""}
          isChapterListOpen={isChapterListOpen}
          onOpenChapterList={() => setIsChapterListOpen(true)}
          onCloseChapterList={() => setIsChapterListOpen(false)}
          onChapterNavigate={(id) => {
            navigate(`/viewer/${id}`, {
              state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
              replace: true,
            });
          }}
          onInteractionStart={handleInteractionStart}
          onInteractionEnd={handleInteractionEnd}
        />
      </div>
      <AlertModal
        isOpen={terminatedInfo.isOpen}
        type="warning"
        title={t("viewer.session.force_logout_title")}
        message={terminatedInfo.reason}
        onConfirm={handleTerminatedConfirm}
      />
      <AlertModal
        isOpen={showSeriesEndModal}
        type="info"
        title={t("viewer.series_end.title", { defaultValue: "책의 마지막입니다." })}
        message={t("viewer.series_end.message", { defaultValue: "확인을 누르면 이전 화면으로 이동합니다." })}
        confirmText={t("common.confirm")}
        cancelText={t("common.cancel")}
        showCancel={true}
        onConfirm={handleBack}
        onCancel={() => setShowSeriesEndModal(false)}
      />
    </div>
  );
}
