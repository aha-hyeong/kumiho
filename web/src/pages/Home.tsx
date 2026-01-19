import { useEffect, useState, type JSX } from "react";
import { BookOpen, Clock, Heart } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { libraryAPI, progressAPI, settingsAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import type { Series } from "../types/series";
import styles from "./Home.module.css";

interface RecentProgress {
  id: string;
  series_id: string;
  series_title: string;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  updated_at: string;
  thumbnail_url?: string;
  volume_id?: string;
  volume_number?: number;
  volume_title?: string;
  chapter_id?: string;
  chapter_number?: number;
  chapter_title?: string;
}

export function HomePage() {
  const { libraries, fetchLibraries } = useLibraryStore();
  const [recentProgress, setRecentProgress] = useState<RecentProgress[]>([]);
  const [updatedSeries, setUpdatedSeries] = useState<Series[]>([]);
  const [likedSeries, setLikedSeries] = useState<Series[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "liked", "updated"]);
  const [isLoading, setIsLoading] = useState(true);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      // 라이브러리 목록도 전역 스토어에서 갱신
      await fetchLibraries();

      // 병렬로 데이터 요청
      const [progressRes, settingsRes, likedRes] = await Promise.all([
        progressAPI.getRecent(10),
        settingsAPI.getAll(),
        libraryAPI.getSeries("system-likes"),
      ]);

      setRecentProgress(progressRes.data.recent_progress || []);
      setLikedSeries((likedRes.data.series || []) as Series[]);

      if (settingsRes.data.home_layout_order) {
        const order = settingsRes.data.home_layout_order;
        if (order === "swapped") {
          setSectionOrder(["updated", "continue", "liked"]);
        } else if (order === "default") {
          setSectionOrder(["continue", "liked", "updated"]);
        } else {
          // 쉼표로 구분된 섹션 ID 목록 (예: "continue,liked,updated")
          const parts = order.split(",").filter((s) => s);
          if (parts.length > 0) setSectionOrder(parts);
        }
      }

      // 라이브러리 목록이 업데이트된 후, 최신 상태를 스토어에서 직접 가져옴
      const currentLibraries = useLibraryStore.getState().libraries;

      // SYSTEM 라이브러리(좋아요 등)는 제외하고 실제 로컬 라이브러리만 순회
      const localLibraries = currentLibraries.filter((lib) => lib.type !== "SYSTEM");

      if (localLibraries.length > 0) {
        const allSeriesPromises = localLibraries.map((lib) => libraryAPI.getSeries(lib.id));
        const seriesResponses = await Promise.all(allSeriesPromises);

        const allSeries: Series[] = [];
        seriesResponses.forEach((res) => {
          const series = (res.data.series || []) as Series[];
          allSeries.push(...series);
        });

        // updated_at 기준 최신순 정렬
        allSeries.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
        setUpdatedSeries(allSeries);
      } else {
        setUpdatedSeries([]);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.homeContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  // 라이브러리가 없는 경우
  if (libraries.length === 0) {
    return (
      <div className={`${styles.homeContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />

        <main className={styles.homeMain}>
          <div className={styles.emptyLibraryState}>
            <img
              src="/Empty-library.png"
              alt="빈 라이브러리"
              className={styles.emptyLibraryImage}
            />
            <h2>라이브러리가 비어있어요</h2>
            <p className={styles.emptyLibraryHint}>설정에서 라이브러리를 먼저 추가해 보세요!</p>
          </div>
        </main>
      </div>
    );
  }

  const ContinueReadingSection = (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <BookOpen size={20} /> 계속 읽기
      </h2>
      {recentProgress.length === 0 ? (
        <div className={styles.emptySection}>
          <p>아직 읽은 책이 없어요</p>
          <p className={styles.emptyHint}>라이브러리에서 책을 선택해서 읽어보세요!</p>
        </div>
      ) : (
        <div className={styles.seriesGrid}>
          {recentProgress.map((progress) => {
            // RecentProgress를 Series 객체로 변환
            const seriesData: Series = {
              id: progress.series_id,
              title: progress.series_title,
              library_id: "", // 필수지만 카드에서 사용 안 함
              created_at: "", // 필수지만 카드에서 사용 안 함
              updated_at: progress.updated_at,
              thumbnail_url: progress.thumbnail_url,
            };

            // 진행도 텍스트 생성
            // 1. 권 정보가 있으면 "X권"만 표시 (화 정보 제외)
            // 2. 권 정보가 없고 챕터만 있으면 "X화" 표시
            // 3. 둘 다 없으면 "X페이지" 표시
            let subtitle = "";
            if (progress.volume_id) {
              subtitle = `${progress.volume_number}권`;
            } else if (progress.chapter_id) {
              subtitle = `${progress.chapter_number}화`;
            } else {
              subtitle = `${progress.current_page}페이지`;
            }

            return (
              <SeriesCard
                key={progress.id}
                item={seriesData}
                type="series"
                customSubtitle={subtitle}
                progress={progress.progress_percent}
                chapterId={progress.chapter_id}
                volumeId={progress.volume_id}
                onStatusChange={loadData}
              />
            );
          })}
        </div>
      )}
    </section>
  );

  const LikedSeriesSection = (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Heart
          size={20}
          fill="#fc8181"
          color="#fc8181"
        />{" "}
        좋아요한 시리즈
      </h2>
      {likedSeries.length === 0 ? (
        <div className={styles.emptySection}>
          <p>아직 좋아요한 시리즈가 없어요</p>
        </div>
      ) : (
        <div className={styles.seriesGrid}>
          {likedSeries.map((series) => (
            <SeriesCard
              key={series.id}
              item={series}
              type="series"
              progressStyle="overlay"
            />
          ))}
        </div>
      )}
    </section>
  );

  const UpdatedSeriesSection = (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Clock size={20} /> 업데이트된 시리즈
      </h2>
      {updatedSeries.length === 0 ? (
        <div className={styles.emptySection}>
          <p>최근 업데이트된 시리즈가 없어요</p>
        </div>
      ) : (
        <div className={styles.seriesGrid}>
          {updatedSeries.map((series) => (
            <SeriesCard
              key={series.id}
              item={series}
              type="series"
              progressStyle="overlay"
            />
          ))}
        </div>
      )}
    </section>
  );

  const sectionsMap: Record<string, JSX.Element> = {
    continue: ContinueReadingSection,
    liked: LikedSeriesSection,
    updated: UpdatedSeriesSection,
  };

  const systemLibrary = libraries.find((l) => l.type === "SYSTEM");

  // 라이브러리가 있는 경우
  return (
    <div className={`${styles.homeContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className={styles.homeMain}>
        {sectionOrder.map((sectionId) => {
          const SectionComponent = sectionsMap[sectionId];
          if (!SectionComponent) return null;

          // Liked Series visibility check
          if (sectionId === "liked") {
            // systemLibrary가 없거나 is_visible이 false인 경우 섹션 숨김
            if (!systemLibrary || systemLibrary.is_visible === false) return null;
          }
          return <div key={sectionId}>{SectionComponent}</div>;
        })}
      </main>
    </div>
  );
}
