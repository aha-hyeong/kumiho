import React, { useState } from "react";
import { ChevronRight, ChevronDown, X } from "lucide-react";
import type { PDFOutlineItem } from "../PdfChapterViewer";
import styles from "./PdfTOC.module.css";

interface PdfTOCProps {
  isOpen: boolean;
  items: PDFOutlineItem[];
  onClose: () => void;
  onJump: (page: number) => void;
  currentPage: number;
}

const TOCItem: React.FC<{ item: PDFOutlineItem; level: number; onJump: (page: number) => void }> = ({
  item,
  level,
  onJump,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasItems = item.items && item.items.length > 0;

  return (
    <div
      className={styles.tocItemContainer}
      style={{ paddingLeft: `${Math.min(level, 4) * 16}px` }}
    >
      <div className={styles.tocItemRow}>
        {hasItems ? (
          <button
            type="button"
            className={styles.expandButton}
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : (
          <div className={styles.expandPlaceholder} />
        )}
        <button
          type="button"
          className={styles.tocItemButton}
          onClick={() => {
            if (item.pageNumber) onJump(item.pageNumber);
          }}
          disabled={!item.pageNumber}
        >
          <span className={styles.tocItemTitle}>{item.title}</span>
          {item.pageNumber && <span className={styles.tocItemPage}>{item.pageNumber}</span>}
        </button>
      </div>
      {expanded && hasItems && (
        <div className={styles.tocChildren}>
          {item.items.map((child, idx) => (
            <TOCItem
              key={idx}
              item={child}
              level={level + 1}
              onJump={onJump}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const PdfTOC: React.FC<PdfTOCProps> = ({ isOpen, items, onClose, onJump }) => {
  return (
    <div className={`${styles.tocSidebar} ${isOpen ? styles.open : ""}`}>
      <div className={styles.tocHeader}>
        <h3>목차</h3>
        <button
          type="button"
          className={styles.closeButton}
          onClick={onClose}
          aria-label="닫기"
        >
          <X size={20} />
        </button>
      </div>
      <div className={styles.tocContent}>
        {items.length === 0 ? (
          <div className={styles.emptyMessage}>요약된 목차가 없습니다.</div>
        ) : (
          items.map((item, idx) => (
            <TOCItem
              key={idx}
              item={item}
              level={0}
              onJump={onJump}
            />
          ))
        )}
      </div>
    </div>
  );
};
