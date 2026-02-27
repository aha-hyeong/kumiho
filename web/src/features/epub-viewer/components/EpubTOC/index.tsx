import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { EpubTOCItem } from "../EpubChapterViewer";
import styles from "./EpubTOC.module.css";

interface EpubTOCProps {
  toc: EpubTOCItem[];
  onItemClick: (cfi: string) => void;
  currentChapterHref?: string;
}

export function EpubTOC({ toc, onItemClick, currentChapterHref }: EpubTOCProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);

  // 패널 열릴 때 현재 챕터로 자동 스크롤
  useEffect(() => {
    if (!panelRef.current) return;
    const activeBtn = panelRef.current.querySelector(`.${styles.active}`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ block: "center", behavior: "instant" });
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
                onClick={() => onItemClick(item.href)}
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
      <h3 className={styles.title}>{t("epub_viewer.toc.title", { defaultValue: "목차" })}</h3>
      {toc.length > 0 ? (
        renderItems(toc)
      ) : (
        <div className={styles.empty}>{t("epub_viewer.toc.empty", { defaultValue: "목차가 없습니다." })}</div>
      )}
    </div>
  );
}
