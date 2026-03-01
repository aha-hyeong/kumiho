import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Loader2, Cpu, RotateCcw, BookOpen } from "lucide-react";
import { AlertModal } from "../modals/AlertModal";
import { Toast } from "../common/Toast";
import { useViewerStore, type ReadingMode, type ReadingDirection, type FitMode } from "../../stores/viewerStore";
import { settingAPI } from "../../api/client";
import styles from "./SettingsComponents.module.css";
import localStyles from "./ViewerTab.module.css";

interface SettingsData {
  viewer_reading_mode?: string;
  viewer_reading_direction?: string;
  viewer_click_direction?: string;
  viewer_keyboard_direction?: string;
  viewer_wheel_direction?: string;
  viewer_fit_mode?: string;
  viewer_preload_count?: string;
  viewer_pull_threshold?: string;
  viewer_show_threshold?: string;
  viewer_page_transition?: string;
  swipe_direction?: string;
  epub_render_mode?: string;
  epub_theme?: string;
  epub_spread?: string;
  epub_wheel_direction?: string;
  epub_keyboard_direction?: string;
  epub_click_direction?: string;
  epub_title_override?: string;
  [key: string]: string | undefined;
}

const PULL_PRESETS = {
  low: { threshold: 120, sensitivity: 0.4 },
  medium: { threshold: 100, sensitivity: 0.6 },
  high: { threshold: 80, sensitivity: 0.8 },
} as const;

// 민감도 레벨 판별 함수 (부동소수점 오차 고려)
const getSensitivityLevel = (threshold: number, sensitivity: number): string => {
  const EPSILON = 0.0001;

  if (
    Math.abs(threshold - PULL_PRESETS.medium.threshold) < EPSILON &&
    Math.abs(sensitivity - PULL_PRESETS.medium.sensitivity) < EPSILON
  )
    return "medium";

  if (
    Math.abs(threshold - PULL_PRESETS.low.threshold) < EPSILON &&
    Math.abs(sensitivity - PULL_PRESETS.low.sensitivity) < EPSILON
  )
    return "low";

  if (
    Math.abs(threshold - PULL_PRESETS.high.threshold) < EPSILON &&
    Math.abs(sensitivity - PULL_PRESETS.high.sensitivity) < EPSILON
  )
    return "high";

  return "custom";
};

