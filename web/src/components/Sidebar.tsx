import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { X, Folder, RefreshCw, Heart } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { libraryAPI } from "../api/client";
import { Toast } from "./common/Toast";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const location = useLocation();
  const { libraries, isLoading, fetchLibraries, triggerRefresh } = useLibraryStore();

  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  useEffect(() => {
    fetchLibraries();
  }, []);

  const handleScan = async (libraryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (scanningIds.has(libraryId)) return;

    setScanningIds((prev) => new Set(prev).add(libraryId));
    setStatus({ type: "info", message: "스캔을 시작했습니다." });

    try {
      await libraryAPI.scan(libraryId);
      await fetchLibraries();
      triggerRefresh();
      setStatus({ type: "success", message: "스캔이 완료되었습니다." });
    } catch (error: any) {
      console.error("Scan failed:", error);
      if (error.response?.status === 409) {
        setStatus({ type: "info", message: "이미 스캔이 진행 중입니다." });
      } else {
        setStatus({ type: "error", message: "스캔 요청에 실패했습니다." });
      }
    } finally {
      setScanningIds((prev) => {
        const next = new Set(prev);
        next.delete(libraryId);
        return next;
      });
    }
  };

  return (
    <>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
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
              {libraries
                .filter((library) => library.is_visible !== false)
                .map((library) => (
                  <Link
                    key={library.id}
                    to={`/libraries/${library.id}`}
                    className={`${styles.libraryNavItem} ${
                      location.pathname === `/libraries/${library.id}` ? styles.active : ""
                    }`}
                    onClick={onClose}
                  >
                    <div className={styles.libraryNavIcon}>
                      {library.type === "SYSTEM" ? (
                        <Heart
                          size={18}
                          fill={location.pathname === `/libraries/${library.id}` ? "currentColor" : "none"}
                        />
                      ) : (
                        <Folder size={18} />
                      )}
                    </div>
                    <div className={styles.libraryNavInfo}>
                      <span className={styles.libraryNavName}>{library.name}</span>
                    </div>
                    {library.type !== "SYSTEM" && (
                      <button
                        className={styles.libraryScanBtn}
                        onClick={(e) => handleScan(library.id, e)}
                        title="스캔"
                        disabled={scanningIds.has(library.id)}
                      >
                        {scanningIds.has(library.id) ? (
                          <div
                            className={styles.loadingSpinnerSmall}
                            style={{ width: 14, height: 14, borderWidth: 2 }}
                          />
                        ) : (
                          <RefreshCw size={14} />
                        )}
                      </button>
                    )}
                  </Link>
                ))}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}
