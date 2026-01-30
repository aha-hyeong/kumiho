import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { X, Folder, RefreshCw, Heart, Square } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { useScanStore } from "../stores/scanStore";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI } from "../api/client";
import { Toast } from "./common/Toast";
import styles from "./Sidebar.module.css";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { t } = useTranslation();
  const location = useLocation();
  const { libraries, isLoading, fetchLibraries, triggerRefresh } = useLibraryStore();
  const { startPolling, stopPolling } = useScanStore();
  const user = useAuthStore((state) => state.user);

  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const fetchLibrariesCallback = useCallback(() => {
    fetchLibraries();
  }, [fetchLibraries]);

  useEffect(() => {
    fetchLibrariesCallback();
  }, [fetchLibrariesCallback]);

  const handleScan = async (libraryId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 로컬 클라이언트 단에서의 중복 클릭 방지 (API 응답 대기 중)
    if (scanningIds.has(libraryId)) return;

    const library = libraries.find((l) => l.id === libraryId);
    const isCurrentlyScanning = library?.scan_status === "SCANNING";

    setScanningIds((prev) => new Set(prev).add(libraryId));
    setStatus(null);

    try {
      if (isCurrentlyScanning) {
        await libraryAPI.cancelScan(libraryId);
        stopPolling(); // 스캔 취소 시 진행률 폴링 중단
        setStatus({ type: "info", message: t("sidebar.scan_cancel_request") });
        await fetchLibraries();
        triggerRefresh();
        return;
      }

      setStatus({ type: "info", message: t("sidebar.scan_started") });
      startPolling();

      await libraryAPI.scan(libraryId);
      await fetchLibraries();
      triggerRefresh();
      setStatus(null);
      setTimeout(() => {
        setStatus({ type: "success", message: t("sidebar.scan_completed") });
      }, 0);
    } catch (error: unknown) {
      console.error("Scan failed:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("sidebar.scan_already_in_progress") });
      } else {
        setStatus({ type: "error", message: t("sidebar.scan_failed") });
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
          <h2>{t("sidebar.title")}</h2>
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
              <p>{t("sidebar.empty")}</p>
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
                      <span className={styles.libraryNavName}>
                        {library.type === "SYSTEM" && library.name === "좋아요한 시리즈"
                          ? t("sidebar.system.liked")
                          : library.name}
                      </span>
                    </div>
                    {library.type !== "SYSTEM" && user?.role === "MASTER" && (
                      <button
                        className={styles.libraryScanBtn}
                        onClick={(e) => handleScan(library.id, e)}
                        title={
                          library.scan_status === "SCANNING"
                            ? t("sidebar.scan_cancel_tooltip")
                            : t("sidebar.scan_tooltip")
                        }
                        disabled={scanningIds.has(library.id)}
                        style={{
                          color: library.scan_status === "SCANNING" ? "#fc8181" : undefined,
                        }}
                      >
                        {scanningIds.has(library.id) ? (
                          <div
                            className={styles.loadingSpinnerSmall}
                            style={{ width: 14, height: 14, borderWidth: 2 }}
                          />
                        ) : library.scan_status === "SCANNING" ? (
                          <Square
                            size={14}
                            fill="currentColor"
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
