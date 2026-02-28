import { useTranslation } from "react-i18next";
import type { EpubFontFamily, EpubRenderMode, EpubViewerSettings, EpubTheme } from "../../../../stores/epubViewerStore";
import styles from "./EpubSettingsPanel.module.css";

interface EpubSettingsPanelProps {
  settings: EpubViewerSettings;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: EpubFontFamily) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onRenderModeChange: (mode: EpubRenderMode) => void;
  onWheelDirectionChange: (direction: "down" | "up") => void;
  onKeyboardDirectionChange: (direction: "right" | "left") => void;
  onClickDirectionChange: (direction: "right" | "left") => void;
  isTypographyControlLimited?: boolean;
}

export function EpubSettingsPanel({
  settings,
  onFontSizeChange,
  onFontFamilyChange,
  onLineHeightChange,
  onThemeChange,
  onRenderModeChange,
  onWheelDirectionChange,
  onKeyboardDirectionChange,
  onClickDirectionChange,
  isTypographyControlLimited = false,
}: EpubSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>{t("epub_viewer.settings.title")}</h3>

      {/* 보기 모드 */}
      <div className={styles.section}>
        <label
          className={styles.label}
          htmlFor="render-mode-select"
        >
          {t("epub_viewer.settings.render_mode.label")}
        </label>
        <select
          id="render-mode-select"
          className={styles.select}
          value={settings.renderMode}
          onChange={(e) => onRenderModeChange(e.target.value as EpubRenderMode)}
        >
          <option value="auto">{t("epub_viewer.settings.render_mode.auto")}</option>
          <option value="book">{t("epub_viewer.settings.render_mode.book")}</option>
          <option value="comic">{t("epub_viewer.settings.render_mode.comic")}</option>
        </select>
      </div>

      {/* 글꼴 (최상단, 드롭다운) */}
      <div className={styles.section}>
        <label
          className={styles.label}
          htmlFor="font-family-select"
        >
          {t("epub_viewer.settings.font_family.label")}
        </label>
        <select
          id="font-family-select"
          className={styles.select}
          value={settings.fontFamily}
          onChange={(e) => onFontFamilyChange(e.target.value as EpubFontFamily)}
        >
          <option value="original">{t("epub_viewer.settings.font_family.original")}</option>
          <option value="serif">{t("epub_viewer.settings.font_family.serif")}</option>
          <option value="sans-serif">{t("epub_viewer.settings.font_family.sans_serif")}</option>
        </select>
      </div>

      {/* 글자 크기 */}
      <div className={styles.section}>
        <label
          className={styles.label}
          htmlFor="font-size-slider"
        >
          {t("epub_viewer.settings.font_size.label")} ({settings.fontSize}%)
        </label>
        <input
          id="font-size-slider"
          type="range"
          min={50}
          max={150}
          step={5}
          value={settings.fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
          className={styles.slider}
          disabled={isTypographyControlLimited}
        />
        <div className={styles.sliderLabels}>
          <span>50%</span>
          <span>150%</span>
        </div>
      </div>

      {/* 줄 간격 */}
      <div className={styles.section}>
        <label
          className={styles.label}
          htmlFor="line-height-slider"
        >
          {t("epub_viewer.settings.line_height.label")} ({settings.lineHeight.toFixed(1)})
        </label>
        <input
          id="line-height-slider"
          type="range"
          min={1.2}
          max={2.0}
          step={0.1}
          value={settings.lineHeight}
          onChange={(e) => onLineHeightChange(Number(e.target.value))}
          className={styles.slider}
          disabled={isTypographyControlLimited}
        />
        <div className={styles.sliderLabels}>
          <span>1.2</span>
          <span>2.0</span>
        </div>
        {isTypographyControlLimited && (
          <p className={styles.helperText}>{t("epub_viewer.settings.render_mode.typography_limited")}</p>
        )}
      </div>

      {/* 테마 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.theme.label")}</label>
        <div className={styles.themeGroup}>
          {(["light", "dark", "sepia"] as EpubTheme[]).map((theme) => (
            <button
              key={theme}
              type="button"
              className={`${styles.themeBtn} ${styles[`theme_${theme}`]} ${settings.theme === theme ? styles.activeTheme : ""}`}
              onClick={() => onThemeChange(theme)}
              title={t(`epub_viewer.settings.theme.${theme}`)}
              aria-label={t(`epub_viewer.settings.theme.${theme}`)}
            >
              {t(`epub_viewer.settings.theme.${theme}`)}
            </button>
          ))}
        </div>
      </div>

      {/* 입력 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.input_controls.wheel_label")}</label>
        <div className={styles.buttonGroup}>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.wheelDirection === "down" ? styles.active : ""}`}
            onClick={() => onWheelDirectionChange("down")}
          >
            {t("epub_viewer.settings.input_controls.wheel_down")}
          </button>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.wheelDirection === "up" ? styles.active : ""}`}
            onClick={() => onWheelDirectionChange("up")}
          >
            {t("epub_viewer.settings.input_controls.wheel_up")}
          </button>
        </div>
      </div>

      {/* 입력 - 키보드 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.input_controls.keyboard_label")}</label>
        <div className={styles.buttonGroup}>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.keyboardDirection === "right" ? styles.active : ""}`}
            onClick={() => onKeyboardDirectionChange("right")}
          >
            {t("epub_viewer.settings.input_controls.keyboard_right")}
          </button>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.keyboardDirection === "left" ? styles.active : ""}`}
            onClick={() => onKeyboardDirectionChange("left")}
          >
            {t("epub_viewer.settings.input_controls.keyboard_left")}
          </button>
        </div>
      </div>

      {/* 입력 - 클릭 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.input_controls.click_label")}</label>
        <div className={styles.buttonGroup}>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.clickDirection === "right" ? styles.active : ""}`}
            onClick={() => onClickDirectionChange("right")}
          >
            {t("epub_viewer.settings.input_controls.click_right")}
          </button>
          <button
            type="button"
            className={`${styles.optionBtn} ${settings.clickDirection === "left" ? styles.active : ""}`}
            onClick={() => onClickDirectionChange("left")}
          >
            {t("epub_viewer.settings.input_controls.click_left")}
          </button>
        </div>
      </div>

    </div>
  );
}
