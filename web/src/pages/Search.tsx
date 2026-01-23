import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search as SearchIcon, AlertCircle } from "lucide-react";
import { seriesAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { SubHeader } from "../components/headers/SubHeader";
import type { Series } from "../types/series";
import styles from "./Search.module.css";

export function SearchPage() {
  const [searchParams] = useSearchParams();
  const query = searchParams.get("q") || "";

  const [seriesList, setSeriesList] = useState<Series[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (query) {
      loadResults();
    } else {
      setSeriesList([]);
    }
  }, [query]);

  const loadResults = async () => {
    setIsLoading(true);
    try {
      const response = await seriesAPI.search(query);
      setSeriesList(response.data.series || []);
    } catch (error) {
      console.error("Failed to search series:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`${styles.searchContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className={styles.searchContentWrapper}>
        <SubHeader
          title={
            <>
              <SearchIcon size={24} /> 검색 결과
            </>
          }
          showBackButton={true}
        />

        <main className={styles.searchMain}>
          <div className={styles.resultHeader}>
            <h2 className={styles.resultTitle}>
              {query ? (
                <>
                  "<span className={styles.searchTerm}>{query}</span>" 검색 결과
                </>
              ) : (
                "검색어를 입력하세요"
              )}
            </h2>
            {!isLoading && query && (
              <p className={styles.resultCount}>
                총 <strong>{seriesList.length}</strong>개의 시리즈를 찾았습니다.
              </p>
            )}
          </div>

          {isLoading ? (
            <div className={styles.loadingContainer}>
              <div className={styles.loadingSpinner} />
              <p>검색 중...</p>
            </div>
          ) : query && seriesList.length === 0 ? (
            <div className={styles.emptyState}>
              <AlertCircle
                size={48}
                className={styles.emptyIcon}
              />
              <p>검색 결과가 없습니다.</p>
              <p style={{ fontSize: "0.9rem", opacity: 0.7 }}>다른 검색어를 입력해 보세요.</p>
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