export function ViewerTab() {
  const { t } = useTranslation();
  const {
    settings,
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setWheelDirection,
    setSwipeDirection,
    setFitMode,
    setPreloadCount,
    setPullThreshold,
    setPullSensitivity,
    setShowThreshold,
    setPageTransition,
  } = useViewerStore();
  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<"imagePdf" | "epub" | null>(null);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [epubRenderMode, setEpubRenderMode] = useState<"auto" | "book" | "comic">("auto");
  const [epubTheme, setEpubTheme] = useState<"light" | "dark" | "sepia">("light");
  const [epubSpread, setEpubSpread] = useState<"auto" | "none">("auto");
  const [epubWheelDirection, setEpubWheelDirection] = useState<"down" | "up">("down");
  const [epubKeyboardDirection, setEpubKeyboardDirection] = useState<"right" | "left">("right");
  const [epubClickDirection, setEpubClickDirection] = useState<"right" | "left">("right");
  const [epubTitleOverride, setEpubTitleOverride] = useState(false);

  // 설정 가져오기
  useEffect(() => {
    let isMounted = true;
    const fetchSettings = async () => {
      try {
        const response = await settingAPI.list();
        if (!isMounted) return;

        const data = response as SettingsData;

        // 런타임 타입 검증 강화
        if (typeof data !== "object" || data === null || Array.isArray(data)) {
          throw new Error("Invalid response format: expected an object");
        }

        if (data.viewer_reading_mode) setReadingMode(data.viewer_reading_mode as ReadingMode);
        if (data.viewer_reading_direction) setReadingDirection(data.viewer_reading_direction as ReadingDirection);
        if (data.viewer_click_direction) setClickDirection(data.viewer_click_direction as ReadingDirection);
        if (data.viewer_keyboard_direction) setKeyboardDirection(data.viewer_keyboard_direction as ReadingDirection);
        if (data.viewer_wheel_direction === "down" || data.viewer_wheel_direction === "up") {
          setWheelDirection(data.viewer_wheel_direction);
        }
        if (data.viewer_fit_mode) setFitMode(data.viewer_fit_mode as FitMode);
        if (data.viewer_preload_count) setPreloadCount(parseInt(data.viewer_preload_count, 10));
        if (data.viewer_pull_threshold) setPullThreshold(parseInt(data.viewer_pull_threshold, 10));
        if (data.viewer_pull_sensitivity) setPullSensitivity(parseFloat(data.viewer_pull_sensitivity));
        if (data.viewer_show_threshold) setShowThreshold(parseInt(data.viewer_show_threshold, 10));
        if (data.viewer_page_transition) setPageTransition(data.viewer_page_transition as "slide" | "fade" | "none");
        if (data.swipe_direction) setSwipeDirection(data.swipe_direction as ReadingDirection);
        if (data.epub_render_mode === "auto" || data.epub_render_mode === "book" || data.epub_render_mode === "comic") {
          setEpubRenderMode(data.epub_render_mode);
        }
        if (data.epub_theme === "light" || data.epub_theme === "dark" || data.epub_theme === "sepia") {
          setEpubTheme(data.epub_theme);
        }
        if (data.epub_spread === "auto" || data.epub_spread === "none") {
          setEpubSpread(data.epub_spread);
        }
        if (data.epub_wheel_direction === "down" || data.epub_wheel_direction === "up") {
          setEpubWheelDirection(data.epub_wheel_direction);
        }
        if (data.epub_keyboard_direction === "right" || data.epub_keyboard_direction === "left") {
          setEpubKeyboardDirection(data.epub_keyboard_direction);
        }
        if (data.epub_click_direction === "right" || data.epub_click_direction === "left") {
          setEpubClickDirection(data.epub_click_direction);
        }
        if (data.epub_title_override) {
          setEpubTitleOverride(data.epub_title_override === "true");
        }
      } catch (error) {
        if (isMounted) {
          console.error("Failed to fetch settings:", error);
          setStatus({ type: "error", message: t("settings.viewer.toast.load_failed") });
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    fetchSettings();
    return () => {
      isMounted = false;
    };
  }, [
    setReadingMode,
    setReadingDirection,
    setClickDirection,
    setKeyboardDirection,
    setWheelDirection,
    setFitMode,
    setPreloadCount,
    setPullThreshold,
    setPullSensitivity,
    setShowThreshold,
    setPageTransition,
    setSwipeDirection,
    t,
  ]);

  // 설정값에 따라 커스텀 모드 감지
  useEffect(() => {
    if (getSensitivityLevel(settings.pullThreshold, settings.pullSensitivity) === "custom") {
      setIsCustomMode(true);
    }
  }, [settings.pullThreshold, settings.pullSensitivity]);

  // 설정 업데이트 핸들러
  const handleSettingChange = async (key: string, value: string, updateFn: (val: string) => void) => {
    try {
      await settingAPI.update(key, { value });
      updateFn(value);
      setStatus({ type: "success", message: t("settings.viewer.toast.saved") });
    } catch (error) {
      console.error(`Failed to update setting ${key}:`, error);
      setStatus({ type: "error", message: t("settings.viewer.toast.save_failed") });
    }
  };

  const executeImagePdfReset = async () => {
    try {
      await Promise.all([
        settingAPI.update("viewer_reading_mode", { value: "single" }),
        settingAPI.update("viewer_reading_direction", { value: "ltr" }),
        settingAPI.update("viewer_click_direction", { value: "ltr" }),
        settingAPI.update("viewer_keyboard_direction", { value: "ltr" }),
        settingAPI.update("viewer_wheel_direction", { value: "down" }),
        settingAPI.update("viewer_fit_mode", { value: "screen" }),
        settingAPI.update("viewer_preload_count", { value: "6" }),
        settingAPI.update("viewer_pull_threshold", { value: String(PULL_PRESETS.medium.threshold) }),
        settingAPI.update("viewer_pull_sensitivity", { value: String(PULL_PRESETS.medium.sensitivity) }),
        settingAPI.update("viewer_show_threshold", { value: "10" }),
        settingAPI.update("viewer_page_transition", { value: "slide" }),
        settingAPI.update("swipe_direction", { value: "ltr" }),
      ]);

      setReadingMode("single");
      setReadingDirection("ltr");
      setClickDirection("ltr");
      setKeyboardDirection("ltr");
      setWheelDirection("down");
      setFitMode("screen");
      setPreloadCount(6);
      setPullThreshold(PULL_PRESETS.medium.threshold);
      setPullSensitivity(PULL_PRESETS.medium.sensitivity);
      setShowThreshold(10);
      setPageTransition("slide");
      setSwipeDirection("ltr");

      setStatus({ type: "success", message: t("settings.viewer.toast.reset_success") });
      setIsResetModalOpen(false);
      setResetTarget(null);
    } catch (error) {
      console.error("Failed to reset image/pdf settings:", error);
      setStatus({ type: "error", message: t("settings.viewer.toast.reset_failed") });
      setIsResetModalOpen(false);
      setResetTarget(null);
    }
  };

  const executeEpubReset = async () => {
    try {
      await Promise.all([
        settingAPI.update("epub_render_mode", { value: "auto" }),
        settingAPI.update("epub_theme", { value: "light" }),
        settingAPI.update("epub_spread", { value: "auto" }),
        settingAPI.update("epub_wheel_direction", { value: "down" }),
        settingAPI.update("epub_keyboard_direction", { value: "right" }),
        settingAPI.update("epub_click_direction", { value: "right" }),
      ]);

      setEpubRenderMode("auto");
      setEpubTheme("light");
      setEpubSpread("auto");
      setEpubWheelDirection("down");
      setEpubKeyboardDirection("right");
      setEpubClickDirection("right");

      setStatus({ type: "success", message: t("settings.viewer.toast.reset_success") });
      setIsResetModalOpen(false);
      setResetTarget(null);
    } catch (error) {
      console.error("Failed to reset epub settings:", error);
      setStatus({ type: "error", message: t("settings.viewer.toast.reset_failed") });
      setIsResetModalOpen(false);
      setResetTarget(null);
    }
  };

  const executeReset = async () => {
    if (resetTarget === "imagePdf") {
      await executeImagePdfReset();
      return;
    }
    if (resetTarget === "epub") {
      await executeEpubReset();
    }
  };

  const handleResetClick = (target: "imagePdf" | "epub") => {
    setResetTarget(target);
    setIsResetModalOpen(true);
  };

  if (isLoading) {
    return (
      <div className={styles.tabContent}>
        <div className={styles.placeholderContent}>
          <Loader2
            className={styles.loadingSpinner}
            size={24}
          />
          <p>{t("settings.viewer.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.tabContent} ${styles.relative}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <div className={styles.tabHeader}>
        <div>
          <h2>{t("settings.viewer.title")}</h2>
          <p className={styles.tabDescription}>{t("settings.viewer.desc")}</p>
        </div>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={`${styles.sectionTitle} ${localStyles.sectionTitleWithAction}`}>
            <div className={localStyles.sectionTitleLeft}>
              <Monitor size={18} />
              <h3>{t("settings.viewer.global.title")}</h3>
            </div>
            <button
              type="button"
              onClick={() => handleResetClick("imagePdf")}
              className={localStyles.resetButton}
              title={t("settings.viewer.reset_tooltip")}
            >
              <RotateCcw size={14} />
              <span>{t("settings.viewer.reset_button")}</span>
            </button>
          </div>
          <div className={styles.sectionContent}>
            <h4 className={localStyles.subsectionTitle}>{t("settings.viewer.subsections.display")}</h4>
            <div className={localStyles.subsectionGroup}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_reading_mode">{t("settings.viewer.global.reading_mode_label")}</label>
                <p>{t("settings.viewer.global.reading_mode_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_reading_mode"
                  value={settings.readingMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_mode", e.target.value, (v) => setReadingMode(v as ReadingMode))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="single">{t("settings.viewer.mode.single")}</option>
                  <option value="double">{t("settings.viewer.mode.double")}</option>
                  <option value="vertical">{t("settings.viewer.mode.vertical")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_reading_direction">{t("settings.viewer.global.reading_direction_label")}</label>
                <p>{t("settings.viewer.global.reading_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_reading_direction"
                  value={settings.readingDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_reading_direction", e.target.value, (v) =>
                      setReadingDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">{t("settings.viewer.direction.ltr")}</option>
                  <option value="rtl">{t("settings.viewer.direction.rtl")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_fit_mode">{t("settings.viewer.global.fit_mode_label")}</label>
                <p>{t("settings.viewer.global.fit_mode_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_fit_mode"
                  value={settings.fitMode}
                  onChange={(e) =>
                    handleSettingChange("viewer_fit_mode", e.target.value, (v) => setFitMode(v as FitMode))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="screen">{t("settings.viewer.fit.screen")}</option>
                  <option value="width">{t("settings.viewer.fit.width")}</option>
                  <option value="height">{t("settings.viewer.fit.height")}</option>
                  <option value="original">{t("settings.viewer.fit.original")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_page_transition">{t("viewer.settings.page_transition.label")}</label>
                <p>{t("viewer.settings.page_transition.desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_page_transition"
                  value={settings.pageTransition}
                  onChange={(e) =>
                    handleSettingChange("viewer_page_transition", e.target.value, (v) =>
                      setPageTransition(v as "slide" | "fade" | "none"),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="slide">{t("viewer.settings.page_transition.slide")}</option>
                  <option value="fade">{t("viewer.settings.page_transition.fade")}</option>
                  <option value="none">{t("viewer.settings.page_transition.none")}</option>
                </select>
              </div>
            </div>
            </div>

            <h4 className={localStyles.subsectionTitle}>{t("settings.viewer.subsections.input")}</h4>
            <div className={localStyles.subsectionGroup}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_click_direction">{t("settings.viewer.global.click_direction_label")}</label>
                <p>{t("settings.viewer.global.click_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_click_direction"
                  value={settings.clickDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_click_direction", e.target.value, (v) =>
                      setClickDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">{t("settings.viewer.click.right")}</option>
                  <option value="rtl">{t("settings.viewer.click.left")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_keyboard_direction">
                  {t("settings.viewer.global.keyboard_direction_label")}
                </label>
                <p>{t("settings.viewer.global.keyboard_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_keyboard_direction"
                  value={settings.keyboardDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_keyboard_direction", e.target.value, (v) =>
                      setKeyboardDirection(v as ReadingDirection),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">{t("settings.viewer.keyboard.right")}</option>
                  <option value="rtl">{t("settings.viewer.keyboard.left")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_wheel_direction">{t("settings.viewer.global.wheel_direction_label")}</label>
                <p>{t("settings.viewer.global.wheel_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_wheel_direction"
                  value={settings.wheelDirection}
                  onChange={(e) =>
                    handleSettingChange("viewer_wheel_direction", e.target.value, (v) =>
                      setWheelDirection(v as "down" | "up"),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="down">{t("viewer.settings.wheel_direction.down")}</option>
                  <option value="up">{t("viewer.settings.wheel_direction.up")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="swipe_direction">{t("settings.general.swipe.label")}</label>
                <p>{t("settings.general.swipe.desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="swipe_direction"
                  value={settings.swipeDirection}
                  onChange={(e) =>
                    handleSettingChange("swipe_direction", e.target.value, (v) => setSwipeDirection(v as ReadingDirection))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="ltr">{t("settings.general.swipe.ltr")}</option>
                  <option value="rtl">{t("settings.general.swipe.rtl")}</option>
                </select>
              </div>
            </div>
            </div>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={`${styles.sectionTitle} ${localStyles.sectionTitleWithAction}`}>
            <div className={localStyles.sectionTitleLeft}>
              <BookOpen size={18} />
              <h3>{t("settings.viewer.epub.title")}</h3>
            </div>
            <button
              type="button"
              onClick={() => handleResetClick("epub")}
              className={localStyles.resetButton}
              title={t("settings.viewer.reset_tooltip")}
            >
              <RotateCcw size={14} />
              <span>{t("settings.viewer.reset_button")}</span>
            </button>
          </div>
          <div className={styles.sectionContent}>
            <h4 className={localStyles.subsectionTitle}>{t("settings.viewer.subsections.display")}</h4>
            <div className={localStyles.subsectionGroup}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_render_mode">{t("settings.viewer.epub.render_mode_label")}</label>
                <p>{t("settings.viewer.epub.render_mode_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_render_mode"
                  value={epubRenderMode}
                  onChange={(e) =>
                    handleSettingChange("epub_render_mode", e.target.value, (v) =>
                      setEpubRenderMode(v as "auto" | "book" | "comic"),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="auto">{t("epub_viewer.settings.render_mode.auto")}</option>
                  <option value="book">{t("epub_viewer.settings.render_mode.book")}</option>
                  <option value="comic">{t("epub_viewer.settings.render_mode.comic")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_spread">{t("settings.viewer.epub.spread_label")}</label>
                <p>{t("settings.viewer.epub.spread_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_spread"
                  value={epubSpread}
                  onChange={(e) =>
                    handleSettingChange("epub_spread", e.target.value, (v) => setEpubSpread(v as "auto" | "none"))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="auto">{t("settings.viewer.epub.spread_auto")}</option>
                  <option value="none">{t("settings.viewer.epub.spread_none")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_theme">{t("settings.viewer.epub.theme_label")}</label>
                <p>{t("settings.viewer.epub.theme_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_theme"
                  value={epubTheme}
                  onChange={(e) =>
                    handleSettingChange("epub_theme", e.target.value, (v) => setEpubTheme(v as "light" | "dark" | "sepia"))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="light">{t("epub_viewer.settings.theme.light")}</option>
                  <option value="dark">{t("epub_viewer.settings.theme.dark")}</option>
                  <option value="sepia">{t("epub_viewer.settings.theme.sepia")}</option>
                </select>
              </div>
            </div>
            </div>

            <h4 className={localStyles.subsectionTitle}>{t("settings.viewer.subsections.input")}</h4>
            <div className={localStyles.subsectionGroup}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_click_direction">{t("settings.viewer.epub.click_direction_label")}</label>
                <p>{t("settings.viewer.epub.click_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_click_direction"
                  value={epubClickDirection}
                  onChange={(e) =>
                    handleSettingChange("epub_click_direction", e.target.value, (v) => setEpubClickDirection(v as "right" | "left"))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="right">{t("epub_viewer.settings.input_controls.click_right")}</option>
                  <option value="left">{t("epub_viewer.settings.input_controls.click_left")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_keyboard_direction">{t("settings.viewer.epub.keyboard_direction_label")}</label>
                <p>{t("settings.viewer.epub.keyboard_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_keyboard_direction"
                  value={epubKeyboardDirection}
                  onChange={(e) =>
                    handleSettingChange("epub_keyboard_direction", e.target.value, (v) =>
                      setEpubKeyboardDirection(v as "right" | "left"),
                    )
                  }
                  className={styles.settingsSelect}
                >
                  <option value="right">{t("epub_viewer.settings.input_controls.keyboard_right")}</option>
                  <option value="left">{t("epub_viewer.settings.input_controls.keyboard_left")}</option>
                </select>
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_wheel_direction">{t("settings.viewer.epub.wheel_direction_label")}</label>
                <p>{t("settings.viewer.epub.wheel_direction_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_wheel_direction"
                  value={epubWheelDirection}
                  onChange={(e) =>
                    handleSettingChange("epub_wheel_direction", e.target.value, (v) => setEpubWheelDirection(v as "down" | "up"))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="down">{t("epub_viewer.settings.input_controls.wheel_down")}</option>
                  <option value="up">{t("epub_viewer.settings.input_controls.wheel_up")}</option>
                </select>
              </div>
            </div>
            </div>

            <h4 className={localStyles.subsectionTitle}>{t("settings.viewer.subsections.metadata")}</h4>
            <div className={localStyles.subsectionGroup}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="epub_title_override">{t("settings.viewer.epub.title_override_label")}</label>
                <p>{t("settings.viewer.epub.title_override_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="epub_title_override"
                  value={epubTitleOverride ? "true" : "false"}
                  onChange={(e) =>
                    handleSettingChange("epub_title_override", e.target.value, (v) => setEpubTitleOverride(v === "true"))
                  }
                  className={styles.settingsSelect}
                >
                  <option value="true">{t("common.on", { defaultValue: "켜기" })}</option>
                  <option value="false">{t("common.off", { defaultValue: "끄기" })}</option>
                </select>
              </div>
            </div>
            </div>
          </div>
        </section>

        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Cpu size={18} />
            <h3>{t("settings.viewer.advanced.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_preload_count">{t("settings.viewer.advanced.preload_label")}</label>
                <p>{t("settings.viewer.advanced.preload_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <input
                  type="number"
                  id="viewer_preload_count"
                  min="1"
                  max="20"
                  value={settings.preloadCount}
                  onChange={(e) => {
                    const { value } = e.target;
                    const val = parseInt(value, 10);

                    // 유효성 검사: 빈 값이거나 1~20 범위를 벗어난 경우 에러 표시
                    if (value === "" || isNaN(val) || val < 1 || val > 20) {
                      e.target.setCustomValidity(t("settings.viewer.advanced.preload_error"));
                      e.target.reportValidity();
                      return;
                    }

                    // 유효한 값인 경우 에러 상태 제거 후 설정 반영
                    e.target.setCustomValidity("");
                    handleSettingChange("viewer_preload_count", value, (v) => setPreloadCount(parseInt(v, 10)));
                  }}
                  className={styles.settingsInput}
                  style={{ width: "80px" }}
                />
              </div>
            </div>

            <div className={styles.settingsItem}>
              <div className={styles.itemInfo}>
                <label htmlFor="viewer_sensitivity">{t("settings.viewer.advanced.sensitivity_label")}</label>
                <p>{t("settings.viewer.advanced.sensitivity_desc")}</p>
              </div>
              <div className={styles.itemControl}>
                <select
                  id="viewer_sensitivity"
                  value={
                    isCustomMode ? "custom" : getSensitivityLevel(settings.pullThreshold, settings.pullSensitivity)
                  }
                  onChange={(e) => {
                    const level = e.target.value;
                    if (level === "custom") {
                      setIsCustomMode(true);
                      return;
                    }

                    setIsCustomMode(false);
                    let threshold = 120;
                    let sensitivity = 0.5;

                    switch (level) {
                      case "low":
                        threshold = PULL_PRESETS.low.threshold;
                        sensitivity = PULL_PRESETS.low.sensitivity;
                        break;
                      case "high":
                        threshold = PULL_PRESETS.high.threshold;
                        sensitivity = PULL_PRESETS.high.sensitivity;
                        break;
                      case "medium":
                      default:
                        threshold = PULL_PRESETS.medium.threshold;
                        sensitivity = PULL_PRESETS.medium.sensitivity;
                        break;
                    }

                    // 두 값을 동시에 업데이트 (Promise.all로 원자성 확보 시도)
                    Promise.all([
                      settingAPI.update("viewer_pull_threshold", { value: threshold.toString() }),
                      settingAPI.update("viewer_pull_sensitivity", { value: sensitivity.toString() }),
                    ])
                      .then(() => {
                        setPullThreshold(threshold);
                        setPullSensitivity(sensitivity);
                        setStatus({ type: "success", message: t("settings.viewer.toast.saved") });
                      })
                      .catch((error) => {
                        console.error("Failed to update sensitivity settings:", error);
                        setStatus({ type: "error", message: t("settings.viewer.toast.save_failed") });
                      });
                  }}
                  className={styles.settingsSelect}
                >
                  <option value="low">{t("settings.viewer.sensitivity.low")}</option>
                  <option value="medium">{t("settings.viewer.sensitivity.medium")}</option>
                  <option value="high">{t("settings.viewer.sensitivity.high")}</option>
                  <option value="custom">{t("settings.viewer.sensitivity.custom")}</option>
                </select>

                {isCustomMode && (
                  <div
                    style={{
                      marginTop: "1rem",
                      padding: "1rem",
                      background: "rgba(255, 255, 255, 0.05)",
                      borderRadius: "8px",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.2rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        <label
                          htmlFor="custom_threshold"
                          style={{ fontSize: "0.9rem", color: "#e2e8f0" }}
                        >
                          {t("settings.viewer.advanced.threshold_label")}
                        </label>
                        <p style={{ fontSize: "0.75rem", color: "#718096", margin: 0 }}>
                          {t("settings.viewer.advanced.threshold_desc1")} <br />
                          {t("settings.viewer.advanced.threshold_desc2")}
                        </p>
                      </div>
                      <input
                        type="number"
                        id="custom_threshold"
                        value={settings.pullThreshold}
                        onChange={(e) =>
                          handleSettingChange("viewer_pull_threshold", e.target.value, (v) =>
                            setPullThreshold(parseInt(v, 10)),
                          )
                        }
                        className={styles.settingsInput}
                        style={{ width: "100px" }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                        <label
                          htmlFor="custom_sensitivity"
                          style={{ fontSize: "0.9rem", color: "#e2e8f0" }}
                        >
                          {t("settings.viewer.advanced.sensitivity_factor_label")}
                        </label>
                        <p style={{ fontSize: "0.75rem", color: "#718096", margin: 0 }}>
                          {t("settings.viewer.advanced.sensitivity_factor_desc1")} <br />
                          {t("settings.viewer.advanced.sensitivity_factor_desc2")}
                        </p>
                      </div>
                      <input
                        type="number"
                        id="custom_sensitivity"
                        step="0.1"
                        min="0"
                        max="1"
                        value={settings.pullSensitivity}
                        onChange={(e) =>
                          handleSettingChange("viewer_pull_sensitivity", e.target.value, (v) =>
                            setPullSensitivity(parseFloat(v)),
                          )
                        }
                        className={styles.settingsInput}
                        style={{ width: "100px" }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      <AlertModal
        isOpen={isResetModalOpen}
        type="warning"
        title={
          resetTarget === "epub"
            ? t("settings.viewer.reset_modal.epub_title", { defaultValue: "EPUB 설정 초기화" })
            : t("settings.viewer.reset_modal.image_pdf_title", { defaultValue: "이미지/PDF 설정 초기화" })
        }
        message={
          resetTarget === "epub"
            ? t("settings.viewer.reset_modal.epub_message", {
                defaultValue: "EPUB 전역 설정(보기 모드, 테마, 페이지 모드, 입력 방향)이 기본값으로 초기화됩니다. 계속하시겠습니까?",
              })
            : t("settings.viewer.reset_modal.image_pdf_message", {
                defaultValue:
                  "이미지/PDF 뷰어 설정(보기 모드, 방향, 고급 설정 등)이 기본값으로 초기화됩니다. 계속하시겠습니까?",
              })
        }
        confirmText={t("settings.viewer.reset_button")}
        cancelText={t("common.cancel")}
        showCancel={true}
        onConfirm={executeReset}
        onCancel={() => {
          setIsResetModalOpen(false);
          setResetTarget(null);
        }}
      />
    </div>
  );
}
