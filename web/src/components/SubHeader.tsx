import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import styles from "./SubHeader.module.css";

interface SubHeaderProps {
  /** 뒤로가기 버튼 표시 여부 (기본: true) */
  showBackButton?: boolean;
  /** 뒤로가기 버튼 클릭 핸들러 (미지정 시 navigate(-1)) */
  onBack?: () => void;
  /** 왼쪽 영역에 표시할 콘텐츠 (breadcrumb 등) */
  leftContent?: ReactNode;
  /** 오른쪽 영역에 표시할 콘텐츠 (버튼 등) */
  rightContent?: ReactNode;
  /** 페이지 타이틀 (leftContent가 없을 때 표시) */
  title?: string;
}

export function SubHeader({ showBackButton = true, onBack, leftContent, rightContent, title }: SubHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigate(-1);
    }
  };

  return (
    <div className={styles.subHeader}>
      <div className={styles.subHeaderLeft}>
        {showBackButton && (
          <button
            className={styles.backButton}
            onClick={handleBack}
          >
            <ArrowLeft size={16} />
            뒤로
          </button>
        )}
        {leftContent && <div className={styles.subHeaderLeftContent}>{leftContent}</div>}
        {!leftContent && title && <h2 className={styles.subHeaderTitle}>{title}</h2>}
      </div>
      {rightContent && <div className={styles.subHeaderRight}>{rightContent}</div>}
    </div>
  );
}
