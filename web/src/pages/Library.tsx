import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link } from "react-router-dom";
import { Folder, RefreshCw } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import type { Library } from "../stores/libraryStore";
import { useAuthStore } from "../stores/authStore";
import { libraryAPI, seriesAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { Toast } from "../components/common/Toast";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Series } from "../types/series";
import { resolveSeriesExtensionMapWithCache, type ExtensionBadge } from "../utils/extension";
import styles from "./Library.module.css";

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();

  const { fetchLibraries, triggerRefresh, refreshKey } = useLibraryStore();

  // 데이터 상태
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [seriesExtensionMap, setSeriesExtensionMap] = useState<Partial<Record<string, ExtensionBadge>>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const seriesExtensionCacheRef = useRef<Map<string, ExtensionBadge | "">>(new Map());
  const loadSequenceRef = useRef(0);

  const user = useAuthStore((state) => state.user);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadData = useCallback(async () => {
    if (!id) return;
    const currentLoad = ++loadSequenceRef.current;
    setIsLoading(true);
    setSeriesExtensionMap({});

    try {
      const response = await libraryAPI.get(id);
      if (currentLoad !== loadSequenceRef.current) return;
      setLibrary(response.data);

      const seriesResponse = await libraryAPI.getSeries(id);
      const loadedSeries: Series[] = seriesResponse.data.series || [];
      if (currentLoad !== loadSequenceRef.current) return;
      setSeriesList(loadedSeries);

      setIsLoading(false);

      void (async () => {
        const extensionMap = await resolveSeriesExtensionMapWithCache({
          seriesList: loadedSeries,
          cache: seriesExtensionCacheRef.current,
          fetchVolumePaths: async (seriesId) => {
            const volumesRes = await seriesAPI.getVolumes(seriesId);
            const volumes = Array.isArray(volumesRes.data?.volumes) ? volumesRes.data.volumes : [];
            return volumes.map((volume: { path?: string }) => volume.path);
          },
          onError: (seriesId, error) => {
            console.warn(`Failed to resolve extension for series ${seriesId}:`, error);
          },
        });
        if (currentLoad !== loadSequenceRef.current) return;
        setSeriesExtensionMap(extensionMap);
      })().catch((error) => {
        console.warn("Failed to resolve library series extensions:", error);
      });
    } catch (error) {
      console.error("Failed to load library data:", error);
      if (currentLoad === loadSequenceRef.current) {
        setIsLoading(false);
      }
    }
  }, [id]);

  useEffect(() => {
    if (id) {
      seriesExtensionCacheRef.current.clear();
      const timer = window.setTimeout(() => {
        void loadData();
      }, 0);
      fetchLibraries();
      // ID가 바뀌면 사이드바 닫기 (선택적)
      setSidebarOpen(false);
      return () => {
        window.clearTimeout(timer);
        loadSequenceRef.current += 1;
      };
    }
  }, [id, refreshKey, loadData, fetchLibraries]);

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    setStatus(null); // 이전 메시지 제거
    setTimeout(() => {
      setStatus({ type: "info", message: t("settings.libraries.toast.scan_started") });
    }, 0);
    try {
      await libraryAPI.scan(id);
      seriesExtensionCacheRef.current.clear();
      await loadData();
      triggerRefresh();
      setStatus(null); // 이전 메시지 제거
      setTimeout(() => {
        setStatus({ type: "success", message: t("settings.libraries.toast.scan_completed") });
      }, 0);
    } catch (error: unknown) {
      console.error("Scan failed:", error);
      const err = error as { response?: { status?: number } };
      if (err.response?.status === 409) {
        setStatus({ type: "info", message: t("settings.libraries.toast.scan_running") });
      } else {
        setStatus({ type: "error", message: t("settings.libraries.toast.scan_failed") });
      }
    } finally {
      setIsScanning(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  // 라이브러리를 찾을 수 없는 경우
  if (!library) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <div className={styles.errorContainer}>
          <p>{t("home.library.not_found")}</p>
          <Link
            to="/"
            className={styles.backLink}
          >
            {t("common.go_home")}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.libraryContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      {status && (
        <Toast
          type={status.type}
          message={status.message}
          onClose={() => setStatus(null)}
        />
      )}
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 메인 콘텐츠 */}
      <div className={styles.libraryContentWrapper}>
        <SubHeader
          showBackButton={false}
          title={
            <>
              <Folder size={24} /> {library.name}
            </>
          }
          rightContent={
            library.type !== "SYSTEM" &&
            user?.role === "MASTER" && (
              <button
                onClick={handleScan}
                disabled={isScanning}
                className={styles.scanBtn}
              >
                {isScanning ? (
                  <>
                    <RefreshCw
                      size={16}
                      className={styles.spin}
                    />{" "}
                    {t("home.library.scan_in_progress")}
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} /> {t("home.library.scan")}
                  </>
                )}
              </button>
            )
          }
        />

        {/* 시리즈 그리드 */}
        <main className={styles.libraryMain}>
          <div className={styles.seriesCount}>
            <Trans
              i18nKey="home.library.total_series"
              count={seriesList.length}
              components={{ strong: <strong /> }}
            />
          </div>

          {seriesList.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t("home.library.empty_series")}</p>
              {library.type !== "SYSTEM" && user?.role === "MASTER" && (
                <button
                  onClick={handleScan}
                  className={`${styles.scanBtn} ${styles.primary}`}
                >
                  <RefreshCw size={16} /> {t("home.library.scan_now")}
                </button>
              )}
            </div>
          ) : (
            <div className={styles.seriesGrid}>
              {seriesList.map((series) => (
                <SeriesCard
                  key={series.id}
                  item={series}
                  type="series"
                  progressStyle="overlay"
                  showExtensionBadge
                  extensionBadgeText={seriesExtensionMap[series.id]}
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
