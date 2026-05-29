import { useEffect, useState, useCallback, useRef, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Clock, Heart } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { libraryAPI, progressAPI, seriesAPI, settingAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { HorizontalDragScroll } from "../components/common/HorizontalDragScroll";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import type { Series, Volume, LibraryType } from "../types/series";
import { parseSupportedExtension, type ExtensionBadge, type SupportedExtension } from "../utils/extension";
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
  volume_unit?: string;
  volume_title?: string;
  volume_chapter_count?: number;
  chapter_id?: string;
  chapter_number?: number;
  chapter_title?: string;
  has_audio?: boolean;
  library_type?: LibraryType;
  path?: string;
  chapter_path?: string;
  volume_path?: string;
  series_path?: string;
}

export function HomePage() {
  const { t } = useTranslation();
  const { libraries, fetchLibraries, refreshKey } = useLibraryStore();
  const [recentProgress, setRecentProgress] = useState<RecentProgress[]>([]);
  const [recentProgressExtensionMap, setRecentProgressExtensionMap] = useState<Partial<Record<string, ExtensionBadge>>>(
    {},
  );
  const [homeSeriesExtensionMap, setHomeSeriesExtensionMap] = useState<Partial<Record<string, ExtensionBadge>>>({});
  const [updatedSeries, setUpdatedSeries] = useState<Series[]>([]);
  const [likedSeries, setLikedSeries] = useState<Series[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "liked", "updated"]);
  const [isLoading, setIsLoading] = useState(true);
  const chapterExtensionCacheRef = useRef<Map<string, SupportedExtension | null>>(new Map());
  const volumeExtensionCacheRef = useRef<Map<string, SupportedExtension | null>>(new Map());
  const seriesExtensionCacheRef = useRef<Map<string, ExtensionBadge | "">>(new Map());
  const loadSequenceRef = useRef(0);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isFirstMount = useRef(true);

  const loadData = useCallback(
    async (options: { isInitial?: boolean } = {}) => {
      const currentLoad = ++loadSequenceRef.current;
      if (options.isInitial) {
        setIsLoading(true);
      }
      setRecentProgressExtensionMap({});
      setHomeSeriesExtensionMap({});

      try {
        // 라이브러리 목록도 전역 스토어에서 갱신
        await fetchLibraries(options.isInitial);

        // 병렬로 데이터 요청
        const [progressRes, settingsRes, likedResOrNull] = await Promise.all([
          progressAPI.getRecent(10),
          settingAPI.list(),
          libraryAPI.getSeries("system-likes").catch((error) => {
            console.warn("Failed to load liked series library:", error);
            return null;
          }),
        ]);
        if (currentLoad !== loadSequenceRef.current) return;

        const recentList: RecentProgress[] = progressRes.data.recent_progress || [];
        setRecentProgress(recentList);

        // 1. 최근 읽은 목록 확장자 해결 (백엔드에서 강화된 경로 정보 활용 - N+1 제거)
        const recentExtMap: Partial<Record<string, ExtensionBadge>> = {};
        recentList.forEach((progress) => {
          const ext = parseSupportedExtension(progress.chapter_path || progress.volume_path || progress.series_path);
          if (ext) recentExtMap[progress.id] = ext;
        });
        setRecentProgressExtensionMap(recentExtMap);

        const likedSeriesList = likedResOrNull ? ((likedResOrNull.data.series || []) as Series[]) : [];
        setLikedSeries(likedSeriesList);

        if (settingsRes.home_layout_order) {
          const order = settingsRes.home_layout_order;
          if (order === "swapped") {
            setSectionOrder(["updated", "continue", "liked"]);
          } else if (order === "default") {
            setSectionOrder(["continue", "liked", "updated"]);
          } else {
            // 쉼표로 구분된 섹션 ID 목록 (예: "continue,liked,updated")
            const parts = order.split(",").filter((s: string) => s);
            if (parts.length > 0) setSectionOrder(parts);
          }
        }

        // 라이브러리 목록이 업데이트된 후, 최신 상태를 스토어에서 직접 가져옴
        const currentLibraries = useLibraryStore.getState().libraries;

        // SYSTEM 라이브러리(좋아요 등)는 제외하고 실제 로컬 라이브러리만 순회
        const localLibraries = currentLibraries.filter((lib) => lib.type !== "SYSTEM");
        let seriesForExtension: Series[] = likedSeriesList;

        if (localLibraries.length > 0) {
          const allSeriesPromises = localLibraries.map((lib) => libraryAPI.getSeries(lib.id));
          const seriesResponses = await Promise.all(allSeriesPromises);

          const allSeries: Series[] = [];
          seriesResponses.forEach((res) => {
            const series = (res.data.series || []) as Series[];
            allSeries.push(...series);
          });

          // updated_series_period 설정 적용 (기본값 7일)
          const rawPeriod = settingsRes.updated_series_period;
          const parsedPeriod = rawPeriod ? parseInt(rawPeriod, 10) : NaN;
          const periodDays = !Number.isNaN(parsedPeriod) && parsedPeriod > 0 ? parsedPeriod : 7;

          const cutoffDate = new Date();
          cutoffDate.setDate(cutoffDate.getDate() - periodDays);

          // last_content_updated_at 기준 최신순 정렬 (없으면 updated_at fallback)
          allSeries.sort((a, b) => {
            const aDate = new Date(a.last_content_updated_at || a.updated_at);
            const bDate = new Date(b.last_content_updated_at || b.updated_at);
            return bDate.getTime() - aDate.getTime();
          });

          // 기간 필터링 적용
          const filteredSeries = allSeries.filter((series) => {
            const updatedDate = new Date(series.last_content_updated_at || series.updated_at);
            return updatedDate >= cutoffDate;
          });

          setUpdatedSeries(filteredSeries);
          const uniqueSeriesMap = new Map<string, Series>();
          [...likedSeriesList, ...filteredSeries].forEach((series) => {
            uniqueSeriesMap.set(series.id, series);
          });
          seriesForExtension = Array.from(uniqueSeriesMap.values());
        } else {
          setUpdatedSeries([]);
        }

        if (currentLoad !== loadSequenceRef.current) return;
        setIsLoading(false);

        // 2. 홈 시리즈 확장자 해결 (배치 API 활용 - N+1 제거)
        void (async () => {
          const seriesIds = seriesForExtension.map((s) => s.id);
          if (seriesIds.length === 0) return;

          try {
            const extRes = await seriesAPI.getExtensionsBatch(seriesIds);
            const extensions = extRes.data.extensions || {};

            if (currentLoad !== loadSequenceRef.current) return;

            const nextMap: Partial<Record<string, ExtensionBadge>> = {};
            seriesForExtension.forEach((series) => {
              const ext = extensions[series.id];
              if (ext) {
                const badge = parseSupportedExtension(ext);
                if (badge) nextMap[series.id] = badge;
              }
            });
            setHomeSeriesExtensionMap(nextMap);
          } catch (error) {
            console.warn("Failed to fetch series extensions in batch:", error);
          }
        })();
      } catch (error) {
        console.error("Failed to load data:", error);
        if (currentLoad === loadSequenceRef.current) {
          setIsLoading(false);
        }
      }
    },
    [fetchLibraries],
  );

  useEffect(() => {
    chapterExtensionCacheRef.current.clear();
    volumeExtensionCacheRef.current.clear();
    seriesExtensionCacheRef.current.clear();
    const initial = isFirstMount.current;
    isFirstMount.current = false;
    const timer = window.setTimeout(() => {
      void loadData({ isInitial: initial });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadSequenceRef.current += 1;
    };
  }, [refreshKey, loadData]);

  if (isLoading) {
    return (
      <div className={styles.homeContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  // 실제 로컬 라이브러리만 확인 (SYSTEM 타입 제외)
  const localLibraries = libraries.filter((lib) => lib.type !== "SYSTEM");

  // 라이브러리가 없는 경우
  if (localLibraries.length === 0) {
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
            <h2>{t("home.empty_library.title")}</h2>
            <p className={styles.emptyLibraryHint}>{t("home.empty_library.desc")}</p>
          </div>
        </main>
      </div>
    );
  }

  const ContinueReadingSection = (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <BookOpen size={20} /> {t("home.sections.continue_reading.title")}
      </h2>
      {recentProgress.length === 0 ? (
        <div className={styles.emptySection}>
          <p>{t("home.sections.continue_reading.empty")}</p>
          <p className={styles.emptyHint}>{t("home.sections.continue_reading.empty_hint")}</p>
        </div>
      ) : (
        <HorizontalDragScroll className={styles.seriesGrid}>
          {recentProgress.map((progress) => {
            // RecentProgress를 Series/Volume 객체로 변환
            const isVolume = !!progress.volume_id;

            // SeriesCardProps.item이 Series | Volume이므로 각각의 원본 형태에 맞게 구성
            const item: Series | Volume = isVolume
              ? {
                  id: progress.volume_id!,
                  series_id: progress.series_id,
                  title: progress.volume_title || progress.series_title,
                  thumbnail_url: progress.thumbnail_url,
                  unit: progress.volume_unit,
                  volume_number: progress.volume_number || 0,
                  path: progress.volume_path || progress.path || "",
                  chapter_count: progress.volume_chapter_count,
                  created_at: progress.updated_at,
                  has_audio: progress.has_audio,
                  library_type: progress.library_type,
                }
              : {
                  id: progress.series_id,
                  title: progress.series_title,
                  thumbnail_url: progress.thumbnail_url,
                  path: progress.series_path || progress.path || "",
                  updated_at: progress.updated_at,
                  library_id: "",
                  created_at: progress.updated_at,
                  has_audio: progress.has_audio,
                  library_type: progress.library_type,
                };

            // 진행도 텍스트 생성
            // 1. volume_unit이 chapter면 "X화" 기준으로 표시
            // 2. volume/chapter가 함께 있으면 상황에 따라 "X권" 또는 "X권 - Y화" 표시
            // 3. 챕터만 있으면 "X화", 둘 다 없으면 "X페이지" 표시
            let subtitle = "";
            if (progress.volume_id && progress.chapter_id) {
              if (progress.volume_unit === "chapter") {
                subtitle = t("series.unit.chapter", { count: progress.volume_number });
              } else if (progress.volume_chapter_count === 1) {
                // 볼륨 내 챕터가 1개뿐인 경우 볼륨 정보만 표시
                subtitle = t("series.unit.volume", { count: progress.volume_number });
              } else {
                subtitle = `${t("series.unit.volume", { count: progress.volume_number })} - ${t("series.unit.chapter", { count: progress.chapter_number })}`;
              }
            } else if (progress.volume_id) {
              subtitle =
                progress.volume_unit === "chapter"
                  ? t("series.unit.chapter", { count: progress.volume_number })
                  : t("series.unit.volume", { count: progress.volume_number });
            } else if (progress.chapter_id) {
              subtitle = t("series.unit.chapter", { count: progress.chapter_number });
            } else {
              subtitle = t("series.unit.page", { count: progress.current_page });
            }

            return (
              <SeriesCard
                key={progress.id}
                item={item}
                type={progress.volume_id ? "volume" : "series"}
                customSubtitle={subtitle}
                progress={progress.progress_percent}
                chapterId={progress.chapter_id}
                volumeId={progress.volume_id}
                navigateTo={`/series/${progress.series_id}`}
                onStatusChange={loadData}
                showExtensionBadge
                extensionBadgeText={recentProgressExtensionMap[progress.id]}
                hideMarkPrevious
              />
            );
          })}
        </HorizontalDragScroll>
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
        {t("home.sections.liked.title")}
      </h2>
      {likedSeries.length === 0 ? (
        <div className={styles.emptySection}>
          <p>{t("home.sections.liked.empty")}</p>
        </div>
      ) : (
        <HorizontalDragScroll className={styles.seriesGrid}>
          {likedSeries.map((series) => (
            <SeriesCard
              key={series.id}
              item={series}
              type="series"
              progressStyle="overlay"
              onStatusChange={loadData}
              showExtensionBadge
              extensionBadgeText={homeSeriesExtensionMap[series.id]}
            />
          ))}
        </HorizontalDragScroll>
      )}
    </section>
  );

  const UpdatedSeriesSection = (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>
        <Clock size={20} /> {t("home.sections.updated.title")}
      </h2>
      {updatedSeries.length === 0 ? (
        <div className={styles.emptySection}>
          <p>{t("home.sections.updated.empty")}</p>
        </div>
      ) : (
        <HorizontalDragScroll className={styles.seriesGrid}>
          {updatedSeries.map((series) => (
            <SeriesCard
              key={series.id}
              item={series}
              type="series"
              progressStyle="overlay"
              onStatusChange={loadData}
              showExtensionBadge
              extensionBadgeText={homeSeriesExtensionMap[series.id]}
            />
          ))}
        </HorizontalDragScroll>
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
