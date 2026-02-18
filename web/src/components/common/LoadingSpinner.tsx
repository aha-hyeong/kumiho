import { useTranslation } from "react-i18next";
import styles from "./LoadingSpinner.module.css";

interface LoadingSpinnerProps {
  text?: string | null;
  fullScreen?: boolean;
  className?: string;
}

export function LoadingSpinner({ text, fullScreen = false, className = "" }: LoadingSpinnerProps) {
  const { t } = useTranslation();

  return (
    <div className={`${styles.loadingContainer} ${fullScreen ? styles.fullScreen : ""} ${className}`}>
      <div className={styles.spinner} />
      {text !== null && <p>{text || t("common.loading")}</p>}
    </div>
  );
}
