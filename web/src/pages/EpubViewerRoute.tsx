import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEpubViewerStore } from "../stores/epubViewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { EpubViewer } from "./EpubViewer";
import { epubProgressAPI } from "../api/client";
import type { EpubTOCItem } from "../features/epub-viewer/components/EpubChapterViewer";

interface EpubViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
export function EpubViewerRoute({ loaderData }: EpubViewerRouteProps) {
  const { t } = useTranslation();
  const { chapter } = loaderData;
  const chapterId = chapter?.id || "";
  const [, setIsInitializing] = useState(true);

  const {
    currentCFI,
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
    toggleTOC,
    setFullscreen,
    setIncognito,
    reset,
    setFontSize,
    setFontFamily,
    setLineHeight,
    setTheme,
    setFlow,
  } = useEpubViewerStore();

  const [toc, setToc] = useState<EpubTOCItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [initialCFI, setInitialCFI] = useState<string | null>(null);
  const [initialProgressRatio, setInitialProgressRatio] = useState<number | null>(null);
  const isInitializingRef = useRef(true);
  const baselineCFIRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const uiTimerRef = useRef<number | null>(null);
  const initFallbackTimerRef = useRef<number | null>(null);

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
        } finally {
          setIsLoading(false);
          // 뷰어 자체의 초기화 완료 대기로 변경 (기존 setTimeout 제거)
        }
      } else {
        setInitialCFI(null);
        setIsLoading(false);
        setIsInitializing(false);
        isInitializingRef.current = false;
      }
    };

    fetchProgress();
  }, [chapterId, reset, setCurrentCFI, setGlobalProgress]);

  // 시크릿 모드 설정
  useEffect(() => {
    setIncognito(false);
  }, [setIncognito]);

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

  // UI 자동 숨김 타이머
  const resetUITimer = useCallback(() => {
    if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
    if (!isSettingsOpen) {
      uiTimerRef.current = window.setTimeout(() => {
        useEpubViewerStore.getState().hideUI();
      }, 3000);
    }
  }, [isSettingsOpen]);

  // 클릭 시 UI 토글
  const toggleUIWithTimer = useCallback(() => {
    const state = useEpubViewerStore.getState();
    if (state.isUIVisible) {
      if (uiTimerRef.current) clearTimeout(uiTimerRef.current);
      state.hideUI();
    } else {
      state.showUI();
      resetUITimer();
    }
  }, [resetUITimer]);

  const handleOuterClick = useCallback(() => {
    toggleUIWithTimer();
  }, [toggleUIWithTimer]);

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

      const locationsTotal = location.totalPositions > 0 ? location.totalPositions : 0;
      const currentPosition = locationsTotal > 0 ? Math.max(0, location.currentPosition) : 0;
      const totalPositions = locationsTotal;
      const currentPageFromLocation = Math.max(1, location.chapterPage || 1);
      const currentPageFromPosition =
        totalPositions > 0 ? Math.max(1, Math.min(totalPositions, currentPosition + 1)) : currentPageFromLocation;
      const currentPage = currentPageFromPosition;
      const totalPages =
        totalPositions > 0 ? totalPositions : Math.max(1, location.chapterTotal || chapter?.page_count || 1);
      const progressPercent = (currentPage / totalPages) * 100;

      try {
        await epubProgressAPI.update(chapterId, {
          current_page: currentPage,
          total_pages: totalPages,
          progress_percent: progressPercent,
          current_position: currentPosition,
          total_positions: totalPositions,
          current_cfi: location.cfi,
        });
      } catch (error) {
        console.error("Failed to save progress:", error);
      }
    },
    [chapterId, chapter, isIncognito],
  );

  const handleLocationChange = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
    }) => {
      setCurrentCFI(location.cfi);

      // isInitializingRef.current 사용으로 stale closure 방지
      if (isInitializingRef.current) {
        return;
      }

      if (location.chapterPage > 0) {
        setCurrentPage(location.chapterPage);
      }
      if (location.chapterTotal > 0) {
        setTotalPages(location.chapterTotal);
      }

      setGlobalProgress(Math.max(0, Math.min(100, location.globalRatio * 100)));

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
      if (total > 0) setTotalPages(total);
    },
    [setTotalPages],
  );

  const handleTOCLoad = useCallback((loadedTOC: EpubTOCItem[]) => {
    setToc(loadedTOC);
  }, []);

  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

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

  const token = localStorage.getItem("access_token");
  const epubUrl = `${API_BASE_URL}/chapters/${chapterId}/epub${token ? `?token=${encodeURIComponent(token)}` : ""}`;

  // 챕터 정보/진행도 로딩까지만 대기하고, 이후 뷰어 초기화는 컴포넌트 내부에서 진행
  if (isLoading || !chapter) {
    return (
      <div
        style={{
          width: "100%",
          height: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1a1a1a",
          color: "#888",
        }}
      >
        {t("epub_viewer.loading")}
      </div>
    );
  }

  return (
    <div
      onClick={handleOuterClick}
      style={{ width: "100%", height: "100vh" }}
    >
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
        currentCFI={currentCFI}
        toc={toc}
        settings={settings}
        onBack={handleBack}
        onToggleSettings={toggleSettings}
        onToggleTOC={toggleTOC}
        onToggleFullscreen={handleToggleFullscreen}
        onReady={handleReady}
        onTOCLoad={handleTOCLoad}
        onLocationChange={handleLocationChange}
        onViewerClick={handleViewerClick}
        onInitializationComplete={handleInitializationComplete}
        onFontSizeChange={setFontSize}
        onFontFamilyChange={setFontFamily}
        onLineHeightChange={setLineHeight}
        onThemeChange={setTheme}
        onFlowChange={setFlow}
      />
    </div>
  );
}
