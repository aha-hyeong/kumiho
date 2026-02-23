import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Monitor, Loader2, Cpu, RotateCcw } from "lucide-react";
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
  viewer_fit_mode?: string;
  viewer_preload_count?: string;
  viewer_pull_threshold?: string;
  viewer_show_threshold?: string;
  viewer_page_transition?: string;
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
  const [isCustomMode, setIsCustomMode] = useState(false);

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
        if (data.viewer_fit_mode) setFitMode(data.viewer_fit_mode as FitMode);
        if (data.viewer_preload_count) setPreloadCount(parseInt(data.viewer_preload_count, 10));
        if (data.viewer_pull_threshold) setPullThreshold(parseInt(data.viewer_pull_threshold, 10));
        if (data.viewer_pull_sensitivity) setPullSensitivity(parseFloat(data.viewer_pull_sensitivity));
        if (data.viewer_show_threshold) setShowThreshold(parseInt(data.viewer_show_threshold, 10));
        if (data.viewer_page_transition) setPageTransition(data.viewer_page_transition as "slide" | "fade" | "none");
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
    setFitMode,
    setPreloadCount,
    setPullThreshold,
    setPullSensitivity,
    setShowThreshold,
    setPageTransition,
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

  // 전체 뷰어 설정 초기화 실행
  const executeReset = async () => {
    try {
      // 로딩 상태를 표시하지 않고 진행 (UI 깜빡임 방지)

      // 1. API 업데이트 (병렬 처리로 속도 개선)
      await Promise.all([
        settingAPI.update("viewer_reading_mode", { value: "single" }),
        settingAPI.update("viewer_reading_direction", { value: "ltr" }),
        settingAPI.update("viewer_click_direction", { value: "ltr" }),
        settingAPI.update("viewer_keyboard_direction", { value: "ltr" }),
        settingAPI.update("viewer_fit_mode", { value: "screen" }),
        settingAPI.update("viewer_preload_count", { value: "6" }),
        settingAPI.update("viewer_pull_threshold", { value: String(PULL_PRESETS.medium.threshold) }),
        settingAPI.update("viewer_pull_sensitivity", { value: String(PULL_PRESETS.medium.sensitivity) }),
        settingAPI.update("viewer_show_threshold", { value: "10" }),
        settingAPI.update("viewer_page_transition", { value: "slide" }),
      ]);

      // 2. 스토어 상태 업데이트
      setReadingMode("single");
      setReadingDirection("ltr");
      setClickDirection("ltr");
      setKeyboardDirection("ltr");
      setFitMode("screen");
      setPreloadCount(6);
      setPullThreshold(PULL_PRESETS.medium.threshold);
      setPullSensitivity(PULL_PRESETS.medium.sensitivity);
      setShowThreshold(10);
      setPageTransition("slide");

      setStatus({ type: "success", message: t("settings.viewer.toast.reset_success") });
      setIsResetModalOpen(false); // 모달 닫기
    } catch (error) {
      console.error("Failed to reset settings:", error);
      setStatus({ type: "error", message: t("settings.viewer.toast.reset_failed") });
      setIsResetModalOpen(false);
    }
  };

  // 초기화 버튼 핸들러
  const handleResetClick = () => {
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h2>{t("settings.viewer.title")}</h2>
            <p className={styles.tabDescription}>{t("settings.viewer.desc")}</p>
          </div>
          <button
            onClick={handleResetClick}
            className={localStyles.resetButton}
            title={t("settings.viewer.reset_tooltip")}
          >
            <RotateCcw size={14} />
            <span>{t("settings.viewer.reset_button")}</span>
          </button>
        </div>
      </div>

      <div className={styles.settingsSections}>
        <section className={styles.settingsSection}>
          <div className={styles.sectionTitle}>
            <Monitor size={18} />
            <h3>{t("settings.viewer.global.title")}</h3>
          </div>
          <div className={styles.sectionContent}>
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
        title={t("settings.viewer.reset_modal.title")}
        message={t("settings.viewer.reset_modal.message")}
        confirmText={t("settings.viewer.reset_button")}
        cancelText={t("common.cancel")}
        showCancel={true}
        onConfirm={executeReset}
        onCancel={() => setIsResetModalOpen(false)}
      />
    </div>
  );
}
