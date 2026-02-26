import { useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Settings, Maximize, Minimize, List, Shield } from "lucide-react";
import type { EpubViewerSettings, EpubTheme, EpubFlow } from "../stores/epubViewerStore";
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
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isTOCOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  globalProgress: number;
  currentCFI: string | null;
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
  }) => void;
  onViewerClick: () => void; // iframe 내부 클릭 핸들러
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: string) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onFlowChange: (flow: EpubFlow) => void;
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
  currentPage,
  totalPages,
  isUIVisible,
  isSettingsOpen,
  isTOCOpen,
  isFullscreen,
  isIncognito,
  globalProgress,
  currentCFI,
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
  onFlowChange,
  onInitializationComplete,
}: EpubViewerProps) {
  const { t } = useTranslation();
  const viewerRef = useRef<EpubChapterViewerHandles>(null);
  const bgColor = THEME_BG[settings.theme] || "#ffffff";

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

      {/* 설정 패널 */}
      {isSettingsOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <EpubSettingsPanel
            settings={settings}
            onFontSizeChange={onFontSizeChange}
            onFontFamilyChange={onFontFamilyChange}
            onLineHeightChange={onLineHeightChange}
            onThemeChange={onThemeChange}
            onFlowChange={onFlowChange}
          />
        </div>
      )}

      {/* 목차 패널 */}
      {isTOCOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <EpubTOC
            toc={toc}
            onItemClick={handleTOCJump}
            currentCFI={currentCFI || initialCFI}
          />
        </div>
      )}

      {/* EPUB 뷰어 영역 */}
      <main className={styles.main}>
        <EpubChapterViewer
          key={chapterId}
          ref={viewerRef}
          epubUrl={epubUrl}
          initialCFI={initialCFI}
          settings={settings}
          onReady={onReady}
          onTOCLoad={onTOCLoad}
          onLocationChange={onLocationChange}
          onViewerClick={onViewerClick}
          onInitializationComplete={onInitializationComplete}
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

          <button
            className={styles.navBtn}
            onClick={handleNext}
          >
            {t("epub_viewer.footer.next")}
          </button>
        </footer>
      )}
    </div>
  );
}
