import { useEffect, useCallback, useState, useRef, useMemo } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useViewerStore } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { useTranslation } from "react-i18next";
import { AlertModal } from "../components/modals/AlertModal";

// Feature imports
import {
  useBGM,
  useAdjacentChapters,
  useProgress,
  UI_HIDE_DELAY,
  useProgressSync,
  useExitFullscreenOnViewerUnmount,
  useRestoreFullscreenAfterChapterSwitch,
} from "../features/viewer";
import type { PDFOutlineItem } from "../features/viewer/components/PdfChapterViewer";
import { useViewerSync } from "../hooks/useViewerSync";
import { useReadingTime } from "../hooks/useReadingTime";
import { useViewerNavigation } from "../features/viewer/hooks/useViewerNavigation";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import type { ViewerAnimationHandles, PageMeta } from "../features/viewer/types";
import { PdfViewer } from "./PdfViewer";
import { usePreventBrowserZoom } from "../features/viewer/hooks/usePreventBrowserZoom";
import type { SubPage } from "../stores/viewerStore";
import { buildViewerRouteState } from "../utils/viewerRouteState";

interface PdfViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

export function PdfViewerRoute({ loaderData }: PdfViewerRouteProps) {
  const { chapterId: routeChapterId } = useParams<{ chapterId: string }>();
  const {
    chapter,
    seriesId,
    volumeId,
    isInitialScrollingRef,
    restorePosition = { currentPage: 1, anchorPage: 1, offsetRatio: 0 },
  } = loaderData;
  const chapterId = chapter?.id || "";

  // 뷰어 스토어
  const {
    currentPage,
    totalPages,
    isUIVisible,
    isSettingsOpen,
    isFullscreen,
    settings,
    goToPage,
    toggleSettings,
    closeSettings,
    setFullscreen,
    setReadingMode,
    togglePageOffset,
    isIncognito,
    setCurrentPage,
    setTotalPages,
  } = useViewerStore();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const routeIsIncognito = location.state?.isIncognito === true;
  const effectiveIncognito = isIncognito || routeIsIncognito;
  usePreventBrowserZoom(true);

  // 인접 챕터 탐색
  const { nextChapterId, prevChapterId, isLastChapterOfVolume, isAdjacentResolved } = useAdjacentChapters({
    volumeId,
    chapterId,
    seriesId,
  });

  // BGM 제어
  const { bgmInfo, isBgmPlaying, setIsBgmPlaying, audioRef } = useBGM({
    volumeId,
    chapterId,
    isReady: true,
  });
  const [settledRestoreChapterId, setSettledRestoreChapterId] = useState<string | null>(null);
  const isRestoreSettled = settledRestoreChapterId === chapterId;
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
  const restoreTargetPage = Math.max(1, restorePosition.currentPage || 1);
  const isDocumentLoadedForChapter = loadedChapterId === chapterId;

  // 진행도 저장
  const { saveProgress } = useProgress({
    seriesId,
    chapterId,
    chapter,
    currentPage,
    totalPages,
    isLoading: false,
    isIncognito: effectiveIncognito,
    isLastChapterOfVolume,
    isInitialScrollingRef,
  });

  // 진행도 동기화
  const { showSyncModal, serverProgress, handleConfirmSync, handleCloseModal } = useProgressSync({
    seriesId,
    chapter,
    currentPage,
    isLoading: loaderData.isLoading || !isRestoreSettled,
    isRestoreSettled,
  });

  // 전체화면 토글 핸들러
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

  const animationRef = useRef<ViewerAnimationHandles>(null);
  const [showPageJump, setShowPageJump] = useState(false);
  const [isChapterListOpen, setIsChapterListOpen] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocItems, setTocItems] = useState<PDFOutlineItem[]>([]);
  const [zoomScale, setZoomScale] = useState(1);
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef<number>(0);
  const isInteractingRef = useRef(false);
  const [showSeriesEndModal, setShowSeriesEndModal] = useState(false);
  const handleReachedSeriesEnd = useCallback(() => {
    if (isAdjacentResolved) {
      setShowSeriesEndModal(true);
    }
  }, [isAdjacentResolved]);
  const emptyPageMetaMap = useMemo<Map<number, PageMeta>>(() => new Map(), []);
  const noopSetSubPage = useCallback((subPage: SubPage) => {
    void subPage;
  }, []);

  // 네비게이션 제어
  const { handleNext, handlePrev, handleBack, canGoNextChapter, canGoPrevChapter } = useViewerNavigation({
    currentPage,
    totalPages,
    readingMode: settings.readingMode,
    readingDirection: settings.readingDirection,
    keyboardDirection: settings.keyboardDirection,
    pageOffset: settings.pageOffset,
    pageMetaMap: emptyPageMetaMap, // PDF does not use page metas for now
    subPage: null,
    setSubPage: noopSetSubPage,
    nextChapterId,
    prevChapterId,
    saveProgress,
    isSettingsOpen,
    closeSettings,
    handleToggleFullscreen,
    animationRef: animationRef as React.RefObject<ViewerAnimationHandles>,
    currentChapterId: chapterId,
    onReachedSeriesEnd: handleReachedSeriesEnd,
  });

  // 키보드 네비게이션
  // 키보드 이벤트는 useViewerNavigation 에서 내부 처리됨.

  // 웹소켓 실시간 동기화 및 중복 세션 제어
  const { terminatedInfo } = useViewerSync({
    seriesId: seriesId as string,
    chapterId: chapterId as string,
    currentPage,
    isLoading: loaderData.isLoading,
    isIncognito: effectiveIncognito,
  });

  // 세션 종료 핸들러
  const handleTerminatedConfirm = useCallback(() => {
    if (viewerFrom) {
      navigate(viewerFrom, { replace: true });
      return;
    }
    navigate("/");
  }, [navigate, viewerFrom]);

  // 읽기 시간 측정 (활성화)
  useReadingTime(seriesId || undefined, true, chapterId as string);

  // PDF 문서 로드 핸들러 (메모이제이션)
  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      setTotalPages(numPages);
      setZoomScale(1);
      setLoadedChapterId(routeChapterId ?? null);
    },
    [routeChapterId, setTotalPages],
  );

  const handlePageChange = useCallback(
    (page: number) => {
      setCurrentPage(page);

      if (isRestoreSettled) return;
      if (page !== restoreTargetPage) return;

      loaderData.setViewStatus?.("ready");
      setSettledRestoreChapterId(routeChapterId ?? null);
    },
    [isRestoreSettled, loaderData, restoreTargetPage, routeChapterId, setCurrentPage],
  );

  useEffect(() => {
    if (!isDocumentLoadedForChapter || isRestoreSettled) return;
    if (currentPage !== restoreTargetPage) return;

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      loaderData.setViewStatus?.("ready");
      setSettledRestoreChapterId(routeChapterId ?? null);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [currentPage, isDocumentLoadedForChapter, isRestoreSettled, loaderData, restoreTargetPage, routeChapterId]);

  const handleOutlineLoad = useCallback((outline: PDFOutlineItem[]) => {
    setTocItems(outline);
  }, []);

  const handleZoomIn = useCallback(() => {
    animationRef.current?.zoomIn?.();
  }, []);

  const handleZoomOut = useCallback(() => {
    animationRef.current?.zoomOut?.();
  }, []);

  const handleZoomReset = useCallback(() => {
    animationRef.current?.resetZoom?.();
  }, []);

  // 브라우저 전체화면 상태와 스토어 동기화
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isActuallyFullscreen = isDocumentFullscreen();
      if (isFullscreen !== isActuallyFullscreen) {
        setFullscreen(isActuallyFullscreen);
      }
    };

    const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    events.forEach((event) => document.addEventListener(event, handleFullscreenChange));

    return () => {
      events.forEach((event) => document.removeEventListener(event, handleFullscreenChange));
    };
  }, [isFullscreen, setFullscreen]);
  useRestoreFullscreenAfterChapterSwitch(routeChapterId);
  useExitFullscreenOnViewerUnmount();

  // PDF 세로 모드에서는 useVerticalScroll 훅을 사용하지 않으므로
  // 초기 스크롤 가드가 해제되지 않으면 진행도 저장이 영구 차단될 수 있다.
  useEffect(() => {
    if (settings.readingMode !== "vertical") return;
    if (totalPages <= 0) return;
    if (!isInitialScrollingRef.current) return;

    const timer = window.setTimeout(() => {
      isInitialScrollingRef.current = false;
    }, 200);

    return () => window.clearTimeout(timer);
  }, [settings.readingMode, totalPages, currentPage, isInitialScrollingRef]);

  // 뷰어 종료 시 타이머 정리
  useEffect(() => {
    return () => {
      if (uiTimerRef.current) {
        window.clearTimeout(uiTimerRef.current);
      }
    };
  }, []);

  // UI 표시 시작 시각 기록
  useEffect(() => {
    if (isUIVisible) {
      uiShownTimeRef.current = Date.now();
    }
  }, [isUIVisible]);

  const resetUITimer = useCallback(() => {
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    if (!isSettingsOpen && !isInteractingRef.current) {
      uiTimerRef.current = window.setTimeout(() => {
        useViewerStore.getState().hideUI();
      }, UI_HIDE_DELAY);
    }
  }, [isSettingsOpen]);

  const handleInteractionStart = useCallback(() => {
    isInteractingRef.current = true;
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    isInteractingRef.current = false;
    if (!isUIVisible) return;
    const elapsed = Date.now() - uiShownTimeRef.current;
    if (elapsed >= UI_HIDE_DELAY) {
      useViewerStore.getState().hideUI();
      return;
    }
    resetUITimer();
  }, [isUIVisible, resetUITimer]);

  // UI 자동 숨김 타이머
  useEffect(() => {
    if (isUIVisible) {
      resetUITimer();
    } else if (uiTimerRef.current) {
      window.clearTimeout(uiTimerRef.current);
      uiTimerRef.current = null;
    }

    return () => {
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    };
  }, [isUIVisible, resetUITimer, currentPage]);

  return (
    <>
      <PdfViewer
        chapterTitle={chapter?.title || ""}
        seriesId={seriesId || ""}
        chapterId={chapterId}
        currentPage={currentPage}
        totalPages={totalPages}
        isUIVisible={isUIVisible}
        isSettingsOpen={isSettingsOpen}
        isFullscreen={isFullscreen}
        isIncognito={effectiveIncognito}
        settings={{
          backgroundColor: settings.backgroundColor,
          fitMode: settings.fitMode,
          readingMode: settings.readingMode,
          readingDirection: settings.readingDirection,
          wheelDirection: settings.wheelDirection,
          pageOffset: settings.pageOffset,
          pageTransition: settings.pageTransition,
          preloadCount: settings.preloadCount,
        }}
        bgmInfo={bgmInfo}
        isBgmPlaying={isBgmPlaying}
        showPageJump={showPageJump}
        showSyncModal={showSyncModal}
        showTOC={showTOC}
        tocItems={tocItems}
        serverProgress={serverProgress}
        terminatedInfo={terminatedInfo}
        nextChapterId={nextChapterId}
        audioRef={audioRef}
        animationRef={animationRef as React.RefObject<ViewerAnimationHandles>}
        showZoomControls={settings.showPdfZoomControls}
        zoomPercent={Math.round(zoomScale * 100)}
        onBack={handleBack}
        onToggleFullscreen={handleToggleFullscreen}
        onToggleSettings={toggleSettings}
        onToggleBgm={() => setIsBgmPlaying(!isBgmPlaying)}
        onToggleTOC={() => setShowTOC(!showTOC)}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onZoomReset={handleZoomReset}
        onZoomChange={setZoomScale}
        onDocumentLoad={handleDocumentLoad}
        onOutlineLoad={handleOutlineLoad}
        onNext={handleNext}
        onPrev={handlePrev}
        canGoNextChapter={canGoNextChapter}
        canGoPrevChapter={canGoPrevChapter}
        onPageChange={handlePageChange}
        onGoToPage={goToPage}
        onPageJumpClick={() => setShowPageJump(true)}
        onReadingModeChange={setReadingMode}
        onTogglePageOffset={togglePageOffset}
        isChapterListOpen={isChapterListOpen}
        onToggleChapterList={() => setIsChapterListOpen(true)}
        onCloseChapterList={() => setIsChapterListOpen(false)}
        onChapterNavigate={(id) => {
          const viewerState = buildViewerRouteState({ from: viewerFrom, isIncognito: effectiveIncognito });
          navigate(`/viewer/${id}`, { state: viewerState, replace: true });
        }}
        onCloseSettings={closeSettings}
        onClosePageJump={() => setShowPageJump(false)}
        onPageJump={goToPage}
        onConfirmSync={handleConfirmSync}
        onCloseSync={handleCloseModal}
        onConfirmTerminated={handleTerminatedConfirm}
        sessionForceLogoutTitle={t("viewer.session.force_logout_title")}
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
    </>
  );
}
