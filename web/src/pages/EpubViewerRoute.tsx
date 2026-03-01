import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEpubViewerStore, type EpubFontFamily, type EpubRenderMode } from "../stores/epubViewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { EpubViewer } from "./EpubViewer";
import { api, epubProgressAPI, seriesAPI, settingAPI } from "../api/client";
import type { EpubTOCItem } from "../features/epub-viewer/components/EpubChapterViewer";
import { AlertModal } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { useAdjacentChapters } from "../features/viewer";

interface EpubViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

const toPositionRatio = (position: number, total: number): number => {
  if (!Number.isFinite(position) || !Number.isFinite(total) || total <= 1) return 0;
  return Math.max(0, Math.min(1, position / (total - 1)));
};

export function EpubViewerRoute({ loaderData }: EpubViewerRouteProps) {
  const { t } = useTranslation();
  const { chapter, seriesId, volumeId } = loaderData;
  const chapterId = chapter?.id || "";
  const [, setIsInitializing] = useState(true);
  const [showSeriesEndModal, setShowSeriesEndModal] = useState(false);

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
    toggleSettings,
    closeSettings,
    toggleTOC,
    closeTOC,
    setFullscreen,
    setIncognito,
    reset,
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
  } = useEpubViewerStore();

  const [toc, setToc] = useState<EpubTOCItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [epubUrl, setEpubUrl] = useState<string | null>(null);
  const [initialCFI, setInitialCFI] = useState<string | null>(null);
  const [initialProgressRatio, setInitialProgressRatio] = useState<number | null>(null);
  const isInitializingRef = useRef(true);
  const baselineCFIRef = useRef<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const isInteractingRef = useRef(false);

  const navigate = useNavigate();
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef<number>(0);
  const initFallbackTimerRef = useRef<number | null>(null);
  const { nextChapterId, isAdjacentResolved } = useAdjacentChapters({
    volumeId,
    chapterId,
    seriesId,
  });

  // 초기화: 진행도 로딩 후에만 뷰어 렌더링
  useEffect(() => {
    isInitializingRef.current = true;
    baselineCFIRef.current = null;
    setIsInitializing(true);
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

    const fetchProgress = async () => {
      if (chapterId) {
        try {
          const chapterRes = await epubProgressAPI.get(chapterId);
          const chapterProgress = chapterRes.data.progress;

          if (chapterProgress?.current_cfi) {
            setInitialCFI(chapterProgress.current_cfi);
            setCurrentCFI(chapterProgress.current_cfi);
          } else {
            setInitialCFI(null);
          }

          if (chapterProgress?.progress_percent !== undefined) {
            setGlobalProgress(chapterProgress.progress_percent);
            setInitialProgressRatio(Math.max(0, Math.min(1, chapterProgress.progress_percent / 100)));
          } else {
            setInitialProgressRatio(null);
          }
        } catch (error) {
          console.error("[EpubViewerRoute] Failed to load progress:", error);
          setInitialCFI(null);
          setInitialProgressRatio(null);
        }

        try {
          const response = await api.get(`/chapters/${chapterId}/epub`, { responseType: "blob" });
          const objectUrl = URL.createObjectURL(response.data);
          if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current);
          }
          objectUrlRef.current = objectUrl;
          setEpubUrl(objectUrl);
        } catch (error) {
          console.error("[EpubViewerRoute] Failed to load epub blob:", error);
          setEpubUrl(null);
        } finally {
          setIsLoading(false);
          // 뷰어 자체의 초기화 완료 대기로 변경 (기존 setTimeout 제거)
        }
      } else {
        setInitialCFI(null);
        setEpubUrl(null);
        setIsLoading(false);
        setIsInitializing(false);
        isInitializingRef.current = false;
      }
    };

    fetchProgress();

    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [chapterId, reset, setCurrentCFI, setGlobalProgress]);

  // 시크릿 모드 설정
  useEffect(() => {
    setIncognito(false);
  }, [setIncognito]);

  // 스크롤 모드 제거: 기존 상태가 scrolled이면 자동으로 페이지 모드로 보정
  useEffect(() => {
    if (settings.flow !== "paginated") {
      setFlow("paginated");
    }
  }, [settings.flow, setFlow]);

  // EPUB 뷰어 사용자 설정 로드
  useEffect(() => {
    if (!chapterId) return;
    let cancelled = false;

    const loadEpubSettings = async () => {
      try {
        const userSettings = await settingAPI.list();
        if (cancelled) return;
        const fontSize = Number(userSettings.epub_font_size);
        const lineHeight = Number(userSettings.epub_line_height);
        const fontFamily = userSettings.epub_font_family;
        const theme = userSettings.epub_theme;
        const spread = userSettings.epub_spread;
        const wheelDirection = userSettings.epub_wheel_direction;
        const keyboardDirection = userSettings.epub_keyboard_direction;
        const clickDirection = userSettings.epub_click_direction;
        const globalClickDirection = userSettings.viewer_click_direction;
        const legacyWheelNavigation = userSettings.epub_wheel_navigation;
        const legacyKeyboardNavigation = userSettings.epub_keyboard_navigation;

        if (Number.isFinite(fontSize) && fontSize >= 50 && fontSize <= 150) {
          setFontSize(fontSize);
        }
        if (Number.isFinite(lineHeight) && lineHeight >= 1.2 && lineHeight <= 2.0) {
          setLineHeight(lineHeight);
        }
        if (fontFamily === "original" || fontFamily === "serif" || fontFamily === "sans-serif") {
          setFontFamily(fontFamily);
        }
        if (theme === "light" || theme === "dark" || theme === "sepia") {
          setTheme(theme);
        }
        if (spread === "auto" || spread === "none") {
          setSpread(spread);
        }
        if (wheelDirection === "down" || wheelDirection === "up") {
          setWheelDirection(wheelDirection);
        }
        if (keyboardDirection === "right" || keyboardDirection === "left") {
          setKeyboardDirection(keyboardDirection);
        }
        if (clickDirection === "right" || clickDirection === "left") {
          setClickDirection(clickDirection);
        } else if (globalClickDirection === "ltr" || globalClickDirection === "rtl") {
          setClickDirection(globalClickDirection === "ltr" ? "right" : "left");
        }

        if (seriesId) {
          try {
            const seriesSettings = await seriesAPI.getViewerSettings(seriesId);
            if (cancelled) return;
            const renderMode = seriesSettings?.epub_render_mode;
            if (renderMode === "auto" || renderMode === "book" || renderMode === "comic") {
              setRenderMode(renderMode);
            }
          } catch (seriesError) {
            if (cancelled) return;
            console.warn("[EpubViewerRoute] Failed to load series viewer settings:", seriesError);
          }
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
      }
    };

    void loadEpubSettings();
    return () => {
      cancelled = true;
    };
  }, [
    chapterId,
    seriesId,
    setFontFamily,
    setFontSize,
    setLineHeight,
    setTheme,
    setRenderMode,
    setSpread,
    setWheelDirection,
    setKeyboardDirection,
    setClickDirection,
  ]);

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

  // 뷰어 종료 시 전체화면 해제
  useEffect(() => {
    return () => {
      if (isDocumentFullscreen()) {
        exitFullscreen().catch(() => {});
      }

      if (initFallbackTimerRef.current) window.clearTimeout(initFallbackTimerRef.current);
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
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
        useEpubViewerStore.getState().hideUI();
      }, 3000);
    }
  }, [isSettingsOpen]);

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
        useEpubViewerStore.getState().hideUI();
      } else {
        resetUITimer();
      }
    }
  }, [isUIVisible, resetUITimer]);

  // 클릭 시 UI 토글
  const toggleUIWithTimer = useCallback(() => {
    const state = useEpubViewerStore.getState();
    if (state.isUIVisible) {
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
      state.hideUI();
    } else {
      state.showUI();
      uiShownTimeRef.current = Date.now();
      resetUITimer();
    }
  }, [resetUITimer]);

  const handleViewerClick = useCallback(() => {
    toggleUIWithTimer();
  }, [toggleUIWithTimer]);

  // 진행도 저장 (EPUB은 CFI 및 가상 포지션 기반 저장)
  const saveProgress = useCallback(
    async (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
    }) => {
      // 초기 로딩 중에는 저장을 무시하여 기존 진행도를 0으로 덮어쓰는 것 방지
      if (isInitializingRef.current || isIncognito) {
        if (isInitializingRef.current) console.log("[EpubViewerRoute] saveProgress skipped: isInitializing is true");
        return;
      }

      // 진행 데이터는 전역 위치 축(totalPositions/currentPosition)만 사용한다.
      const totalPositions = Math.max(0, location.totalPositions);
      // totalPositions가 1 이하면 내비게이션 축으로 신뢰하기 어렵다.
      // (일부 EPUB에서 locations가 1개로 생성되어 끝으로 오인될 수 있음)
      if (totalPositions <= 1) {
        const fallbackTotalPages = Math.max(1, location.chapterTotal || totalPages || 1);
        const fallbackCurrentPage = Math.max(1, Math.min(fallbackTotalPages, location.chapterPage || currentPage || 1));
        const fallbackRatio =
          Number.isFinite(location.globalRatio) && location.globalRatio >= 0
            ? Math.max(0, Math.min(1, location.globalRatio))
            : fallbackTotalPages > 1
              ? (fallbackCurrentPage - 1) / (fallbackTotalPages - 1)
              : 0;
        const fallbackProgressPercent = fallbackRatio * 100;
        try {
          await epubProgressAPI.update(chapterId, {
            current_page: fallbackCurrentPage,
            total_pages: fallbackTotalPages,
            progress_percent: fallbackProgressPercent,
            current_position: 0,
            total_positions: 0,
            current_cfi: location.cfi,
          });
        } catch (error) {
          console.error("Failed to save fallback epub progress:", error);
        }
        return;
      }
      const currentPosition = Math.max(0, Math.min(totalPositions - 1, location.currentPosition));
      const calculatedCurrentPage = currentPosition + 1;
      const calculatedTotalPages = totalPositions;
      const progressPercent = toPositionRatio(currentPosition, calculatedTotalPages) * 100;

      try {
        await epubProgressAPI.update(chapterId, {
          current_page: calculatedCurrentPage,
          total_pages: calculatedTotalPages,
          progress_percent: progressPercent,
          current_position: currentPosition,
          total_positions: totalPositions,
          current_cfi: location.cfi,
        });
      } catch (error) {
        console.error("Failed to save progress:", error);
      }
    },
    [chapterId, isIncognito, totalPages, currentPage],
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
    }) => {
      setCurrentCFI(location.cfi);

      // isInitializingRef.current 사용으로 stale closure 방지
      if (isInitializingRef.current) {
        return;
      }

      // totalPositions가 1 이하면 페이지 축으로는 신뢰하지 않고 chapter 축을 우선 사용한다.
      if (location.totalPositions > 1) {
        const clampedPosition = Math.max(0, Math.min(location.totalPositions - 1, location.currentPosition));
        setCurrentPage(clampedPosition + 1);
        setTotalPages(location.totalPositions);
        setGlobalProgress(toPositionRatio(clampedPosition, location.totalPositions) * 100);
      } else {
        // locations 축이 신뢰 불가할 때는 section(page) 축보다 globalRatio 축을 우선 사용한다.
        // chapterTotal/chapterPage는 섹션 단위 값이라 조기 "마지막 페이지" 판정을 만들 수 있다.
        if (Number.isFinite(location.globalRatio)) {
          const clampedRatio = Math.max(0, Math.min(1, location.globalRatio));
          setGlobalProgress(clampedRatio * 100);
          const pseudoTotalPages = 100;
          const pseudoCurrentPage = Math.max(1, Math.round(clampedRatio * pseudoTotalPages));
          setCurrentPage(pseudoCurrentPage);
          setTotalPages(pseudoTotalPages);
        } else if (location.chapterTotal > 0) {
          const clampedChapterTotal = Math.max(1, location.chapterTotal);
          const clampedChapterPage = Math.max(1, Math.min(clampedChapterTotal, location.chapterPage || 1));
          const chapterRatio = clampedChapterPage / clampedChapterTotal;
          setCurrentPage(clampedChapterPage);
          setTotalPages(clampedChapterTotal);
          setGlobalProgress(chapterRatio * 100);
        }
      }

      // 초기화 후 첫 위치를 baseline으로 잡고, 같은 CFI에서는 저장하지 않는다.
      // (초기 relocated가 beginning CFI를 반복 전달해 기존 위치를 덮어쓰는 문제 방지)
      if (!baselineCFIRef.current) {
        baselineCFIRef.current = location.cfi;
        // 초기 위치 저장 보호: 기존 진행률이 있는데 0% 근처라면 저장하지 않음 (레이스 보호)
        const isAtBeginning = location.globalRatio < 0.02 && location.currentPosition <= 0;
        const hadSavedProgress = initialCFI !== null || (initialProgressRatio !== null && initialProgressRatio > 0.02);
        if (!isAtBeginning || !hadSavedProgress) {
          saveProgress(location);
        }
        return;
      }
      if (baselineCFIRef.current === location.cfi) {
        return;
      }

      saveProgress(location);
    },
    [setCurrentCFI, setCurrentPage, setTotalPages, setGlobalProgress, saveProgress, initialCFI, initialProgressRatio],
  );

  const handleInitializationComplete = useCallback(() => {
    console.log("[EpubViewerRoute] Viewer reported initialization complete");
    if (initFallbackTimerRef.current) {
      window.clearTimeout(initFallbackTimerRef.current);
      initFallbackTimerRef.current = null;
    }
    setIsInitializing(false);
    isInitializingRef.current = false;
  }, []);

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

  const handleFontSizeChange = useCallback(
    (size: number) => {
      setFontSize(size);
      void settingAPI.update("epub_font_size", { value: String(size) }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_font_size:", error);
      });
    },
    [setFontSize],
  );

  const handleFontFamilyChange = useCallback(
    (family: EpubFontFamily) => {
      setFontFamily(family);
      void settingAPI.update("epub_font_family", { value: family }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_font_family:", error);
      });
    },
    [setFontFamily],
  );

  const handleLineHeightChange = useCallback(
    (height: number) => {
      setLineHeight(height);
      void settingAPI.update("epub_line_height", { value: String(height) }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_line_height:", error);
      });
    },
    [setLineHeight],
  );

  const handleThemeChange = useCallback(
    (theme: "light" | "dark" | "sepia") => {
      setTheme(theme);
      void settingAPI.update("epub_theme", { value: theme }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_theme:", error);
      });
    },
    [setTheme],
  );

  const handleSpreadChange = useCallback(
    (spread: "auto" | "none") => {
      setSpread(spread);
      void settingAPI.update("epub_spread", { value: spread }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_spread:", error);
      });
    },
    [setSpread],
  );

  const handleWheelDirectionChange = useCallback(
    (direction: "down" | "up") => {
      setWheelDirection(direction);
      void settingAPI.update("epub_wheel_direction", { value: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_wheel_direction:", error);
      });
    },
    [setWheelDirection],
  );

  const handleRenderModeChange = useCallback(
    (mode: EpubRenderMode) => {
      setRenderMode(mode);
      if (!seriesId) return;
      void seriesAPI.updateViewerSettings(seriesId, { epub_render_mode: mode }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_render_mode:", error);
      });
    },
    [seriesId, setRenderMode],
  );

  const handleKeyboardDirectionChange = useCallback(
    (direction: "right" | "left") => {
      setKeyboardDirection(direction);
      void settingAPI.update("epub_keyboard_direction", { value: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_keyboard_direction:", error);
      });
    },
    [setKeyboardDirection],
  );

  const handleClickDirectionChange = useCallback(
    (direction: "right" | "left") => {
      setClickDirection(direction);
      void settingAPI.update("epub_click_direction", { value: direction }).catch((error) => {
        console.warn("[EpubViewerRoute] Failed to save epub_click_direction:", error);
      });
    },
    [setClickDirection],
  );

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  const handleReachedSeriesEnd = useCallback(() => {
    if (isAdjacentResolved) {
      setShowSeriesEndModal(true);
    }
  }, [isAdjacentResolved]);

  const handleNextAtEnd = useCallback(() => {
    if (nextChapterId) {
      navigate(`/viewer/${nextChapterId}`);
      return;
    }
    handleReachedSeriesEnd();
  }, [nextChapterId, navigate, handleReachedSeriesEnd]);

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
  if (isLoading || !chapter || !epubUrl) {
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
      <EpubViewer
        key={chapterId}
        chapterTitle={chapter?.title || ""}
        chapterId={chapterId}
        epubUrl={epubUrl}
        initialCFI={initialCFI}
        initialProgressRatio={initialProgressRatio}
        currentPage={currentPage}
        totalPages={totalPages}
        globalProgress={globalProgress}
        isUIVisible={isUIVisible}
        isSettingsOpen={isSettingsOpen}
        isTOCOpen={isTOCOpen}
        isFullscreen={isFullscreen}
        isIncognito={isIncognito}
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
        onWheelDirectionChange={handleWheelDirectionChange}
        onKeyboardDirectionChange={handleKeyboardDirectionChange}
        onClickDirectionChange={handleClickDirectionChange}
        onSpreadChange={handleSpreadChange}
        onReachedEndNext={handleNextAtEnd}
        isEndNavigationReady={isAdjacentResolved}
        onInteractionStart={handleInteractionStart}
        onInteractionEnd={handleInteractionEnd}
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
