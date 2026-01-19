import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { Folder, RefreshCw } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import type { Library } from "../stores/libraryStore";
import { libraryAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import type { Series } from "../types/series";
import styles from "./Library.module.css";

export function LibraryPage() {
  const { id } = useParams<{ id: string }>();

  const { fetchLibraries } = useLibraryStore();

  // 데이터 상태
  const [library, setLibrary] = useState<Library | null>(null);
  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (id) {
      loadData();
      fetchLibraries();
      // ID가 바뀌면 사이드바 닫기 (선택적)
      setSidebarOpen(false);
    }
  }, [id]);

  const loadData = async () => {
    if (!id) return;
    try {
      const response = await libraryAPI.get(id);
      setLibrary(response.data);
      const seriesResponse = await libraryAPI.getSeries(id);
      setSeriesList(seriesResponse.data.series || []);
    } catch (error) {
      console.error("Failed to load library data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleScan = async () => {
    if (!id) return;
    setIsScanning(true);
    try {
      await libraryAPI.scan(id);
      await loadData();
    } catch (error) {
      console.error("Scan failed:", error);
    } finally {
      setIsScanning(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.libraryContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <p>로딩 중...</p>
        </div>
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
          <p>라이브러리를 찾을 수 없습니다</p>
          <Link
            to="/"
            className={styles.backLink}
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.libraryContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
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
            library.type !== "SYSTEM" && (
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
                    스캔 중...
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} /> 스캔
                  </>
                )}
              </button>
            )
          }
        />

        {/* 시리즈 그리드 */}
        <main className={styles.libraryMain}>
          <div className={styles.seriesCount}>
            총 <strong>{seriesList.length}</strong>개의 시리즈
          </div>

          {seriesList.length === 0 ? (
            <div className={styles.emptyState}>
              <p>스캔된 시리즈가 없습니다</p>
              {library.type !== "SYSTEM" && (
                <button
                  onClick={handleScan}
                  className={`${styles.scanBtn} ${styles.primary}`}
                >
                  <RefreshCw size={16} /> 지금 스캔하기
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
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
