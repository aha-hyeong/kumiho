// 뷰어 하단 컨트롤 바 컴포넌트

import { useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { seriesAPI } from "../../../../api/client";
import styles from "./ViewerFooter.module.css";
import type { ReadingMode } from "../../../../stores/viewerStore";

interface ViewerFooterMarker {
  id: string;
  page: number;
  label: string;
  destination?: string | unknown[] | null;
}

interface ViewerFooterProps {
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  readingMode: ReadingMode;
  pageOffset: number;
  seriesId: string | null;
  nextChapterId: string | null;
  onPrev: () => void;
  onNext: () => void;
  onGoToPage: (page: number) => void;
  onPageJumpClick: () => void;
  onReadingModeChange: (mode: ReadingMode) => void;
  onTogglePageOffset: () => void;
  tocMarkers?: ViewerFooterMarker[];
  onMarkerJump?: (marker: ViewerFooterMarker) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

export function ViewerFooter({
  currentPage,
  totalPages,
  isUIVisible,
  readingMode,
  pageOffset,
  seriesId,
  nextChapterId,
  onPrev,
  onNext,
  onGoToPage,
  onPageJumpClick,
  onReadingModeChange,
  onTogglePageOffset,
  tocMarkers = [],
  onMarkerJump,
  onInteractionStart,
  onInteractionEnd,
}: ViewerFooterProps) {
  const { t } = useTranslation();
  const [hoveredRatio, setHoveredRatio] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<ViewerFooterMarker | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const safeTotalPages = Math.max(1, totalPages);

  const currentRatio = useMemo(() => {
    if (safeTotalPages <= 1) return 0;
    return Math.max(0, Math.min(1, (currentPage - 1) / (safeTotalPages - 1)));
  }, [currentPage, safeTotalPages]);

  const normalizedMarkers = useMemo(() => {
    if (safeTotalPages <= 0 || tocMarkers.length === 0) return [];
    const markerByPage = new Map<number, ViewerFooterMarker>();
    tocMarkers.forEach((marker) => {
      const page = Math.max(1, Math.min(safeTotalPages, Math.round(marker.page)));
      if (!markerByPage.has(page)) {
        markerByPage.set(page, { ...marker, page });
      }
    });
    return Array.from(markerByPage.values()).sort((a, b) => a.page - b.page);
  }, [tocMarkers, safeTotalPages]);

  const getRatioFromClientX = useCallback((clientX: number, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const ratio = (clientX - rect.left) / Math.max(rect.width, 1);
    return Math.max(0, Math.min(1, ratio));
  }, []);

  const ratioToPage = useCallback(
    (ratio: number) => {
      if (safeTotalPages <= 1) return 1;
      return Math.max(1, Math.min(safeTotalPages, Math.round(ratio * (safeTotalPages - 1)) + 1));
    },
    [safeTotalPages],
  );

  const goToRatio = useCallback(
    (ratio: number) => {
      onGoToPage(ratioToPage(ratio));
    },
    [onGoToPage, ratioToPage],
  );

  const hoveredPage = useMemo(() => {
    if (hoveredMarker) return hoveredMarker.page;
    if (hoveredRatio === null) return null;
    return ratioToPage(hoveredRatio);
  }, [hoveredMarker, hoveredRatio, ratioToPage]);

  const hoveredTooltipRatio = useMemo(() => {
    if (hoveredMarker) {
      if (safeTotalPages <= 1) return 0;
      return (hoveredMarker.page - 1) / (safeTotalPages - 1);
    }
    return hoveredRatio;
  }, [hoveredMarker, hoveredRatio, safeTotalPages]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerType === "mouse" && event.button !== 0) return;
      const eventTarget = event.target as HTMLElement | null;
      if (eventTarget?.closest("[data-progress-marker='true']")) {
        return;
      }
      const target = event.currentTarget;
      target.setPointerCapture(event.pointerId);
      const ratio = getRatioFromClientX(event.clientX, target);
      setIsDragging(true);
      setHoveredRatio(ratio);
      setHoveredMarker(null);
      goToRatio(ratio);
    },
    [getRatioFromClientX, goToRatio],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement | null;
      if (!isDragging && target?.closest("[data-progress-marker='true']")) {
        return;
      }
      const ratio = getRatioFromClientX(event.clientX, event.currentTarget);
      if (isDragging) {
        goToRatio(ratio);
      }
      setHoveredRatio(ratio);
      setHoveredMarker(null);
    },
    [getRatioFromClientX, goToRatio, isDragging],
  );

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDragging(false);
  }, []);

  const handleModeToggle = async () => {
    const newMode = readingMode === "single" ? "double" : "single";
    onReadingModeChange(newMode);

    // 설정 저장
    if (seriesId) {
      try {
        await seriesAPI.updateViewerSettings(seriesId, { reading_mode: newMode });
      } catch (e) {
        console.error("설정 저장 실패:", e);
      }
    }
  };

  return (
    <footer
      className={`${styles.viewerFooter} ${!isUIVisible ? styles.hidden : ""}`}
      onMouseEnter={onInteractionStart}
      onMouseLeave={onInteractionEnd}
    >
      <div className={styles.footerControls}>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => onGoToPage(1)}
          disabled={currentPage === 1}
          aria-label="첫 페이지로 이동"
        >
          <ChevronsLeft size={20} />
        </button>
        <button
          type="button"
          className={styles.navBtn}
          onClick={onPrev}
          disabled={currentPage === 1}
          aria-label="이전 페이지로 이동"
        >
          <ChevronLeft size={20} />
        </button>

        <div className={styles.pageSliderContainer}>
          <div className={styles.progressBarWrap}>
            <div
              className={styles.progressBarInteractive}
              role="slider"
              tabIndex={0}
              aria-label={t("viewer.footer.progress", { defaultValue: "페이지 탐색" })}
              aria-valuemin={1}
              aria-valuemax={safeTotalPages}
              aria-valuenow={Math.max(1, currentPage)}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onMouseLeave={() => {
                if (isDragging) return;
                setHoveredRatio(null);
                setHoveredMarker(null);
              }}
              onKeyDown={(event) => {
                let nextPage = currentPage;
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  nextPage = Math.min(safeTotalPages, currentPage + 1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  nextPage = Math.max(1, currentPage - 1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  nextPage = 1;
                } else if (event.key === "End") {
                  event.preventDefault();
                  nextPage = safeTotalPages;
                } else {
                  return;
                }
                onGoToPage(nextPage);
              }}
            >
              <div className={styles.progressBarTrack}>
                <div
                  className={styles.progressBarFill}
                  style={{ width: `${currentRatio * 100}%` }}
                />
                <div
                  className={styles.progressBarThumb}
                  style={{ left: `${currentRatio * 100}%` }}
                />
                {normalizedMarkers.map((marker) => {
                  const markerRatio = safeTotalPages > 1 ? (marker.page - 1) / (safeTotalPages - 1) : 0;
                  return (
                    <button
                      key={`${marker.id}-${marker.page}`}
                      type="button"
                      data-progress-marker="true"
                      className={styles.progressMarker}
                      style={{ left: `${markerRatio * 100}%` }}
                      title={marker.label}
                      aria-label={t("viewer.footer.marker_jump", {
                        defaultValue: "목차로 이동: {{label}}",
                        label: marker.label,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (onMarkerJump) {
                          onMarkerJump(marker);
                          return;
                        }
                        onGoToPage(marker.page);
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                      onPointerUp={(event) => event.stopPropagation()}
                      onMouseEnter={() => setHoveredMarker(marker)}
                      onMouseLeave={() => setHoveredMarker(null)}
                    />
                  );
                })}
              </div>
              {hoveredTooltipRatio !== null && hoveredPage !== null && (
                <div
                  className={styles.progressTooltip}
                  style={{ left: `${hoveredTooltipRatio * 100}%` }}
                >
                  {hoveredMarker?.label && <span className={styles.progressTooltipLabel}>{hoveredMarker.label}</span>}
                  <span>{hoveredPage} P</span>
                </div>
              )}
            </div>
          </div>
          <div className={styles.pageInfo}>
            <button
              type="button"
              className={styles.pageInfoClickable}
              onClick={onPageJumpClick}
              aria-label="페이지 직접 입력"
            >
              {currentPage} / {totalPages}
            </button>
          </div>
        </div>

        <button
          type="button"
          className={styles.navBtn}
          onClick={onNext}
          disabled={currentPage >= totalPages && !nextChapterId}
          aria-label="다음 페이지로 이동"
        >
          <ChevronRight size={20} />
        </button>
        <button
          type="button"
          className={styles.navBtn}
          onClick={() => onGoToPage(totalPages)}
          disabled={currentPage >= totalPages}
          aria-label="마지막 페이지로 이동"
        >
          <ChevronsRight size={20} />
        </button>

        {/* 토글 버튼 (태블릿/데스크탑) */}
        <div className={styles.footerToggles}>
          <button
            className={`${styles.toggleBtn} ${readingMode === "double" ? styles.active : ""}`}
            onClick={handleModeToggle}
          >
            {readingMode === "double" ? t("viewer.footer.pages_2") : t("viewer.footer.pages_1")}
          </button>
          <button
            className={`${styles.toggleBtn} ${pageOffset === 1 ? styles.active : ""}`}
            onClick={onTogglePageOffset}
          >
            {t("viewer.footer.offset")} {pageOffset === 1 ? "+1" : "0"}
          </button>
        </div>
      </div>
    </footer>
  );
}
