import { useMemo } from "react";
import type React from "react";
import { ViewerSettings as ViewerSettingsModal } from "../components/viewer/ViewerSettings";
import { ViewerHeader, ViewerFooter, PageJumpModal, SyncConfirmModal } from "../features/viewer";
import { AlertModal } from "../components/modals/AlertModal";
import { PdfChapterViewer, type PDFOutlineItem } from "../features/viewer/components/PdfChapterViewer";
import { PdfTOC } from "../features/viewer/components/PdfTOC";
import { type ReadingDirection, type ReadingMode, type PageTransitionType } from "../stores/viewerStore";
import type { BGMInfo, ViewerAnimationHandles } from "../features/viewer/types";
import viewerStyles from "./Viewer.module.css";
import styles from "./PdfViewer.module.css";

interface PdfViewerProps {
  chapterTitle: string;
  chapterId: string;
  seriesId?: string;
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  settings: {
    backgroundColor: string;
    fitMode: string;
    readingMode: ReadingMode;
    readingDirection: ReadingDirection;
    wheelDirection: "down" | "up";
    pageOffset: number;
    pageTransition: PageTransitionType;
    preloadCount: number;
  };
  bgmInfo: BGMInfo | null;
  isBgmPlaying: boolean;
  showPageJump: boolean;
  showSyncModal: boolean;
  showTOC: boolean;
  tocItems: PDFOutlineItem[];
  serverProgress: {
    volume_number: number;
    chapter_number: number;
    current_page: number;
  } | null;
  terminatedInfo: { isOpen: boolean; reason: string };
  nextChapterId: string | null;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  animationRef?: React.RefObject<ViewerAnimationHandles>;
  showZoomControls: boolean;
  zoomPercent: number;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onToggleSettings: () => void;
  onToggleBgm: () => void;
  onToggleTOC: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onDocumentLoad: (numPages: number) => void;
  onOutlineLoad: (outline: PDFOutlineItem[]) => void;
  onNext: (delta?: number | React.MouseEvent) => void;
  onPrev: (delta?: number | React.MouseEvent) => void;
  onPageChange?: (page: number) => void;
  onGoToPage: (page: number) => void;
  onZoomChange?: (scale: number) => void;
  onPageJumpClick: () => void;
  onReadingModeChange: (mode: ReadingMode) => void;
  onTogglePageOffset: () => void;
  onCloseSettings: () => void;
  onClosePageJump: () => void;
  onPageJump: (page: number) => void;
  onConfirmSync: () => void;
  onCloseSync: () => void;
  onConfirmTerminated: () => void;
  sessionForceLogoutTitle: string;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

export function PdfViewer({
  chapterTitle,
  chapterId,
  seriesId,
  currentPage,
  totalPages,
  isUIVisible,
  isSettingsOpen,
  isFullscreen,
  isIncognito,
  settings,
  bgmInfo,
  isBgmPlaying,
  showPageJump,
  showSyncModal,
  showTOC,
  tocItems,
  serverProgress,
  terminatedInfo,
  nextChapterId,
  audioRef,
  onBack,
  onToggleFullscreen,
  onToggleSettings,
  onToggleBgm,
  onToggleTOC,
  onDocumentLoad,
  onOutlineLoad,
  onNext,
  onPrev,
  onPageChange,
  onGoToPage,
  onPageJumpClick,
  onReadingModeChange,
  onTogglePageOffset,
  onCloseSettings,
  onClosePageJump,
  onPageJump,
  onConfirmSync,
  onCloseSync,
  onConfirmTerminated,
  sessionForceLogoutTitle,
  onInteractionStart,
  onInteractionEnd,
  animationRef,
  showZoomControls,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomChange,
}: PdfViewerProps) {
  const backgroundClassName = getBackgroundClassName(settings.backgroundColor);
  const tocMarkers = useMemo(() => {
    const flat: Array<{ id: string; page: number; label: string; destination?: string | unknown[] | null }> = [];
    const walk = (items: PDFOutlineItem[], parentPath = "toc") => {
      items.forEach((item, index) => {
        const path = `${parentPath}-${index}`;
        if (typeof item.pageNumber === "number" && Number.isFinite(item.pageNumber) && item.pageNumber > 0) {
          flat.push({
            id: path,
            page: item.pageNumber,
            label: item.title?.trim() || `Page ${item.pageNumber}`,
            destination: item.destination,
          });
        }
        if (item.items?.length) {
          walk(item.items, path);
        }
      });
    };
    walk(tocItems);
    return flat;
  }, [tocItems]);

  const handleMarkerJump = async (marker: { page: number; destination?: string | unknown[] | null }) => {
    const exactPage = await animationRef?.current?.jumpToDestination?.(marker.destination);
    onGoToPage(exactPage ?? marker.page);
  };

  return (
    <div className={`${viewerStyles.viewerContainer} ${styles.viewerRoot} ${backgroundClassName}`}>
      {bgmInfo?.exists && bgmInfo.url && (
        <audio
          ref={audioRef}
          src={bgmInfo.url}
          playsInline
        />
      )}

      <ViewerHeader
        state={{
          title: chapterTitle,
          currentPage: currentPage,
          totalPages: totalPages,
          isUIVisible: isUIVisible,
          isIncognito: isIncognito,
          isFullscreen: isFullscreen,
          bgmInfo: bgmInfo,
          isBgmPlaying: isBgmPlaying,
        }}
        actions={{
          onBack: onBack,
          onToggleFullscreen: onToggleFullscreen,
          onToggleSettings: onToggleSettings,
          onToggleBgm: onToggleBgm,
        }}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
        pdfOptions={
          showZoomControls
            ? {
                showZoomControls: true,
                hasTOC: tocItems && tocItems.length > 0,
                onToggleTOC,
                zoomPercent,
                onZoomIn,
                onZoomOut,
                onZoomReset,
              }
            : {
                showZoomControls: false,
                hasTOC: tocItems && tocItems.length > 0,
                onToggleTOC,
              }
        }
      />

      <div
        className={`${viewerStyles.viewerContent} ${styles.viewerContent} ${settings.readingMode === "vertical" ? viewerStyles.modeVertical : ""}`}
      >
        <PdfChapterViewer
          ref={animationRef}
          chapterId={chapterId}
          currentPage={currentPage}
          fitMode={settings.fitMode}
          readingMode={settings.readingMode}
          readingDirection={settings.readingDirection}
          wheelDirection={settings.wheelDirection}
          pageOffset={settings.pageOffset}
          preloadCount={settings.preloadCount}
          onDocumentLoad={onDocumentLoad}
          onOutlineLoad={onOutlineLoad}
          onNext={onNext}
          onPrev={onPrev}
          onPageChange={onPageChange}
          transitionType={settings.pageTransition}
          onZoomChange={onZoomChange}
        />
      </div>

      <PdfTOC
        isOpen={showTOC}
        items={tocItems}
        onClose={onToggleTOC}
        onJump={onGoToPage}
        currentPage={currentPage}
      />

      <ViewerFooter
        currentPage={currentPage}
        totalPages={totalPages}
        isUIVisible={isUIVisible}
        readingMode={settings.readingMode}
        pageOffset={settings.pageOffset}
        seriesId={seriesId ?? null}
        nextChapterId={nextChapterId}
        onPrev={onPrev}
        onNext={onNext}
        onGoToPage={onGoToPage}
        onPageJumpClick={onPageJumpClick}
        onReadingModeChange={onReadingModeChange}
        onTogglePageOffset={onTogglePageOffset}
        tocMarkers={tocMarkers}
        onMarkerJump={handleMarkerJump}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />

      {isSettingsOpen && (
        <ViewerSettingsModal
          onClose={onCloseSettings}
          showPdfControlsOption
        />
      )}

      <PageJumpModal
        show={showPageJump}
        totalPages={totalPages}
        onClose={onClosePageJump}
        onJump={onPageJump}
      />

      <SyncConfirmModal
        show={showSyncModal}
        serverProgress={serverProgress}
        onConfirm={onConfirmSync}
        onClose={onCloseSync}
      />

      <AlertModal
        isOpen={terminatedInfo.isOpen}
        type="warning"
        title={sessionForceLogoutTitle}
        message={terminatedInfo.reason}
        onConfirm={onConfirmTerminated}
      />
    </div>
  );
}

function getBackgroundClassName(color: string): string {
  switch (color.toLowerCase()) {
    case "#ffffff":
      return styles.bgWhite;
    case "#333333":
      return styles.bgGray;
    case "#1a1a1a":
      return styles.bgDark;
    case "#000000":
    default:
      return styles.bgBlack;
  }
}
