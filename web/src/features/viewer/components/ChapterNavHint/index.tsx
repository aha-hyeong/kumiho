// 챕터 이동 힌트 오버레이 컴포넌트

import { useTranslation } from "react-i18next";
import styles from "./ChapterNavHint.module.css";

interface ChapterNavHintProps {
  type: "next" | "prev";
  title: string;
  show: boolean;
}

export function ChapterNavHint({ type, title, show }: ChapterNavHintProps) {
  const { t } = useTranslation();

  if (!show) return null;

  return (
    <div className={`${styles.chapterOverlay} ${styles[type]}`}>
      <div className={styles.chapterOverlayContent}>
        <span className={styles.chapterOverlayLabel}>
          {type === "next" ? t("viewer.guide.move_next_label") : t("viewer.guide.move_prev_label")}
        </span>
        <span className={styles.chapterOverlayTitle}>{title}</span>
        <span className={styles.chapterOverlayDesc}>{t("viewer.guide.move_guide_msg")}</span>
      </div>
    </div>
  );
}
