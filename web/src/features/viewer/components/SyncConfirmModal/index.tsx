import { useTranslation, Trans } from "react-i18next";
import styles from "./SyncConfirmModal.module.css";

interface SyncConfirmModalProps {
  show: boolean;
  onClose: () => void;
  onConfirm: () => void;
  serverProgress: {
    volume_number: number;
    chapter_number: number;
    current_page: number;
  } | null;
}

export function SyncConfirmModal({ show, onClose, onConfirm, serverProgress }: SyncConfirmModalProps) {
  const { t } = useTranslation();

  if (!show || !serverProgress) return null;

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
    >
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sync-modal-title"
      >
        <div className={styles.header}>
          <h2
            id="sync-modal-title"
            className={styles.title}
          >
            {t("viewer.sync.title")}
          </h2>
        </div>
        <div className={styles.content}>
          <p>{t("viewer.sync.message")}</p>
          <div className={styles.info}>
            <Trans
              i18nKey="viewer.sync.move_confirm"
              values={{
                location: [
                  serverProgress.volume_number > 0
                    ? t("series.unit.volume", { count: serverProgress.volume_number })
                    : "",
                  t("series.unit.chapter", { count: serverProgress.chapter_number }),
                  t("series.unit.page", { count: serverProgress.current_page }),
                ]
                  .filter(Boolean)
                  .join(" "),
              }}
              components={{ 0: <span className={styles.highlight} /> }}
            />
          </div>
        </div>
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.cancel}`}
            onClick={onClose}
          >
            {t("viewer.sync.cancel_btn")}
          </button>
          <button
            className={`${styles.button} ${styles.confirm}`}
            onClick={onConfirm}
          >
            {t("viewer.sync.confirm_btn")}
          </button>
        </div>
      </div>
    </div>
  );
}
