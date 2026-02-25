import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useEpubViewerStore } from "../stores/epubViewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import { EpubViewer } from "./EpubViewer";
import { seriesAPI } from "../api/client";
import type { EpubTOCItem } from "../features/epub-viewer/components/EpubChapterViewer";

interface EpubViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

export function EpubViewerRoute({ loaderData }: EpubViewerRouteProps) {
  const { t } = useTranslation();
  const { chapter, seriesId } = loaderData;
  const chapterId = chapter?.id || "";

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
  const isInitializingRef = useRef(true);

  const navigate = useNavigate();
  const uiTimerRef = useRef<number | null>(null);

  // 초기화: 진행도 로딩 후에만 뷰어 렌더링
  useEffect(() => {
    isInitializingRef.current = true;
    reset();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitialCFI(null);
    setIsLoading(true);

    if (seriesId) {
      seriesAPI
        .getProgress(seriesId)
        .then((res) => {
          const progressData = res.data.progress;
          console.log("[EpubViewerRoute] Loaded progress:", progressData);
          if (progressData?.current_cfi) {
            setInitialCFI(progressData.current_cfi);
            setCurrentCFI(progressData.current_cfi);
          }
          if (progressData?.progress_percent !== undefined) {
            setGlobalProgress(progressData.progress_percent);
          }
        })
        .catch(() => {})
        .finally(() => {
          setIsLoading(false);
          // 약간의 지연을 두어 뷰어 마운트 후 첫 relocated 이벤트가 무시되도록 함
          setTimeout(() => {
            isInitializingRef.current = false;
          }, 500);
        });
    } else {
      setIsLoading(false);
      isInitializingRef.current = false;
    }
  }, [chapterId, seriesId, reset, setCurrentCFI, setGlobalProgress]);

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
      globalPercentage: number;
      currentPosition: number;
      totalPositions: number;
    }) => {
      // 초기 로딩 중에는 저장을 무시하여 기존 진행도를 0으로 덮어쓰는 것 방지
      if (isInitializingRef.current || isIncognito || !seriesId) return;

      // 스캐너 정보(chapter 데이터에 포함된 total_positions) 사용
      // 스캐너 정보가 없는 경우(0) epub.js에서 계산된 totalPositions를 fallback으로 사용
      const scannerTotal = chapter?.total_positions || location.totalPositions || 0;

      if (scannerTotal <= 0) {
        return;
      }

      // 6KB 가상 페이지 기준 계산
      const actualTotalPages = scannerTotal;
      const actualCurrentPage = Math.max(1, Math.ceil(location.globalPercentage * actualTotalPages));

      try {
        await seriesAPI.updateProgress(seriesId, {
          chapter_id: chapterId,
          current_page: actualCurrentPage,
          total_pages: actualTotalPages,
          progress_percent: location.globalPercentage * 100,
          current_position: location.currentPosition,
          total_positions: actualTotalPages,
          current_cfi: location.cfi,
        });
      } catch (error) {
        console.error("Failed to save progress:", error);
      }
    },
    [seriesId, chapterId, chapter, isIncognito],
  );

  const handleLocationChange = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalPercentage: number;
      currentPosition: number;
      totalPositions: number;
    }) => {
      setCurrentCFI(location.cfi);
      // UI 표시용 (푸터) - 사용자의 요청대로 챕터 내 실제 페이지 표시
      setCurrentPage(location.chapterPage);
      setTotalPages(location.chapterTotal);
      // 전역 진행도(%) 업데이트
      setGlobalProgress(location.globalPercentage * 100);

      // 서버 저장용 (가시성/정합성 용)
      saveProgress(location);
    },
    [setCurrentCFI, setCurrentPage, setTotalPages, setGlobalProgress, saveProgress],
  );

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

  const epubUrl = `${API_BASE_URL}/chapters/${chapterId}/epub`;

  if (isLoading) {
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
        onToggleTOC={toggleTOC}
        onToggleFullscreen={handleToggleFullscreen}
        onReady={handleReady}
        onTOCLoad={handleTOCLoad}
        onLocationChange={handleLocationChange}
        onViewerClick={handleViewerClick}
        onFontSizeChange={setFontSize}
        onFontFamilyChange={setFontFamily}
        onLineHeightChange={setLineHeight}
        onThemeChange={setTheme}
        onFlowChange={setFlow}
      />
    </div>
  );
}
