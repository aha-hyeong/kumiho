import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { EpubTOCItem } from "../EpubChapterViewer";
import styles from "./EpubTOC.module.css";

interface EpubTOCProps {
  toc: EpubTOCItem[];
  onItemClick: (cfi: string) => void;
  currentChapterHref?: string;
  onClose: () => void;
}

export function EpubTOC({ toc, onItemClick, currentChapterHref, onClose }: EpubTOCProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // 패널 열릴 때 현재 챕터로 자동 스크롤
  useEffect(() => {
    if (!panelRef.current) return;
    const activeBtn = panelRef.current.querySelector(`.${styles.active}`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: "center", behavior: "auto" });
    }
  }, [currentChapterHref]);

  const renderItems = (items: EpubTOCItem[], depth = 0) => {
    return (
      <ul
        className={styles.list}
        style={{ paddingLeft: depth > 0 ? "16px" : "0" }}
      >
        {items.map((item) => {
          const itemBaseHref = item.href.split("#")[0];
          const currentBase = currentChapterHref?.split("#")[0] || "";
          const isActive = currentBase === itemBaseHref;
          return (
            <li
              key={item.id}
              className={styles.item}
            >
              <button
                className={`${styles.tocBtn} ${isActive ? styles.active : ""}`}
                onClick={() => onItemClick(item.navigationCfi || item.href)}
                title={item.label}
              >
                {item.label}
              </button>
              {item.subitems && item.subitems.length > 0 && renderItems(item.subitems, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div
      className={styles.panel}
      ref={panelRef}
    >
      <div className={styles.header}>
        <h3 className={styles.title}>{t("epub_viewer.toc.title", { defaultValue: "목차" })}</h3>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label={t("epub_viewer.toc.close", { defaultValue: "닫기" })}
          title={t("epub_viewer.toc.close", { defaultValue: "닫기" })}
        >
          <X
            size={16}
            aria-hidden="true"
          />
        </button>
      </div>
      <div className={styles.content}>
        {toc.length > 0 ? (
          renderItems(toc)
        ) : (
          <div className={styles.empty}>{t("epub_viewer.toc.empty", { defaultValue: "목차가 없습니다." })}</div>
        )}
      </div>
    </div>
  );
}
