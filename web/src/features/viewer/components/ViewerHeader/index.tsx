// 뷰어 상단 바 컴포넌트

import { ArrowLeft, Settings, Maximize, Minimize, Shield, Music } from "lucide-react";
import styles from "./ViewerHeader.module.css";

interface ViewerHeaderProps {
  title: string;
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isIncognito: boolean;
  isFullscreen: boolean;
  bgmInfo: { exists: boolean; url?: string } | null;
  isBgmPlaying: boolean;
  onBack: () => void;
  onToggleFullscreen: () => void;
  onToggleSettings: () => void;
  onToggleBgm: () => void;
}

export function ViewerHeader({
  title,
  currentPage,
  totalPages,
  isUIVisible,
  isIncognito,
  isFullscreen,
  bgmInfo,
  isBgmPlaying,
  onBack,
  onToggleFullscreen,
  onToggleSettings,
  onToggleBgm,
}: ViewerHeaderProps) {
  return (
    <header className={`${styles.viewerHeader} ${!isUIVisible ? styles.hidden : ""}`}>
      <button
        type="button"
        className={styles.headerBack}
        onClick={onBack}
        aria-label="뒤로 가기"
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
        <button
          type="button"
          className={styles.headerActionBtn}
          onClick={onToggleFullscreen}
          title={isFullscreen ? "전체화면 종료" : "전체화면"}
          aria-label={isFullscreen ? "전체화면 종료" : "전체화면"}
        >
          {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
        </button>
        <button
          type="button"
          className={styles.headerSettings}
          onClick={onToggleSettings}
          aria-label="뷰어 설정"
        >
          <Settings size={24} />
        </button>

        {/* BGM Toggle */}
        {bgmInfo?.exists && (
          <button
            type="button"
            className={`${styles.headerActionBtn} ${styles.bgmButton} ${!isBgmPlaying ? styles.muted : ""}`}
            onClick={onToggleBgm}
            title={isBgmPlaying ? "배경음악 끄기" : "배경음악 켜기"}
            aria-label={isBgmPlaying ? "배경음악 끄기" : "배경음악 켜기"}
          >
            <Music size={24} />
          </button>
        )}
      </div>
    </header>
  );
}
