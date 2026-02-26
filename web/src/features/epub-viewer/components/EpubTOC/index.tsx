import { useTranslation } from "react-i18next";
import type { EpubTOCItem } from "../EpubChapterViewer";
import styles from "./EpubTOC.module.css";

interface EpubTOCProps {
  toc: EpubTOCItem[];
  onItemClick: (cfi: string) => void;
}

export function EpubTOC({ toc, onItemClick }: EpubTOCProps) {
  const { t } = useTranslation();

  const renderItems = (items: EpubTOCItem[], depth = 0) => {
    return (
      <ul
        className={styles.list}
        style={{ paddingLeft: depth > 0 ? "16px" : "0" }}
      >
        {items.map((item) => (
          <li
            key={item.id}
            className={styles.item}
          >
            <button
              className={styles.tocBtn}
              onClick={() => onItemClick(item.href)}
              title={item.label}
            >
              {item.label}
            </button>
            {item.subitems && item.subitems.length > 0 && renderItems(item.subitems, depth + 1)}
          </li>
        ))}
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
