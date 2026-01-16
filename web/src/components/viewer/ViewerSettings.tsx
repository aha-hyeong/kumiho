import { X } from "lucide-react";
import { useViewerStore } from "../../stores/viewerStore";
import styles from "./ViewerSettings.module.css";

interface ViewerSettingsProps {
  onClose: () => void;
}

export function ViewerSettings({ onClose }: ViewerSettingsProps) {
  const { settings, setReadingMode, setReadingDirection, setClickDirection, setFitMode, setBackgroundColor } =
    useViewerStore();

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
              onClick={() => setReadingMode("single")}
            >
              한 페이지
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "double" ? styles.selected : ""}`}
              onClick={() => setReadingMode("double")}
            >
              두 페이지
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "vertical" ? styles.selected : ""}`}
              onClick={() => setReadingMode("vertical")}
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
              onClick={() => setReadingDirection("ltr")}
            >
              좌→우
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => setReadingDirection("rtl")}
            >
              우→좌
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>클릭 방향</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "ltr" ? styles.selected : ""}`}
              onClick={() => setClickDirection("ltr")}
            >
              좌→우
            </button>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => setClickDirection("rtl")}
            >
              우→좌
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>이미지 맞춤</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "screen" ? styles.selected : ""}`}
              onClick={() => setFitMode("screen")}
            >
              화면
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "width" ? styles.selected : ""}`}
              onClick={() => setFitMode("width")}
            >
              폭
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "height" ? styles.selected : ""}`}
              onClick={() => setFitMode("height")}
            >
              높이
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "original" ? styles.selected : ""}`}
              onClick={() => setFitMode("original")}
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
              onClick={() => setBackgroundColor("#000000")}
              aria-label="검정색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#1a1a1a" ? styles.selected : ""}`}
              style={{ background: "#1a1a1a" }}
              onClick={() => setBackgroundColor("#1a1a1a")}
              aria-label="어두운 회색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#333333" ? styles.selected : ""}`}
              style={{ background: "#333333" }}
              onClick={() => setBackgroundColor("#333333")}
              aria-label="회색 배경"
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#ffffff" ? styles.selected : ""}`}
              style={{ background: "#ffffff", border: "1px solid #ccc" }}
              onClick={() => setBackgroundColor("#ffffff")}
              aria-label="흰색 배경"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
