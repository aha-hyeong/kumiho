import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useViewerStore } from "../../stores/viewerStore";
import { seriesAPI } from "../../api/client";
import { toast } from "react-hot-toast";
import styles from "./ViewerSettings.module.css";
import { isMobile } from "../../utils/device";

interface ViewerSettingsProps {
  onClose: () => void;
}

export function ViewerSettings({ onClose }: ViewerSettingsProps) {
  const { t } = useTranslation();
  const isMobileDevice = isMobile();
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
    setPageTransition,
    setShowPdfZoomControls,
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
        toast.error(t("viewer.settings.alert.save_failed"));
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
          <span className={styles.settingsTitle}>{t("viewer.settings.title")}</span>
          <button
            className={styles.settingsClose}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.reading_mode.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "single" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "single", setReadingMode)}
            >
              {t("viewer.settings.reading_mode.single")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "double" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "double", setReadingMode)}
            >
              {t("viewer.settings.reading_mode.double")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingMode === "vertical" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_mode", "vertical", setReadingMode)}
            >
              {t("viewer.settings.reading_mode.vertical")}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.reading_direction.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.readingDirection === "ltr" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_direction", "ltr", setReadingDirection)}
            >
              {t("viewer.settings.reading_direction.ltr")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.readingDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => updateSetting("reading_direction", "rtl", setReadingDirection)}
            >
              {t("viewer.settings.reading_direction.rtl")}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.click_direction.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "ltr" ? styles.selected : ""}`}
              onClick={() => updateSetting("click_direction", "ltr", setClickDirection)}
            >
              {t("viewer.settings.click_direction.right")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.clickDirection === "rtl" ? styles.selected : ""}`}
              onClick={() => updateSetting("click_direction", "rtl", setClickDirection)}
            >
              {t("viewer.settings.click_direction.left")}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>
            {isMobileDevice
              ? t("viewer.settings.nav_direction.label_mobile")
              : t("viewer.settings.nav_direction.label_desktop")}
          </div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${
                (isMobileDevice ? settings.swipeDirection : settings.keyboardDirection) === "ltr" ? styles.selected : ""
              }`}
              onClick={() =>
                isMobileDevice
                  ? updateSetting("swipe_direction", "ltr", setSwipeDirection)
                  : updateSetting("keyboard_direction", "ltr", setKeyboardDirection)
              }
            >
              {isMobileDevice ? (
                <>
                  <span style={{ fontSize: "1.2em", marginRight: "4px" }}>⬅️</span>{" "}
                  {t("viewer.settings.nav_direction.ltr_mobile")}
                </>
              ) : (
                t("viewer.settings.nav_direction.ltr_desktop")
              )}
            </button>
            <button
              className={`${styles.optionBtn} ${
                (isMobileDevice ? settings.swipeDirection : settings.keyboardDirection) === "rtl" ? styles.selected : ""
              }`}
              onClick={() =>
                isMobileDevice
                  ? updateSetting("swipe_direction", "rtl", setSwipeDirection)
                  : updateSetting("keyboard_direction", "rtl", setKeyboardDirection)
              }
            >
              {isMobileDevice ? (
                <>
                  <span style={{ fontSize: "1.2em", marginRight: "4px" }}>➡️</span>{" "}
                  {t("viewer.settings.nav_direction.rtl_mobile")}
                </>
              ) : (
                t("viewer.settings.nav_direction.rtl_desktop")
              )}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.fit_mode.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "screen" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "screen", setFitMode)}
            >
              {t("viewer.settings.fit_mode.screen")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "width" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "width", setFitMode)}
            >
              {t("viewer.settings.fit_mode.width")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "height" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "height", setFitMode)}
            >
              {t("viewer.settings.fit_mode.height")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.fitMode === "original" ? styles.selected : ""}`}
              onClick={() => updateSetting("fit_mode", "original", setFitMode)}
            >
              {t("viewer.settings.fit_mode.original")}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.background_color.label")}</div>
          <div className={styles.colorOptions}>
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#000000" ? styles.selected : ""}`}
              style={{ background: "#000000" }}
              onClick={() => updateSetting("background_color", "#000000", setBackgroundColor)}
              aria-label={t("viewer.settings.background_color.black")}
              title={t("viewer.settings.background_color.black")}
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#1a1a1a" ? styles.selected : ""}`}
              style={{ background: "#1a1a1a" }}
              onClick={() => updateSetting("background_color", "#1a1a1a", setBackgroundColor)}
              aria-label={t("viewer.settings.background_color.dark_gray")}
              title={t("viewer.settings.background_color.dark_gray")}
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#333333" ? styles.selected : ""}`}
              style={{ background: "#333333" }}
              onClick={() => updateSetting("background_color", "#333333", setBackgroundColor)}
              aria-label={t("viewer.settings.background_color.gray")}
              title={t("viewer.settings.background_color.gray")}
            />
            <button
              className={`${styles.colorBtn} ${settings.backgroundColor === "#ffffff" ? styles.selected : ""}`}
              style={{ background: "#ffffff", border: "1px solid #ccc" }}
              onClick={() => updateSetting("background_color", "#ffffff", setBackgroundColor)}
              aria-label={t("viewer.settings.background_color.white")}
              title={t("viewer.settings.background_color.white")}
            />
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.page_transition.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.pageTransition === "slide" ? styles.selected : ""}`}
              onClick={() => updateSetting("page_transition", "slide", setPageTransition)}
            >
              {t("viewer.settings.page_transition.slide")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.pageTransition === "fade" ? styles.selected : ""}`}
              onClick={() => updateSetting("page_transition", "fade", setPageTransition)}
            >
              {t("viewer.settings.page_transition.fade")}
            </button>
            <button
              className={`${styles.optionBtn} ${settings.pageTransition === "none" ? styles.selected : ""}`}
              onClick={() => updateSetting("page_transition", "none", setPageTransition)}
            >
              {t("viewer.settings.page_transition.none")}
            </button>
          </div>
        </div>

        <div className={styles.settingsSection}>
          <div className={styles.settingsLabel}>{t("viewer.settings.pdf_zoom_controls.label")}</div>
          <div className={styles.settingsOptions}>
            <button
              className={`${styles.optionBtn} ${settings.showPdfZoomControls ? styles.selected : ""}`}
              onClick={() => setShowPdfZoomControls(true)}
            >
              {t("viewer.settings.pdf_zoom_controls.show")}
            </button>
            <button
              className={`${styles.optionBtn} ${!settings.showPdfZoomControls ? styles.selected : ""}`}
              onClick={() => setShowPdfZoomControls(false)}
            >
              {t("viewer.settings.pdf_zoom_controls.hide")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
