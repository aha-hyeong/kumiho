// 세로 모드 당김 인디케이터 컴포넌트

import { useNavigate } from "react-router-dom";
import styles from "./PullIndicator.module.css";

interface PullIndicatorProps {
  type: "prev" | "next";
  pullOffset: number;
  pullThreshold: number;
  showThreshold: number;
  chapterId: string | null;
  chapterTitle: string | null;
  saveProgress: () => Promise<void>;
}

export function PullIndicator({
  type,
  pullOffset,
  pullThreshold,
  showThreshold,
  chapterId,
  chapterTitle,
  saveProgress,
}: PullIndicatorProps) {
  const navigate = useNavigate();

  // 챕터 ID가 없으면 아예 렌더링하지 않음
  if (!chapterId) return null;

  // 오프셋이 있으면 visible 클래스 적용
  // 작은 오프셋이라도 감지되면 일단 보여주고(opacity 1), 0이 되면 CSS transition(1s)을 통해 사라짐
  const isVisible = (type === "prev" && pullOffset > 0) || (type === "next" && pullOffset < 0);

  const handleClick = async () => {
    // visible 상태일 때만 클릭 허용 (pointer-events로 제어하지만 안전장치)
    if (!isVisible && Math.abs(pullOffset) < showThreshold) return;

    await saveProgress();
    if (type === "prev") {
      navigate(`/viewer/${chapterId}?page=last`);
    } else {
      navigate(`/viewer/${chapterId}`);
    }
  };

  const progress = Math.min(100, Math.round((Math.abs(pullOffset) / pullThreshold) * 100));

  return (
    <button
      type="button"
      className={`${styles.pullIndicator} ${styles[type]} ${isVisible ? styles.visible : ""}`}
      style={{
        transform:
          type === "prev"
            ? `translateY(${Math.min(0, -15 + Math.abs(pullOffset) / 4)}px)`
            : `translateY(${Math.max(0, 15 - Math.abs(pullOffset) / 4)}px)`,
      }}
      onClick={handleClick}
      aria-label={`${type === "prev" ? "이전" : "다음"} 챕터로 이동: ${chapterTitle}`}
    >
      <div className={styles.content}>
        <span className={styles.label}>
          {type === "prev" ? "▲ 이전" : "▼ 다음"} ({progress}%)
        </span>
        <span className={styles.title}>{chapterTitle}</span>
        <span className={styles.hint}>계속 {type === "prev" ? "위로" : "아래로"} 스크롤하면 이동</span>
      </div>
    </button>
  );
}
