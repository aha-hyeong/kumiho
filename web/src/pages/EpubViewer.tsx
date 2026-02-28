import { useRef, useCallback, useState, useEffect, useMemo, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Settings,
  Maximize,
  Minimize,
  List,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import type { EpubFontFamily, EpubRenderMode, EpubViewerSettings, EpubTheme } from "../stores/epubViewerStore";
import {
  EpubChapterViewer,
  type EpubTOCItem,
  type EpubRenderLayout,
} from "../features/epub-viewer/components/EpubChapterViewer";
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
  onFontFamilyChange: (family: EpubFontFamily) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onRenderModeChange: (mode: EpubRenderMode) => void;
  onWheelDirectionChange: (direction: "down" | "up") => void;
  onKeyboardDirectionChange: (direction: "right" | "left") => void;
  onClickDirectionChange: (direction: "right" | "left") => void;
  onSpreadChange: (spread: "auto" | "none") => void;
  onReachedEndNext?: () => void;
  isEndNavigationReady?: boolean;
  onInitializationComplete?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
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
  onRenderModeChange,
  onWheelDirectionChange,
  onKeyboardDirectionChange,
  onClickDirectionChange,
  onSpreadChange,
  onReachedEndNext,
  isEndNavigationReady = true,
  onInitializationComplete,
  onInteractionStart,
  onInteractionEnd,
}: EpubViewerProps) {
  const { t } = useTranslation();
  const viewerRef = useRef<EpubChapterViewerHandles>(null);
  const bgColor = THEME_BG[settings.theme] || "#ffffff";
  const [currentChapterHref, setCurrentChapterHref] = useState("");
  const [effectiveLayout, setEffectiveLayout] = useState<EpubRenderLayout>("book");
  const [hoveredProgressRatio, setHoveredProgressRatio] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<{ ratio: number; label: string } | null>(null);
  const [pendingProgressRatio, setPendingProgressRatio] = useState<number | null>(null);
  const [chapterPageDisplay, setChapterPageDisplay] = useState(1);
  const [chapterTotalDisplay, setChapterTotalDisplay] = useState(1);

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
      if (location.chapterPage > 0) {
        setChapterPageDisplay(location.chapterPage);
      }
      if (location.chapterTotal > 0) {
        setChapterTotalDisplay(location.chapterTotal);
      }
      setPendingProgressRatio(null);
      onLocationChange(location);
    },
    [onLocationChange],
  );

  const handleNext = useCallback(() => {
    const isAtEnd = totalPages > 0 && currentPage >= totalPages;
    if (isAtEnd) {
      if (!isEndNavigationReady) return;
      onReachedEndNext?.();
      return;
    }
    setPendingProgressRatio(null);
    viewerRef.current?.next();
  }, [currentPage, totalPages, onReachedEndNext, isEndNavigationReady]);

  const handlePrev = useCallback(() => {
    setPendingProgressRatio(null);
    viewerRef.current?.prev();
  }, []);

  const handleTOCJump = useCallback((href: string) => {
    viewerRef.current?.goToCFI(href);
  }, []);

  const handleSpreadToggle = useCallback(() => {
    onSpreadChange(settings.spread === "auto" ? "none" : "auto");
  }, [settings.spread, onSpreadChange]);

  const chapterMarkers = useMemo(() => {
    const flat: Array<{ id: string; href: string; target: string; ratio: number; label: string }> = [];
    const walk = (items: EpubTOCItem[]) => {
      items.forEach((item) => {
        if (
          item.progressPrecision === "precise" &&
          typeof item.progressRatio === "number" &&
          Number.isFinite(item.progressRatio)
        ) {
          flat.push({
            id: item.id,
            href: item.href,
            target: item.navigationCfi || item.href,
            ratio: Math.max(0, Math.min(1, item.progressRatio)),
            label: item.label || "",
          });
        }
        if (item.subitems?.length) {
          walk(item.subitems);
        }
      });
    };
    walk(toc);
    const unique = new Map<string, { id: string; href: string; target: string; ratio: number; label: string }>();
    flat
      .sort((a, b) => a.ratio - b.ratio)
      .forEach((marker) => {
        const key = `${marker.ratio.toFixed(4)}-${marker.id}-${marker.target}`;
        if (!unique.has(key)) unique.set(key, marker);
      });
    return Array.from(unique.values());
  }, [toc]);

  const currentProgressRatio = useMemo(() => {
    if (pendingProgressRatio !== null) {
      return Math.max(0, Math.min(1, pendingProgressRatio));
    }
    if (totalPages > 1 && currentPage > 0) {
      return Math.max(0, Math.min(1, (currentPage - 1) / (totalPages - 1)));
    }
    return Math.max(0, Math.min(1, globalProgress / 100));
  }, [pendingProgressRatio, currentPage, totalPages, globalProgress]);

  const currentProgressPercent = useMemo(() => Math.round(currentProgressRatio * 100), [currentProgressRatio]);

  const ratioToPage = useCallback(
    (ratio: number) => {
      const total = Math.max(1, totalPages || 1);
      if (total <= 1) return 1;
      return Math.max(1, Math.min(total, Math.round(ratio * (total - 1)) + 1));
    },
    [totalPages],
  );

  const hoveredPage = useMemo(() => {
    if (hoveredMarker) {
      return ratioToPage(hoveredMarker.ratio);
    }
    if (hoveredProgressRatio === null) return null;
    return ratioToPage(hoveredProgressRatio);
  }, [hoveredMarker, hoveredProgressRatio, ratioToPage]);

  const hoveredChapterLabel = useMemo(() => {
    if (hoveredMarker) return hoveredMarker.label;
    if (hoveredProgressRatio === null || chapterMarkers.length === 0) return null;

    let current = chapterMarkers[0];
    for (let i = 1; i < chapterMarkers.length; i += 1) {
      if (chapterMarkers[i].ratio <= hoveredProgressRatio + 0.0001) {
        current = chapterMarkers[i];
      } else {
        break;
      }
    }
    return current.label;
  }, [hoveredMarker, hoveredProgressRatio, chapterMarkers]);

  const hoveredTooltipRatio = useMemo(() => {
    if (hoveredMarker) return hoveredMarker.ratio;
    return hoveredProgressRatio;
  }, [hoveredMarker, hoveredProgressRatio]);

  const getRatioFromEvent = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
    return Math.max(0, Math.min(1, ratio));
  }, []);

  const handleProgressHover = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      setHoveredProgressRatio(getRatioFromEvent(event));
    },
    [getRatioFromEvent],
  );

  const handleProgressLeave = useCallback(() => {
    setHoveredProgressRatio(null);
    setHoveredMarker(null);
  }, []);

  const handleProgressSeek = useCallback(
    (ratio: number) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      setPendingProgressRatio(clamped);
      if (viewerRef.current?.goToProgress) {
        viewerRef.current.goToProgress(clamped);
        return;
      }
      if (totalPages > 0 && viewerRef.current?.goToPage) {
        const targetPage = Math.min(totalPages, Math.max(1, Math.round(clamped * (totalPages - 1)) + 1));
        viewerRef.current.goToPage(targetPage);
      }
    },
    [totalPages],
  );

  const handleMainClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest("iframe")) return;
      if (target.closest("[data-epub-iframe-host='true']")) return;

      const interactive = target.closest("button, input, select, textarea, a[href], [contenteditable='true']");
      if (interactive) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const xRatio = (event.clientX - rect.left) / width;
      if (settings.flow !== "paginated") return;

      // iframe 바깥(main) 클릭은 UI 토글 없이 페이지 이동만 처리
      const isNext = settings.clickDirection === "right" ? xRatio >= 0.5 : xRatio < 0.5;
      if (isNext) {
        handleNext();
      } else {
        handlePrev();
      }
    },
    [handleNext, handlePrev, settings.flow, settings.clickDirection],
  );

  useEffect(() => {
    if (settings.flow !== "paginated") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
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
        onMouseEnter={onInteractionStart}
        onMouseLeave={onInteractionEnd}
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
              onRenderModeChange={onRenderModeChange}
              onWheelDirectionChange={onWheelDirectionChange}
              onKeyboardDirectionChange={onKeyboardDirectionChange}
              onClickDirectionChange={onClickDirectionChange}
              isTypographyControlLimited={effectiveLayout === "comic"}
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
      <main
        className={styles.main}
        onClick={handleMainClick}
      >
        <EpubChapterViewer
          key={chapterId}
          ref={viewerRef}
          epubUrl={epubUrl}
          chapterId={chapterId}
          chapterTitle={currentTocLabel}
          chapterPage={chapterPageDisplay}
          chapterTotal={chapterTotalDisplay}
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
          onRenderLayoutChange={setEffectiveLayout}
        />
      </main>

      {/* 푸터 */}
      {settings.flow === "paginated" && (
        <footer
          className={`${styles.footer} ${!isUIVisible ? styles.hidden : ""}`}
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={onInteractionStart}
          onMouseLeave={onInteractionEnd}
        >
          <div className={styles.footerControls}>
            <button
              className={styles.navBtn}
              onClick={() => viewerRef.current?.goToPage?.(1)}
              disabled={currentPage <= 1}
              aria-label={t("epub_viewer.footer.first_page")}
            >
              <ChevronsLeft size={20} />
            </button>
            <button
              className={styles.navBtn}
              onClick={handlePrev}
              disabled={currentPage <= 1}
              aria-label={t("epub_viewer.footer.prev_page")}
            >
              <ChevronLeft size={20} />
            </button>

            <div className={styles.pageSliderContainer}>
              <div className={styles.progressBarWrap}>
                <div
                  className={styles.progressBarInteractive}
                  onMouseMove={handleProgressHover}
                  onMouseLeave={handleProgressLeave}
                  onClick={(event) => handleProgressSeek(getRatioFromEvent(event))}
                  role="slider"
                  tabIndex={0}
                  aria-label={t("epub_viewer.footer.progress")}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={currentProgressPercent >= 0 ? currentProgressPercent : Math.round(currentProgressRatio * 100)}
                  onKeyDown={(event) => {
                    let nextRatio = currentProgressRatio;
                    const step = 0.05;
                    if (event.key === "ArrowRight") {
                      event.preventDefault();
                      nextRatio = Math.min(1, currentProgressRatio + step);
                    } else if (event.key === "ArrowLeft") {
                      event.preventDefault();
                      nextRatio = Math.max(0, currentProgressRatio - step);
                    } else if (event.key === "Home") {
                      event.preventDefault();
                      nextRatio = 0;
                    } else if (event.key === "End") {
                      event.preventDefault();
                      nextRatio = 1;
                    } else {
                      return;
                    }
                    handleProgressSeek(nextRatio);
                  }}
                >
                  <div className={styles.progressBarTrack}>
                    <div
                      className={styles.progressBarFill}
                      style={{ width: `${currentProgressRatio * 100}%` }}
                    />
                    <div
                      className={styles.progressBarThumb}
                      style={{ left: `${currentProgressRatio * 100}%` }}
                    />
                    {chapterMarkers.map((marker) => (
                      <button
                        key={`${marker.id}-${marker.href}-${marker.ratio}`}
                        type="button"
                        className={styles.progressMarker}
                        style={{ left: `${marker.ratio * 100}%` }}
                        title={marker.label || marker.href}
                        aria-label={t("epub_viewer.progress_marker.navigate", {
                          label: marker.label || marker.href,
                        })}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingProgressRatio(marker.ratio);
                          viewerRef.current?.goToCFI(marker.target);
                          (event.currentTarget as HTMLButtonElement).blur();
                        }}
                        onMouseEnter={() => setHoveredMarker({ ratio: marker.ratio, label: marker.label })}
                        onMouseLeave={() => setHoveredMarker(null)}
                      />
                    ))}
                  </div>
                  {hoveredTooltipRatio !== null && hoveredPage !== null && (
                    <div
                      className={styles.progressTooltip}
                      style={{ left: `${hoveredTooltipRatio * 100}%` }}
                    >
                      {hoveredChapterLabel && (
                        <span className={styles.progressTooltipLabel}>{hoveredChapterLabel}</span>
                      )}
                      <span>{hoveredPage} P</span>
                    </div>
                  )}
                </div>
              </div>
              <div className={styles.pageInfo}>
                {currentPage >= 0 && (
                  <span className={styles.pageInfoClickable}>
                    {currentPage > 0 && totalPages > 0 ? (
                      <>
                        {currentPage} / {totalPages} P
                      </>
                    ) : (
                      <>{Math.round(currentPage)}%</>
                    )}
                    {currentProgressPercent >= 0 && (
                      <span style={{ fontSize: "0.85em", opacity: 0.8, marginLeft: "8px" }}>
                        ({currentProgressPercent}%)
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            <button
              className={styles.navBtn}
              onClick={handleNext}
              disabled={currentPage >= totalPages && totalPages > 0 && (!onReachedEndNext || !isEndNavigationReady)}
              aria-label={t("epub_viewer.footer.next_page")}
            >
              <ChevronRight size={20} />
            </button>
            <button
              className={styles.navBtn}
              onClick={() => viewerRef.current?.goToPage?.(totalPages)}
              disabled={currentPage >= totalPages && totalPages > 0}
              aria-label={t("epub_viewer.footer.last_page")}
            >
              <ChevronsRight size={20} />
            </button>

            {/* 토글 버튼 (태블릿/데스크탑) */}
            <div className={styles.footerToggles}>
              <button
                className={`${styles.toggleBtn} ${settings.spread === "auto" ? styles.active : ""}`}
                onClick={handleSpreadToggle}
              >
                {settings.spread === "auto" ? t("epub_viewer.footer.pages_2") : t("epub_viewer.footer.pages_1")}
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
