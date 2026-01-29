// 페이지 점프 모달 컴포넌트

import { useState } from "react";
import styles from "./PageJumpModal.module.css";

interface PageJumpModalProps {
  show: boolean;
  totalPages: number;
  onClose: () => void;
  onJump: (page: number) => void;
}

export function PageJumpModal({ show, totalPages, onClose, onJump }: PageJumpModalProps) {
  const [jumpValue, setJumpValue] = useState("");

  if (!show) return null;

  const handleJump = () => {
    const page = parseInt(jumpValue, 10);
    if (!isNaN(page) && page >= 1 && page <= totalPages) {
      onJump(page);
    }
    onClose();
    setJumpValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleJump();
    } else if (e.key === "Escape") {
      onClose();
      setJumpValue("");
    }
  };

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
        aria-labelledby="page-jump-title"
      >
        <div
          id="page-jump-title"
          className={styles.title}
        >
          페이지 이동
        </div>
        <input
          type="number"
          className={styles.input}
          value={jumpValue}
          onChange={(e) => setJumpValue(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
          placeholder={`1 - ${totalPages}`}
          aria-label="이동할 페이지 번호 입력"
        />
      </div>
    </div>
  );
}
