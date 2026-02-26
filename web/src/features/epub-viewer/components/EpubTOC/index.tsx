import { useTranslation } from "react-i18next";
import type { EpubTOCItem } from "../EpubChapterViewer";
import styles from "./EpubTOC.module.css";

interface EpubTOCProps {
  toc: EpubTOCItem[];
  onItemClick: (cfi: string) => void;
  currentCFI?: string | null;
}

export function EpubTOC({ toc, onItemClick, currentCFI }: EpubTOCProps) {
  const { t } = useTranslation();

  const renderItems = (items: EpubTOCItem[], depth = 0) => {
    return (
      <ul
        className={styles.list}
        style={{ paddingLeft: depth > 0 ? "16px" : "0" }}
      >
        {items.map((item) => {
          // currentCFI는 보통 "filename.xhtml#epubcfi(...)" 형태일 수 있음
          // item.href는 "filename.xhtml" 또는 "filename.xhtml#fragment" 형태임
          const currentBaseHref = currentCFI?.split("#")[0];
          const itemBaseHref = item.href.split("#")[0];
          const isActive = currentBaseHref === itemBaseHref;
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
    <div className={styles.panel}>
      <h3 className={styles.title}>{t("epub_viewer.toc.title", { defaultValue: "목차" })}</h3>
      {toc.length > 0 ? (
        renderItems(toc)
      ) : (
        <div className={styles.empty}>{t("epub_viewer.toc.empty", { defaultValue: "목차가 없습니다." })}</div>
      )}
    </div>
  );
}
