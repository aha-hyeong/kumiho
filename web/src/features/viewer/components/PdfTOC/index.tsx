import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { PDFOutlineItem } from "../PdfChapterViewer";
import styles from "./PdfTOC.module.css";

interface PdfTOCProps {
  isOpen: boolean;
  items: PDFOutlineItem[];
  onClose: () => void;
  onJump: (page: number) => void;
  currentPage: number;
}

const TOCItem: React.FC<{
  item: PDFOutlineItem;
  level: number;
  onJump: (page: number) => void;
  currentPage: number;
}> = ({
  item,
  level,
  onJump,
  currentPage,
}) => {
  const [expanded, setExpanded] = useState(false);
  const hasItems = item.items && item.items.length > 0;
  const isActive = Boolean(item.pageNumber && currentPage === item.pageNumber);

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
          className={`${styles.tocItemButton} ${isActive ? styles.active : ""}`}
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
              currentPage={currentPage}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export const PdfTOC: React.FC<PdfTOCProps> = ({ isOpen, items, onClose, onJump, currentPage }) => {
  const { t } = useTranslation();

  return (
    <div
      className={`${styles.tocOverlay} ${isOpen ? styles.open : ""}`}
      onClick={onClose}
      aria-hidden={!isOpen}
      inert={!isOpen}
      hidden={!isOpen}
    >
      <div
        className={`${styles.tocSidebar} ${isOpen ? styles.open : ""}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.tocHeader}>
          <h3>{t("viewer.toc.title")}</h3>
        </div>
        <div className={styles.tocContent}>
          {items.length === 0 ? (
            <div className={styles.emptyMessage}>{t("viewer.toc.empty")}</div>
          ) : (
            items.map((item, idx) => (
              <TOCItem
                key={idx}
                item={item}
                level={0}
                onJump={onJump}
                currentPage={currentPage}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
