import { useEffect, useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useViewerStore } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { useTranslation } from "react-i18next";

// Feature imports
import { useBGM, useAdjacentChapters, useProgress, UI_HIDE_DELAY, useProgressSync } from "../features/viewer";
import type { PDFOutlineItem } from "../features/viewer/components/PdfChapterViewer";
import { useViewerSync } from "../hooks/useViewerSync";
import { useReadingTime } from "../hooks/useReadingTime";
import type { UseChapterLoaderReturn } from "../features/viewer/hooks/useChapterLoader";
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

  // 네비게이션 제어
  const handleNext = useCallback(
    (delta: number | React.MouseEvent = 1) => {
      const d = typeof delta === "number" ? delta : 1;
      if (currentPage < totalPages) {
        goToPage(Math.min(currentPage + d, totalPages));
      } else if (nextChapterId) {
        navigate(`/viewer/${nextChapterId}`, { replace: true });
      }
    },
    [currentPage, totalPages, nextChapterId, goToPage, navigate],
  );

  const handlePrev = useCallback(
    (delta: number | React.MouseEvent = 1) => {
      const d = typeof delta === "number" ? delta : 1;
      if (currentPage > 1) {
        goToPage(Math.max(currentPage - d, 1));
      } else if (prevChapterId) {
        navigate(`/viewer/${prevChapterId}`, { replace: true });
      }
    },
    [currentPage, prevChapterId, goToPage, navigate],
  );

  // 키보드 네비게이션
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const isRtl = settings.readingDirection === "rtl";
      if (e.key === "ArrowRight") {
        if (isRtl) handlePrev(1);
        else handleNext(1);
      } else if (e.key === "ArrowLeft") {
        if (isRtl) handleNext(1);
        else handlePrev(1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNext, handlePrev, settings.readingDirection]);

  const handleBack = useCallback(() => {
    if (isDocumentFullscreen()) {
      exitFullscreen().catch(() => {});
    }
    navigate(`/series/${seriesId || ""}`);
  }, [navigate, seriesId]);

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

  // PDF 문서 로드 핸들러 (메모이제이션)
  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      setTotalPages(numPages);
    },
    [setTotalPages],
  );

  // Local State for Page Jump Modal and TOC
  const [showPageJump, setShowPageJump] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [tocItems, setTocItems] = useState<PDFOutlineItem[]>([]);

  const handleOutlineLoad = useCallback((outline: PDFOutlineItem[]) => {
    setTocItems(outline);
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

  // 뷰어 종료 시 전체화면 해제
  useEffect(() => {
    return () => {
      if (isDocumentFullscreen()) {
        exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // UI 자동 숨김 타이머
  useEffect(() => {
    let hideTimer: number | null = null;
    if (isUIVisible && !isSettingsOpen) {
      hideTimer = window.setTimeout(() => {
        useViewerStore.getState().hideUI();
      }, UI_HIDE_DELAY);
    }
    return () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
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
      onBack={handleBack}
      onToggleFullscreen={handleToggleFullscreen}
      onToggleSettings={toggleSettings}
      onToggleBgm={() => setIsBgmPlaying(!isBgmPlaying)}
      onToggleTOC={() => setShowTOC(!showTOC)}
      onDocumentLoad={handleDocumentLoad}
      onOutlineLoad={handleOutlineLoad}
      onNext={handleNext}
      onPrev={handlePrev}
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
      tSessionForceLogoutTitle={t("viewer.session.force_logout_title")}
    />
  );
}
