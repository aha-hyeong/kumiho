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
            진행도 동기화
          </h2>
        </div>
        <div className={styles.content}>
          <p>다른 기기에서 더 많이 읽은 기록이 있습니다.</p>
          <div className={styles.info}>
            <span className={styles.highlight}>
              {serverProgress.volume_number > 0 && `${serverProgress.volume_number}권 `}
              {serverProgress.chapter_number}화 {serverProgress.current_page}페이지
            </span>
            <span> 위치로 이동할까요?</span>
          </div>
        </div>
        <div className={styles.footer}>
          <button
            className={`${styles.button} ${styles.cancel}`}
            onClick={onClose}
          >
            취소
          </button>
          <button
            className={`${styles.button} ${styles.confirm}`}
            onClick={onConfirm}
          >
            이동하기
          </button>
        </div>
      </div>
    </div>
  );
}
