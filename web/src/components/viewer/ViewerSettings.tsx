import { X } from "lucide-react";
import { useViewerStore } from "../../stores/viewerStore";
import { seriesAPI } from "../../api/client";
import { toast } from "react-hot-toast";
import styles from "./ViewerSettings.module.css";
import { isMobile } from "../../utils/device";

interface ViewerSettingsProps {
  onClose: () => void;
}

export function ViewerSettings({ onClose }: ViewerSettingsProps) {
  const {
    settings,
    currentSeriesId,
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setSwipeDirection,
    setFitMode,
    setBackgroundColor,
  } = useViewerStore();

  // 설정 변경 및 서버 동기화 핸들러
  const updateSetting = async <T extends string | number | boolean>(
    key: string,
    value: T,
    storeFn: (val: T) => void,
  ) => {
    // 1. 스토어 상태 즉시 업데이트 (반응성 확보)
    storeFn(value);

    // 2. 시리즈 개별 설정인 경우 서버에 저장
    if (currentSeriesId) {
      try {
        await seriesAPI.updateViewerSettings(currentSeriesId, { [key]: value });
      } catch (error) {
        console.error("Failed to sync viewer settings to server:", error);
        toast.error("설정 저장에 실패했습니다.");
      }
    }
  };

  return (
    <div
      className={styles.settingsOverlay}
      onClick={onClose}
    >
      <div
        className={styles.settingsPanel}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.settingsHeader}>
          <span className={styles.settingsTitle}>⚙️ 읽기 설정</span>
          <button
            className={styles.settingsClose}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>보기 모드</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "single" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "single", setReadingMode)}
            >
              한 페이지
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "double" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "double", setReadingMode)}
            >
              두 페이지
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "vertical" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "vertical", setReadingMode)}
            >
              세로 스크롤
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>읽기 방향</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.readingDirection === "ltr" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_direction", "ltr", setReadingDirection)}
            >
              좌→우
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_direction", "rtl", setReadingDirection)}
            >
              우→좌
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>다음 페이지 클릭</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "ltr" ? styles.selected : ""}`}
              onClick={() => updateSetting("click_direction", "ltr", setClickDirection)}
            >
              오른쪽 클릭
            </button>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => updateSetting("click_direction", "rtl", setClickDirection)}
            >
              왼쪽 클릭
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>
            {isMobile() ? "페이지 넘김 방향 (스와이프)" : "페이지 넘김 방향 (키보드)"}
          </div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${
                (isMobile() ? settings.swipeDirection : settings.keyboardDirection) === "ltr" ? styles.selected : ""
              }`}
              onClick={() =>
                isMobile()
                  ? updateSetting("swipe_direction", "ltr", setSwipeDirection)
                  : updateSetting("keyboard_direction", "ltr", setKeyboardDirection)
              }
            >
              {isMobile() ? (
                <>
                  <span style={{ fontSize: "1.2em", marginRight: "4px" }}>⬅️</span> 왼쪽 (다음)
                </>
              ) : (
                "오른쪽 화살표"
              )}
            </button>
            <button
              className={`${styles.optionBtn} ${
                (isMobile() ? settings.swipeDirection : settings.keyboardDirection) === "rtl" ? styles.selected : ""
              }`}
              onClick={() =>
                isMobile()
                  ? updateSetting("swipe_direction", "rtl", setSwipeDirection)
                  : updateSetting("keyboard_direction", "rtl", setKeyboardDirection)
              }
            >
              {isMobile() ? (
                <>
                  <span style={{ fontSize: "1.2em", marginRight: "4px" }}>➡️</span> 오른쪽 (다음)
                </>
              ) : (
                "왼쪽 화살표"
              )}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>이미지 맞춤</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "screen" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "screen", setFitMode)}
            >
              화면
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "width" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "width", setFitMode)}
            >
              폭
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "height" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "height", setFitMode)}
            >
              높이
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "original" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "original", setFitMode)}
            >
              원본
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>배경색</div>
          <div className={styles.colorOptions}>
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#000000" ? styles.selected : ""}`}
              style={{ background: "#000000" }}
              onClick={() => updateSetting("background_color", "#000000", setBackgroundColor)}
              aria-label="검정색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#1a1a1a" ? styles.selected : ""}`}
              style={{ background: "#1a1a1a" }}
              onClick={() => updateSetting("background_color", "#1a1a1a", setBackgroundColor)}
              aria-label="어두운 회색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#333333" ? styles.selected : ""}`}
              style={{ background: "#333333" }}
              onClick={() => updateSetting("background_color", "#333333", setBackgroundColor)}
              aria-label="회색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#ffffff" ? styles.selected : ""}`}
              style={{ background: "#ffffff", border: "1px solid #ccc" }}
              onClick={() => updateSetting("background_color", "#ffffff", setBackgroundColor)}
              aria-label="흰색 배경"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
