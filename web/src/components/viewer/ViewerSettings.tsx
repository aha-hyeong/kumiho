import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useViewerStore, type ReadingMode, type ReadingDirection } from "../../stores/viewerStore";
import { seriesAPI, settingAPI } from "../../api/client";
import { toast } from "react-hot-toast";
import styles from "./ViewerSettings.module.css";
import { isMobile } from "../../utils/device";

interface ViewerSettingsProps {
  onClose: () => void;
  showPdfControlsOption?: boolean;
  showTextTypographyOption?: boolean;
  onReadingModeChange?: (mode: ReadingMode) => void;
}

type ViewerTheme = "light" | "dark" | "sepia";

const VIEWER_THEME_TO_BACKGROUND: Record<ViewerTheme, string> = {
  light: "#ffffff",
  dark: "#1a1a1a",
  sepia: "#f4ecd8",
};

const resolveThemeFromBackground = (backgroundColor: string): ViewerTheme => {
  const normalized = backgroundColor.trim().toLowerCase();
  if (normalized === "#ffffff") return "light";
  if (normalized === "#f4ecd8") return "sepia";
  return "dark";
};

export function ViewerSettings({
  onClose,
  showPdfControlsOption = false,
  showTextTypographyOption = false,
  onReadingModeChange,
}: ViewerSettingsProps) {
  const { t } = useTranslation();
  const isMobileDevice = isMobile();
  const contentRef = useRef<HTMLDivElement>(null);
  const [hasScrollbar, setHasScrollbar] = useState(false);
  const {
    settings,
    currentSeriesId,
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setWheelDirection,
    seriesSettings,
    beginSwipeMutation,
    isSwipeMutationCurrent,
    commitSwipeMutation,
    rollbackSwipeMutation,
    finishSwipeMutation,
    isSwipeSaving,
    setFitMode,
    setBackgroundColor,
    setPageTransition,
    setShowPdfZoomControls,
    setFontSize,
    setFontFamily,
    setLineHeight,
  } = useViewerStore();
  const selectedTheme = resolveThemeFromBackground(settings.backgroundColor);

  const updateScrollbarState = useCallback(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;
    setHasScrollbar(contentEl.scrollHeight > contentEl.clientHeight + 1);
  }, []);

  // 설정 변경 및 서버 동기화 핸들러
  const updateSetting = async <T extends string | number | boolean>(
    key: string,
    value: T,
    storeFn: (val: T) => void,
  ) => {
    // 1. 스토어 상태 즉시 업데이트 (반응성 확보)
    storeFn(value);

    // page_transition / show_pdf_zoom_controls는 전역 Setting API로 저장
    // (시리즈 개별 설정 API에는 아직 해당 필드가 없어 무시될 수 있음)
    if (key === "page_transition") {
      try {
        await settingAPI.update("viewer_page_transition", { value: String(value) });
      } catch (error) {
        console.error("Failed to sync viewer_page_transition to server:", error);
        toast.error(t("viewer.settings.alert.save_failed"));
      }
      return;
    }
    if (key === "show_pdf_zoom_controls") {
      try {
        await settingAPI.update("viewer_show_pdf_zoom_controls", { value: value ? "true" : "false" });
      } catch (error) {
        console.error("Failed to sync viewer_show_pdf_zoom_controls to server:", error);
        toast.error(t("viewer.settings.alert.save_failed"));
      }
      return;
    }

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

  // Keep the optimistic change immediate, but restore only the affected series
  // on failure. The store-level busy flag also survives closing/reopening the UI.
  const saveSwipeDirection = async (override: ReadingDirection | null) => {
    const state = useViewerStore.getState();
    const seriesId = state.currentSeriesId;
    if (!seriesId || state.isSwipeSaving) return;
    const token = beginSwipeMutation(seriesId, override);
    try {
      if (override === null) {
        const swipeSettings = await seriesAPI.resetSwipeDirection(seriesId);
        commitSwipeMutation(token, swipeSettings);
      } else {
        await seriesAPI.updateViewerSettings(seriesId, { swipe_direction: override });
        commitSwipeMutation(token);
      }
    } catch {
      if (!isSwipeMutationCurrent(token)) return;
      rollbackSwipeMutation(token);
      toast.error(t("viewer.settings.alert.save_failed"));
    } finally {
      finishSwipeMutation(token);
    }
  };

  const handleReadingModeClick = (mode: ReadingMode) => {
    if (onReadingModeChange) {
      onReadingModeChange(mode);
    } else {
      updateSetting("reading_mode", mode, setReadingMode);
    }
  };

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    updateScrollbarState();

    const resizeObserver = new ResizeObserver(() => {
      updateScrollbarState();
    });
    resizeObserver.observe(contentEl);

    const mutationObserver = new MutationObserver(() => {
      updateScrollbarState();
    });
    mutationObserver.observe(contentEl, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    window.addEventListener("resize", updateScrollbarState);

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", updateScrollbarState);
    };
  }, [updateScrollbarState]);

  useEffect(() => {
    updateScrollbarState();
  }, [updateScrollbarState, settings, showPdfControlsOption, showTextTypographyOption, isMobileDevice]);

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
            type="button"
            className={styles.settingsClose}
            onClick={onClose}
            aria-label={t("common.close", { defaultValue: "닫기" })}
            title={t("common.close", { defaultValue: "닫기" })}
          >
            <X
              size={20}
              aria-hidden="true"
            />
          </button>
        </div>

        <div
          ref={contentRef}
          className={`${styles.settingsContent} ${!hasScrollbar ? styles.noScrollbar : ""}`}
        >
          <div className={styles.settingsSection}>
            <div className={styles.settingsLabel}>{t("viewer.settings.reading_mode.label")}</div>
            <div className={styles.settingsOptions}>
              <button
                className={`${styles.optionBtn} ${settings.readingMode === "single" ? styles.selected : ""}`}
                onClick={() => handleReadingModeClick("single")}
              >
                {t("viewer.settings.reading_mode.single")}
              </button>
              <button
                className={`${styles.optionBtn} ${settings.readingMode === "double" ? styles.selected : ""}`}
                onClick={() => handleReadingModeClick("double")}
              >
                {t("viewer.settings.reading_mode.double")}
              </button>
              <button
                className={`${styles.optionBtn} ${settings.readingMode === "vertical" ? styles.selected : ""}`}
                onClick={() => handleReadingModeClick("vertical")}
              >
                {t("viewer.settings.reading_mode.vertical")}
              </button>
            </div>
          </div>

          {showTextTypographyOption && (
            <>
              <div className={styles.settingsSection}>
                <label
                  className={styles.settingsLabel}
                  htmlFor="viewer-font-family-select"
                >
                  {t("viewer.settings.font_family.label")}
                </label>
                <select
                  id="viewer-font-family-select"
                  className={styles.select}
                  value={settings.fontFamily}
                  onChange={(e) =>
                    updateSetting("font_family", e.target.value as "original" | "serif" | "sans-serif", setFontFamily)
                  }
                >
                  <option value="original">{t("viewer.settings.font_family.original")}</option>
                  <option value="serif">{t("viewer.settings.font_family.serif")}</option>
                  <option value="sans-serif">{t("viewer.settings.font_family.sans_serif")}</option>
                </select>
              </div>

              <div className={styles.settingsSection}>
                <label
                  className={styles.settingsLabel}
                  htmlFor="viewer-font-size-slider"
                >
                  {t("viewer.settings.font_size.label")} ({settings.fontSize}%)
                </label>
                <input
                  id="viewer-font-size-slider"
                  type="range"
                  min={50}
                  max={150}
                  step={5}
                  value={settings.fontSize}
                  onChange={(e) => updateSetting("font_size", Number(e.target.value), setFontSize)}
                  className={styles.slider}
                />
                <div className={styles.sliderLabels}>
                  <span>50%</span>
                  <span>150%</span>
                </div>
              </div>

              <div className={styles.settingsSection}>
                <label
                  className={styles.settingsLabel}
                  htmlFor="viewer-line-height-slider"
                >
                  {t("viewer.settings.line_height.label")} ({settings.lineHeight.toFixed(1)})
                </label>
                <input
                  id="viewer-line-height-slider"
                  type="range"
                  min={1.2}
                  max={2.0}
                  step={0.1}
                  value={settings.lineHeight}
                  onChange={(e) => updateSetting("line_height", Number(e.target.value), setLineHeight)}
                  className={styles.slider}
                />
                <div className={styles.sliderLabels}>
                  <span>1.2</span>
                  <span>2.0</span>
                </div>
              </div>
            </>
          )}

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
            <div className={styles.settingsLabel}>{t("viewer.settings.wheel_direction.label")}</div>
            <div className={styles.settingsOptions}>
              <button
                className={`${styles.optionBtn} ${settings.wheelDirection === "down" ? styles.selected : ""}`}
                onClick={() => updateSetting("wheel_direction", "down", setWheelDirection)}
              >
                {t("viewer.settings.wheel_direction.down")}
              </button>
              <button
                className={`${styles.optionBtn} ${settings.wheelDirection === "up" ? styles.selected : ""}`}
                onClick={() => updateSetting("wheel_direction", "up", setWheelDirection)}
              >
                {t("viewer.settings.wheel_direction.up")}
              </button>
            </div>
          </div>

          <div className={styles.settingsSection}>
            <div className={`${styles.settingsLabel} ${styles.swipeLabel}`}>
              {isMobileDevice
                ? t("viewer.settings.nav_direction.label_mobile")
                : t("viewer.settings.nav_direction.label_desktop")}
              {isMobileDevice && currentSeriesId && seriesSettings[currentSeriesId]?.swipeDirection !== undefined && (
                <button type="button" className={styles.swipeReset} disabled={isSwipeSaving} onClick={() => saveSwipeDirection(null)}>
                  {t("viewer.settings.nav_direction.reset_to_global")}
                </button>
              )}
            </div>
            <div className={styles.settingsOptions}>
              <button
                className={`${styles.optionBtn} ${
                  (isMobileDevice ? settings.swipeDirection : settings.keyboardDirection) === "ltr"
                    ? styles.selected
                    : ""
                }`}
                disabled={isMobileDevice && (isSwipeSaving || !currentSeriesId)}
                onClick={() =>
                  isMobileDevice
                    ? saveSwipeDirection("ltr")
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
                  (isMobileDevice ? settings.swipeDirection : settings.keyboardDirection) === "rtl"
                    ? styles.selected
                    : ""
                }`}
                disabled={isMobileDevice && (isSwipeSaving || !currentSeriesId)}
                onClick={() =>
                  isMobileDevice
                    ? saveSwipeDirection("rtl")
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
            <div className={styles.settingsLabel}>{t("viewer.settings.theme.label")}</div>
            <div className={styles.themeGroup}>
              {(["light", "dark", "sepia"] as ViewerTheme[]).map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`${styles.themeBtn} ${styles[`theme_${theme}`]} ${selectedTheme === theme ? styles.activeTheme : ""}`}
                  onClick={() =>
                    updateSetting("background_color", VIEWER_THEME_TO_BACKGROUND[theme], setBackgroundColor)
                  }
                  aria-label={t(`viewer.settings.theme.${theme}`)}
                  title={t(`viewer.settings.theme.${theme}`)}
                >
                  {t(`viewer.settings.theme.${theme}`)}
                </button>
              ))}
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

          {showPdfControlsOption && (
            <div className={styles.settingsSection}>
              <div className={styles.settingsLabel}>{t("viewer.settings.pdf_zoom_controls.label")}</div>
              <div className={styles.settingsOptions}>
                <button
                  className={`${styles.optionBtn} ${settings.showPdfZoomControls ? styles.selected : ""}`}
                  onClick={() => updateSetting("show_pdf_zoom_controls", true, setShowPdfZoomControls)}
                >
                  {t("viewer.settings.pdf_zoom_controls.show")}
                </button>
                <button
                  className={`${styles.optionBtn} ${!settings.showPdfZoomControls ? styles.selected : ""}`}
                  onClick={() => updateSetting("show_pdf_zoom_controls", false, setShowPdfZoomControls)}
                >
                  {t("viewer.settings.pdf_zoom_controls.hide")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
