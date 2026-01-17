import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import { X, Folder, Plus, RefreshCw } from "lucide-react";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI } from "../api/client";
import styles from "./Sidebar.module.css";

interface Library {
  id: string;
  name: string;
  path: string;
  last_scanned_at?: string;
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  onAddLibrary?: () => void;
  refreshKey?: number; // 이 값이 변경되면 라이브러리 목록 새로고침
}

export function Sidebar({ isOpen, onClose, onAddLibrary, refreshKey }: SidebarProps) {
  const user = useAuthStore((state) => state.user);
  const location = useLocation();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadLibraries = useCallback(async () => {
    try {
      const res = await libraryAPI.getAll();
      setLibraries(res.data.libraries || []);
    } catch (error) {
      console.error("Failed to load libraries:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLibraries();
  }, [refreshKey, loadLibraries]);

  const handleScan = async (libraryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await libraryAPI.scan(libraryId);
      await loadLibraries();
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
              {user?.role === "MASTER" && (
                <button
                  onClick={onAddLibrary}
                  className={styles.addLibraryBtn}
                >
                  <Plus size={16} /> 추가하기
                </button>
              )}
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

              {user?.role === "MASTER" && (
                <button
                  onClick={onAddLibrary}
                  className={styles.addLibraryNavBtn}
                >
                  <Plus size={16} /> 라이브러리 추가
                </button>
              )}
            </nav>
          )}
        </div>
      </aside>
    </>
  );
}
