import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import styles from "./SubHeader.module.css";

export interface BreadcrumbItem {
  label: ReactNode;
  to?: string;
}

interface SubHeaderProps {
  /** 뒤로가기 버튼 표시 여부 (기본: true) */
  showBackButton?: boolean;
  /** 뒤로가기 버튼 클릭 핸들러 (미지정 시 navigate(-1)) */
  onBack?: () => void;
  /** 브레드크럼 아이템 배열 (마지막 아이템이 현재 페이지) */
  items?: BreadcrumbItem[];
  /** 오른쪽 영역에 표시할 콘텐츠 (버튼 등) */
  rightContent?: ReactNode;
  /** 페이지 타이틀 (items가 없을 때 표시) */
  title?: ReactNode;
}

export function SubHeader({ showBackButton = true, onBack, items, rightContent, title }: SubHeaderProps) {
  const { t } = useTranslation();
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
      <div className={styles.subHeaderContent}>
        <div className={styles.subHeaderLeft}>
          {showBackButton && (
            <button
              className={styles.backButton}
              onClick={handleBack}
            >
              <ArrowLeft size={16} />
              {t("common.back")}
            </button>
          )}

          {items && items.length > 0 ? (
            <div className={styles.breadcrumb}>
              {items.map((item, index) => {
                const isLast = index === items.length - 1;
                return (
                  <div
                    key={index}
                    style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                  >
                    {item.to && !isLast ? (
                      <Link
                        to={item.to}
                        className={styles.breadcrumbItem}
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <span className={isLast ? styles.breadcrumbCurrent : styles.breadcrumbItem}>{item.label}</span>
                    )}
                    {!isLast && <span className={styles.breadcrumbSeparator}>/</span>}
                  </div>
                );
              })}
            </div>
          ) : (
            title && <h2 className={styles.subHeaderTitle}>{title}</h2>
          )}
        </div>
        {rightContent && <div className={styles.subHeaderRight}>{rightContent}</div>}
      </div>
    </div>
  );
}
