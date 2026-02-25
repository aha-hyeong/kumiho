import { useTranslation } from "react-i18next";
import type { EpubViewerSettings, EpubTheme, EpubFlow } from "../../../../stores/epubViewerStore";
import styles from "./index.module.css";

interface EpubSettingsPanelProps {
  settings: EpubViewerSettings;
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: string) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onFlowChange: (flow: EpubFlow) => void;
}

export function EpubSettingsPanel({
  settings,
  onFontSizeChange,
  onFontFamilyChange,
  onLineHeightChange,
  onThemeChange,
  onFlowChange,
}: EpubSettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <div className={styles.panel}>
      <h3 className={styles.title}>{t("epub_viewer.settings.title")}</h3>

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
          min={70}
          max={200}
          step={10}
          value={settings.fontSize}
          onChange={(e) => onFontSizeChange(Number(e.target.value))}
          className={styles.slider}
        />
        <div className={styles.sliderLabels}>
          <span>70%</span>
          <span>200%</span>
        </div>
      </div>

      {/* 글꼴 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.font_family.label")}</label>
        <div className={styles.buttonGroup}>
          {(["default", "serif", "sans-serif"] as const).map((family) => {
            const labelKey = family === "sans-serif" ? "sans_serif" : family;
            return (
              <button
                key={family}
                type="button"
                className={`${styles.optionBtn} ${settings.fontFamily === family ? styles.active : ""}`}
                onClick={() => onFontFamilyChange(family)}
              >
                {t(`epub_viewer.settings.font_family.${labelKey}`)}
              </button>
            );
          })}
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
        />
        <div className={styles.sliderLabels}>
          <span>1.2</span>
          <span>2.0</span>
        </div>
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

      {/* 레이아웃 */}
      <div className={styles.section}>
        <label className={styles.label}>{t("epub_viewer.settings.flow.label")}</label>
        <div className={styles.buttonGroup}>
          {(["paginated", "scrolled"] as EpubFlow[]).map((flow) => (
            <button
              key={flow}
              type="button"
              className={`${styles.optionBtn} ${settings.flow === flow ? styles.active : ""}`}
              onClick={() => onFlowChange(flow)}
            >
              {t(`epub_viewer.settings.flow.${flow}`)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
