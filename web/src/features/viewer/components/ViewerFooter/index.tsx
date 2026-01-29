// 뷰어 하단 컨트롤 바 컴포넌트

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { seriesAPI } from "../../../../api/client";
import styles from "./ViewerFooter.module.css";
import type { ReadingMode } from "../../../../stores/viewerStore";

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
  onSliderChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onPageJumpClick: () => void;
  onReadingModeChange: (mode: ReadingMode) => void;
  onTogglePageOffset: () => void;
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
  onSliderChange,
  onPageJumpClick,
  onReadingModeChange,
  onTogglePageOffset,
}: ViewerFooterProps) {
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
    <footer className={`${styles.viewerFooter} ${!isUIVisible ? styles.hidden : ""}`}>
      <div className={styles.footerControls}>
        <button
          className={styles.navBtn}
          onClick={() => onGoToPage(1)}
          disabled={currentPage === 1}
        >
          <ChevronsLeft size={20} />
        </button>
        <button
          className={styles.navBtn}
          onClick={onPrev}
          disabled={currentPage === 1}
        >
          <ChevronLeft size={20} />
        </button>

        <div className={styles.pageSliderContainer}>
          <input
            type="range"
            className={styles.pageSlider}
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={onSliderChange}
          />
          <div className={styles.pageInfo}>
            <span
              className={styles.pageInfoClickable}
              onClick={onPageJumpClick}
            >
              {currentPage} / {totalPages}
            </span>
          </div>
        </div>

        <button
          className={styles.navBtn}
          onClick={onNext}
          disabled={currentPage >= totalPages && !nextChapterId}
        >
          <ChevronRight size={20} />
        </button>
        <button
          className={styles.navBtn}
          onClick={() => onGoToPage(totalPages)}
          disabled={currentPage >= totalPages}
        >
          <ChevronsRight size={20} />
        </button>

        {/* 토글 버튼 (태블릿/데스크탑) */}
        <div className={styles.footerToggles}>
          <button
            className={`${styles.toggleBtn} ${readingMode === "double" ? styles.active : ""}`}
            onClick={handleModeToggle}
          >
            {readingMode === "double" ? "2페이지" : "1페이지"}
          </button>
          <button
            className={`${styles.toggleBtn} ${pageOffset === 1 ? styles.active : ""}`}
            onClick={onTogglePageOffset}
          >
            오프셋 {pageOffset === 1 ? "+1" : "0"}
          </button>
        </div>
      </div>
    </footer>
  );
}
