import { useRef, useCallback, useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Settings, Maximize, Minimize, List, Shield } from "lucide-react";
import type { EpubViewerSettings, EpubTheme } from "../stores/epubViewerStore";
import { EpubChapterViewer, type EpubTOCItem } from "../features/epub-viewer/components/EpubChapterViewer";
import type { EpubChapterViewerHandles } from "../features/epub-viewer/components/EpubChapterViewer";
import { EpubSettingsPanel } from "../features/epub-viewer/components/EpubSettingsPanel";
import { EpubTOC } from "../features/epub-viewer/components/EpubTOC";
import styles from "./EpubViewer.module.css";

interface EpubViewerProps {
  chapterTitle: string;
  chapterId: string;
  epubUrl: string;
  initialCFI?: string | null;
  initialProgressRatio?: number | null;
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isTOCOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  globalProgress: number;
  currentChapterHref?: string;
  toc: EpubTOCItem[];
  settings: EpubViewerSettings;
  onBack: () => void;
  onToggleSettings: () => void;
  onToggleTOC: () => void;
  onToggleFullscreen: () => void;
  onReady: (totalPages: number) => void;
  onTOCLoad: (toc: EpubTOCItem[]) => void;
  onLocationChange: (location: {
    cfi: string;
    chapterPage: number;
    chapterTotal: number;
    globalRatio: number;
    currentPosition: number;
    totalPositions: number;
    chapterHref: string;
  }) => void;
  onViewerClick: () => void; // iframe 내부 클릭 핸들러
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: string) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onWheelDirectionChange: (direction: "down" | "up") => void;
  onKeyboardDirectionChange: (direction: "right" | "left") => void;
  onSpreadChange: (spread: "auto" | "none") => void;
  onInitializationComplete?: () => void;
}

const THEME_BG: Record<string, string> = {
  light: "#ffffff",
  dark: "#1a1a1a",
  sepia: "#f4ecd8",
};

