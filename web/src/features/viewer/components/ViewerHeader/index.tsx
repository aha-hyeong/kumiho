import { useTranslation } from "react-i18next";

import { ArrowLeft, Settings, Maximize, Minimize, Shield, Music, List } from "lucide-react";
import styles from "./ViewerHeader.module.css";

interface ViewerHeaderProps {
  state: {
    title: string;
    currentPage: number;
    totalPages: number;
    isUIVisible: boolean;
    isIncognito: boolean;
    isFullscreen: boolean;
    isBgmPlaying: boolean;
    bgmInfo: { exists: boolean; url?: string } | null;
  };
  actions: {
    onBack: () => void;
    onToggleFullscreen: () => void;
    onToggleSettings: () => void;
    onToggleBgm: () => void;
  };
  pdfOptions?:
    | {
        showZoomControls?: false;
        hasTOC?: boolean;
        onToggleTOC?: () => void;
      }
    | {
        showZoomControls: true;
        hasTOC: boolean;
        onToggleTOC?: () => void;
        zoomPercent: number;
        onZoomIn: () => void;
        onZoomOut: () => void;
        onZoomReset: () => void;
      };
}

export function ViewerHeader({ state, actions, pdfOptions }: ViewerHeaderProps) {
  const { t } = useTranslation();

  const { title, currentPage, totalPages, isUIVisible, isIncognito, isFullscreen, isBgmPlaying, bgmInfo } = state;

  const { onBack, onToggleFullscreen, onToggleSettings, onToggleBgm } = actions;

  const isZoomEnabledPdfOptions = (
    options: ViewerHeaderProps["pdfOptions"],
  ): options is Extract<NonNullable<ViewerHeaderProps["pdfOptions"]>, { showZoomControls: true }> =>
    options?.showZoomControls === true;

  const zoomPdfOptions = isZoomEnabledPdfOptions(pdfOptions) ? pdfOptions : null;
  const showZoomControls = zoomPdfOptions !== null;
  const hasTOC = pdfOptions?.hasTOC === true;
  const onToggleTOC = hasTOC ? pdfOptions.onToggleTOC : undefined;
  const zoomPercent = zoomPdfOptions?.zoomPercent ?? 100;
  const onZoomIn = zoomPdfOptions?.onZoomIn;
  const onZoomOut = zoomPdfOptions?.onZoomOut;
  const onZoomReset = zoomPdfOptions?.onZoomReset;
  return (
    <header className={`${styles.viewerHeader} ${!isUIVisible ? styles.hidden : ""}`}>
      <button
        type="button"
        className={styles.headerBack}
        onClick={onBack}
        aria-label={t("viewer.header.back")}
      >
        <ArrowLeft size={24} />
      </button>
      <div className={styles.headerTitle}>
        {isIncognito && (
          <Shield
            size={18}
            className={styles.incognitoIcon}
          />
        )}
        {title} - {currentPage} / {totalPages}
      </div>
      <div className={styles.headerActions}>
        {showZoomControls && onZoomIn && onZoomOut && onZoomReset && (
          <div className={styles.zoomControls}>
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={onZoomOut}
              aria-label={t("viewer.header.zoom_out")}
              title={t("viewer.header.zoom_out")}
            >
              -
            </button>
            <button
              type="button"
              className={styles.zoomPercent}
              onClick={onZoomReset}
              aria-label={t("viewer.header.zoom_reset")}
              title={t("viewer.header.zoom_reset")}
            >
              {zoomPercent}%
            </button>
            <button
              type="button"
              className={styles.zoomBtn}
              onClick={onZoomIn}
              aria-label={t("viewer.header.zoom_in")}
              title={t("viewer.header.zoom_in")}
            >
              +
            </button>
          </div>
        )}
        <button
          type="button"
          className={styles.headerActionBtn}
          onClick={onToggleFullscreen}
          title={isFullscreen ? t("viewer.header.exit_fullscreen") : t("viewer.header.fullscreen")}
          aria-label={isFullscreen ? t("viewer.header.exit_fullscreen") : t("viewer.header.fullscreen")}
        >
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
        <button
          type="button"
          className={styles.headerSettings}
          onClick={onToggleSettings}
          aria-label={t("viewer.header.settings")}
        >
          <Settings size={24} />
        </button>

        {hasTOC && onToggleTOC && (
          <button
            type="button"
            className={styles.headerActionBtn}
            onClick={onToggleTOC}
            aria-label={t("viewer.header.toc", { defaultValue: "목차" })}
          >
            <List size={24} />
          </button>
        )}

        {/* BGM Toggle */}
        {bgmInfo?.exists && (
          <button
            type="button"
            className={`${styles.headerActionBtn} ${styles.bgmButton} ${!isBgmPlaying ? styles.muted : ""}`}
            onClick={onToggleBgm}
            title={isBgmPlaying ? t("viewer.header.bgm_off") : t("viewer.header.bgm_on")}
            aria-label={isBgmPlaying ? t("viewer.header.bgm_off") : t("viewer.header.bgm_on")}
          >
            <Music size={24} />
          </button>
        )}
      </div>
    </header>
  );
}
