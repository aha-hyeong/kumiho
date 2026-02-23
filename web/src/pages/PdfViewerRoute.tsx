import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useViewerStore } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { useTranslation } from "react-i18next";

// Feature imports
import { useBGM, useAdjacentChapters, useProgress, UI_HIDE_DELAY, useProgressSync } from "../features/viewer";
import type { PDFOutlineItem } from "../features/viewer/components/PdfChapterViewer";
import { useViewerSync } from "../hooks/useViewerSync";
import { useReadingTime } from "../hooks/useReadingTime";
import { useViewerNavigation } from "../features/viewer/hooks/useViewerNavigation";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
import type { ViewerAnimationHandles } from "../features/viewer/types";
import { PdfViewer } from "./PdfViewer";

interface PdfViewerRouteProps {
  loaderData: UseChapterLoaderReturn;
}

export function PdfViewerRoute({ loaderData }: PdfViewerRouteProps) {
  const { chapter, seriesId, volumeId, isInitialScrollingRef } = loaderData;
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

  // 인접 챕터 탐색
  const { nextChapterId, prevChapterId, isLastChapterOfVolume } = useAdjacentChapters({
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

  // 진행도 저장
  useProgress({
    seriesId,
    chapterId,
    chapter,
    currentPage,
    totalPages,
    isLoading: false,
    isIncognito,
    isLastChapterOfVolume,
    isInitialScrollingRef,
  });

  // 진행도 동기화
  const { showSyncModal, serverProgress, handleConfirmSync, handleCloseModal } = useProgressSync({
    seriesId,
    chapter,
    currentPage,
    isLoading: false,
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

  // 네비게이션 제어
  const { handleNext, handlePrev, handleBack } = useViewerNavigation({
    currentPage,
    totalPages,
    readingMode: settings.readingMode,
    clickDirection: settings.clickDirection,
    keyboardDirection: settings.keyboardDirection,
    pageOffset: settings.pageOffset,
    pageMetaMap: new Map(), // PDF does not use page metas for now
    nextChapterId,
    prevChapterId,
    saveProgress: async () => {}, // Handled by useProgress
    isSettingsOpen,
    closeSettings,
    handleToggleFullscreen,
    animationRef: animationRef as React.RefObject<ViewerAnimationHandles>,
    currentChapterId: chapterId,
  });

  // 키보드 네비게이션
  // 키보드 이벤트는 useViewerNavigation 에서 내부 처리됨.

  // 웹소켓 실시간 동기화 및 중복 세션 제어
  const { terminatedInfo } = useViewerSync({
    seriesId: seriesId as string,
    chapterId: chapterId as string,
    currentPage,
  });

  // 세션 종료 핸들러
  const handleTerminatedConfirm = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // 읽기 시간 측정 (활성화)
  useReadingTime(seriesId || undefined, true, chapterId as string);

  // Local State for Page Jump Modal and TOC
  const [showPageJump, setShowPageJump] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocItems, setTocItems] = useState<PDFOutlineItem[]>([]);
  const [zoomScale, setZoomScale] = useState(1);

  // PDF 문서 로드 핸들러 (메모이제이션)
  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      setTotalPages(numPages);
      setZoomScale(1);
    },
    [setTotalPages],
  );

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

  // 뷰어 종료 시 전체화면 해제
  useEffect(() => {
    return () => {
      if (isDocumentFullscreen()) {
        exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // UI 자동 숨김 타이머 및 상호작용 리셋
  useEffect(() => {
    let hideTimer: number | null = null;

    const startTimer = () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      if (isUIVisible && !isSettingsOpen) {
        hideTimer = window.setTimeout(() => {
          useViewerStore.getState().hideUI();
        }, UI_HIDE_DELAY);
      }
    };

    const handleInteract = (e: MouseEvent | TouchEvent) => {
      if (!isUIVisible) return;
      const target = e.target as HTMLElement;
      if (target.closest("header") || target.closest("footer")) {
        startTimer();
      }
    };

    startTimer();

    window.addEventListener("mousedown", handleInteract);
    window.addEventListener("touchstart", handleInteract, { passive: true });

    return () => {
      if (hideTimer) window.clearTimeout(hideTimer);
      window.removeEventListener("mousedown", handleInteract);
      window.removeEventListener("touchstart", handleInteract);
    };
  }, [isUIVisible, isSettingsOpen, currentPage]);

  return (
    <PdfViewer
      chapterTitle={chapter?.title || ""}
      chapterId={chapterId}
      seriesId={seriesId || undefined}
      currentPage={currentPage}
      totalPages={totalPages}
      isUIVisible={isUIVisible}
      isSettingsOpen={isSettingsOpen}
      isFullscreen={isFullscreen}
      isIncognito={isIncognito}
      settings={{
        backgroundColor: settings.backgroundColor,
        fitMode: settings.fitMode,
        readingMode: settings.readingMode,
        readingDirection: settings.readingDirection,
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
      onPageChange={setCurrentPage}
      onGoToPage={goToPage}
      onSliderChange={(e) => setCurrentPage(parseInt(e.target.value, 10))}
      onPageJumpClick={() => setShowPageJump(true)}
      onReadingModeChange={setReadingMode}
      onTogglePageOffset={togglePageOffset}
      onCloseSettings={closeSettings}
      onClosePageJump={() => setShowPageJump(false)}
      onPageJump={goToPage}
      onConfirmSync={handleConfirmSync}
      onCloseSync={handleCloseModal}
      onConfirmTerminated={handleTerminatedConfirm}
      sessionForceLogoutTitle={t("viewer.session.force_logout_title")}
    />
  );
}