export function EpubViewer({
  chapterTitle,
  chapterId,
  epubUrl,
  initialCFI,
  initialProgressRatio,
  currentPage,
  totalPages,
  isUIVisible,
  isSettingsOpen,
  isTOCOpen,
  isFullscreen,
  isIncognito,
  globalProgress,
  toc,
  settings,
  onBack,
  onToggleSettings,
  onToggleTOC,
  onToggleFullscreen,
  onReady,
  onTOCLoad,
  onLocationChange,
  onViewerClick,
  onFontSizeChange,
  onFontFamilyChange,
  onLineHeightChange,
  onThemeChange,
  onWheelDirectionChange,
  onKeyboardDirectionChange,
  onSpreadChange,
  onInitializationComplete,
}: EpubViewerProps) {
  const { t } = useTranslation();
  const viewerRef = useRef<EpubChapterViewerHandles>(null);
  const bgColor = THEME_BG[settings.theme] || "#ffffff";
  const [currentChapterHref, setCurrentChapterHref] = useState("");

  const currentTocLabel = useMemo(() => {
    const currentBase = currentChapterHref.split("#")[0];
    if (!currentBase) return chapterTitle;

    const findLabel = (items: EpubTOCItem[]): string | null => {
      for (const item of items) {
        const itemBase = item.href.split("#")[0];
        if (itemBase === currentBase) {
          return item.label || null;
        }
        if (item.subitems?.length) {
          const sub = findLabel(item.subitems);
          if (sub) return sub;
        }
      }
      return null;
    };

    return findLabel(toc) || chapterTitle;
  }, [currentChapterHref, toc, chapterTitle]);

  const wrappedLocationChange = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
      chapterHref: string;
    }) => {
      setCurrentChapterHref(location.chapterHref);
      onLocationChange(location);
    },
    [onLocationChange],
  );

  const handleNext = useCallback(() => {
    viewerRef.current?.next();
  }, []);

  const handlePrev = useCallback(() => {
    viewerRef.current?.prev();
  }, []);

  const handleTOCJump = useCallback(
    (href: string) => {
      viewerRef.current?.goToCFI(href);
      onToggleTOC();
    },
    [onToggleTOC],
  );

  const handleSpreadToggle = useCallback(() => {
    onSpreadChange(settings.spread === "auto" ? "none" : "auto");
  }, [settings.spread, onSpreadChange]);

  useEffect(() => {
    if (settings.flow !== "paginated") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" ||
        tagName === "textarea" ||
        tagName === "select" ||
        Boolean(target?.isContentEditable);
      if (isEditable) return;

      const nextArrowKey = settings.keyboardDirection === "right" ? "ArrowRight" : "ArrowLeft";
      const prevArrowKey = settings.keyboardDirection === "right" ? "ArrowLeft" : "ArrowRight";

      if (event.key === nextArrowKey || event.key === "PageDown") {
        event.preventDefault();
        handleNext();
      } else if (event.key === prevArrowKey || event.key === "PageUp") {
        event.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.keyboardDirection, settings.flow, handleNext, handlePrev]);

  return (
    <div
      className={styles.root}
      style={{ background: bgColor }}
      data-incognito={isIncognito}
    >
      {/* 헤더 */}
      <header
        className={`${styles.header} ${isUIVisible ? styles.visible : styles.hidden}`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className={styles.iconBtn}
          onClick={onBack}
          title={t("epub_viewer.header.back")}
          aria-label={t("epub_viewer.header.back")}
        >
          <ArrowLeft size={24} />
        </button>

        <div className={styles.headerTitle}>
          {isIncognito && (
            <div
              className={styles.headerIcon}
              aria-label={t("epub_viewer.header.incognito")}
            >
              <Shield size={20} />
            </div>
          )}
          <span className={styles.chapterTitle}>{chapterTitle}</span>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={onToggleFullscreen}
            title={isFullscreen ? t("epub_viewer.header.exit_fullscreen") : t("epub_viewer.header.fullscreen")}
            aria-label={isFullscreen ? t("epub_viewer.header.exit_fullscreen") : t("epub_viewer.header.fullscreen")}
          >
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
          <button
            className={`${styles.iconBtn} ${isTOCOpen ? styles.active : ""}`}
            onClick={onToggleTOC}
            title={t("epub_viewer.header.toc")}
            aria-label={t("epub_viewer.header.toc")}
          >
            <List size={24} />
          </button>
          <button
            className={`${styles.iconBtn} ${isSettingsOpen ? styles.active : ""}`}
            onClick={onToggleSettings}
            title={t("epub_viewer.header.settings")}
            aria-label={t("epub_viewer.header.settings")}
          >
            <Settings size={24} />
          </button>
        </div>
      </header>

      {/* 설정 패널 + 백드롭 */}
      {isSettingsOpen && (
        <>
          <div
            className={styles.backdrop}
            onClick={onToggleSettings}
          />
          <div onClick={(e) => e.stopPropagation()}>
            <EpubSettingsPanel
              settings={settings}
              onFontSizeChange={onFontSizeChange}
              onFontFamilyChange={onFontFamilyChange}
              onLineHeightChange={onLineHeightChange}
              onThemeChange={onThemeChange}
              onWheelDirectionChange={onWheelDirectionChange}
              onKeyboardDirectionChange={onKeyboardDirectionChange}
            />
          </div>
        </>
      )}

      {/* 목차 패널 + 백드롭 */}
      {isTOCOpen && (
        <>
          <div
            className={styles.backdrop}
            onClick={onToggleTOC}
          />
          <div onClick={(e) => e.stopPropagation()}>
            <EpubTOC
              toc={toc}
              onItemClick={handleTOCJump}
              currentChapterHref={currentChapterHref}
            />
          </div>
        </>
      )}

      {/* EPUB 뷰어 영역 */}
      <main className={styles.main}>
        <EpubChapterViewer
          key={chapterId}
          ref={viewerRef}
          epubUrl={epubUrl}
          chapterId={chapterId}
          chapterTitle={currentTocLabel}
          chapterPage={currentPage}
          chapterTotal={totalPages}
          isUIVisible={isUIVisible}
          initialCFI={initialCFI}
          initialProgressRatio={initialProgressRatio}
          settings={settings}
          onReady={onReady}
          onTOCLoad={onTOCLoad}
          onLocationChange={wrappedLocationChange}
          onViewerClick={onViewerClick}
          onInitializationComplete={onInitializationComplete}
          onPageNext={handleNext}
          onPagePrev={handlePrev}
        />
      </main>

      {/* 푸터 */}
      {settings.flow === "paginated" && (
        <footer
          className={`${styles.footer} ${isUIVisible ? styles.visible : styles.hidden}`}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className={styles.navBtn}
            onClick={handlePrev}
          >
            {t("epub_viewer.footer.prev")}
          </button>

          <div className={styles.pageInfo}>
            {currentPage >= 0 && (
              <span>
                {currentPage > 0 && totalPages > 0 ? (
                  <>
                    {currentPage} / {totalPages} P
                  </>
                ) : (
                  <>{Math.round(currentPage)}%</>
                )}
                {/* 전체 진행도(%) 표시 */}
                {globalProgress >= 0 && (
                  <span style={{ fontSize: "0.85em", opacity: 0.8, marginLeft: "8px" }}>
                    ({Math.round(globalProgress)}%)
                  </span>
                )}
              </span>
            )}
          </div>

          <div className={styles.footerActions}>
            <button
              className={`${styles.toggleBtn} ${settings.spread === "auto" ? styles.active : ""}`}
              onClick={handleSpreadToggle}
            >
              {settings.spread === "auto" ? t("epub_viewer.footer.pages_2") : t("epub_viewer.footer.pages_1")}
            </button>
            <button
              className={styles.navBtn}
              onClick={handleNext}
            >
              {t("epub_viewer.footer.next")}
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
