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
    pageOffset: number;
    pageTransition: PageTransitionType;
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
  onGoToPage: (page: number) => void;
  onSliderChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
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
  tSessionForceLogoutTitle: string;
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
  onGoToPage,
  onSliderChange,
  onPageJumpClick,
  onReadingModeChange,
  onTogglePageOffset,
  onCloseSettings,
  onClosePageJump,
  onPageJump,
  onConfirmSync,
  onCloseSync,
  onConfirmTerminated,
  tSessionForceLogoutTitle,
  animationRef,
  showZoomControls,
  zoomPercent,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomChange,
}: PdfViewerProps) {
  const backgroundClassName = getBackgroundClassName(settings.backgroundColor);

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
        title={chapterTitle}
        currentPage={currentPage}
        totalPages={totalPages}
        isUIVisible={isUIVisible}
        isIncognito={isIncognito}
        isFullscreen={isFullscreen}
        bgmInfo={bgmInfo}
        isBgmPlaying={isBgmPlaying}
        hasTOC={tocItems && tocItems.length > 0}
        showZoomControls={showZoomControls}
        zoomPercent={zoomPercent}
        onBack={onBack}
        onToggleFullscreen={onToggleFullscreen}
        onToggleSettings={onToggleSettings}
        onToggleBgm={onToggleBgm}
        onToggleTOC={onToggleTOC}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
      />

      <div className={`${viewerStyles.viewerContent} ${styles.viewerContent}`}>
        <PdfChapterViewer
          ref={animationRef}
          chapterId={chapterId}
          currentPage={currentPage}
          fitMode={settings.fitMode}
          readingMode={settings.readingMode}
          readingDirection={settings.readingDirection}
          pageOffset={settings.pageOffset}
          onDocumentLoad={onDocumentLoad}
          onOutlineLoad={onOutlineLoad}
          onNext={onNext}
          onPrev={onPrev}
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
        onSliderChange={onSliderChange}
        onPageJumpClick={onPageJumpClick}
        onReadingModeChange={onReadingModeChange}
        onTogglePageOffset={onTogglePageOffset}
      />

      {isSettingsOpen && <ViewerSettingsModal onClose={onCloseSettings} />}

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
        title={tSessionForceLogoutTitle}
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
