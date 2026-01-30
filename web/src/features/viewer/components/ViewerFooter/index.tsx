// 뷰어 하단 컨트롤 바 컴포넌트

import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();

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
          <input
            type="range"
            className={styles.pageSlider}
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={onSliderChange}
            aria-label="페이지 탐색"
          />
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
