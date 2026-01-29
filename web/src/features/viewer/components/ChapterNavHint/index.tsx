// 챕터 이동 힌트 오버레이 컴포넌트

import styles from "./ChapterNavHint.module.css";

interface ChapterNavHintProps {
  type: "next" | "prev";
  title: string;
  show: boolean;
}

export function ChapterNavHint({ type, title, show }: ChapterNavHintProps) {
  if (!show) return null;

  return (
    <div className={`${styles.chapterOverlay} ${styles[type]}`}>
      <div className={styles.chapterOverlayContent}>
        <span className={styles.chapterOverlayLabel}>{type === "next" ? "다음:" : "이전:"}</span>
        <span className={styles.chapterOverlayTitle}>{title}</span>
        <span className={styles.chapterOverlayDesc}>한 번 더 누르면 이동합니다</span>
      </div>
    </div>
  );
}
