import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { X, Folder, RefreshCw } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { libraryAPI } from "../api/client";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const { libraries, isLoading, fetchLibraries } = useLibraryStore();

  useEffect(() => {
    fetchLibraries();
  }, []);

  const handleScan = async (libraryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await libraryAPI.scan(libraryId);
      await fetchLibraries();
    } catch (error) {
      console.error("Scan failed:", error);
    }
  };

  return (
    <>
      {/* 오버레이 */}
      <div
        className={`${styles.sidebarOverlay} ${isOpen ? styles.open : ""}`}
        onClick={onClose}
      />

      {/* 사이드바 */}
      <aside className={`${styles.sidebar} ${isOpen ? styles.open : ""}`}>
        <div className={styles.sidebarHeader}>
          <h2>라이브러리</h2>
          <button
            className={styles.closeBtn}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.sidebarContent}>
          {isLoading ? (
            <div className={styles.sidebarLoading}>
              <div className={styles.loadingSpinnerSmall} />
            </div>
          ) : libraries.length === 0 ? (
            <div className={styles.sidebarEmpty}>
              <p>라이브러리가 없습니다</p>
            </div>
          ) : (
            <nav className={styles.libraryNav}>
              {libraries.map((library) => (
                <Link
                  key={library.id}
                  to={`/libraries/${library.id}`}
                  className={`${styles.libraryNavItem} ${
                    location.pathname === `/libraries/${library.id}` ? styles.active : ""
                  }`}
                  onClick={onClose}
                >
                  <div className={styles.libraryNavIcon}>
                    <Folder size={18} />
                  </div>
                  <div className={styles.libraryNavInfo}>
                    <span className={styles.libraryNavName}>{library.name}</span>
                  </div>
                  <button
                    className={styles.libraryScanBtn}
                    onClick={(e) => handleScan(library.id, e)}
                    title="스캔"
                  >
                    <RefreshCw size={14} />
                  </button>
                </Link>
              ))}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}
