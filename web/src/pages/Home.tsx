import { useEffect, useState, useCallback, useRef, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Clock, Heart } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { progressAPI, seriesAPI, settingAPI } from "../api/client";
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
  series_is_bookmarked?: boolean; // UI 상의 좋아요 여부 (DB의 is_bookmarked)
  series_display_title?: string;
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
  const [librariesReady, setLibrariesReady] = useState(false);
  const [progressLoading, setProgressLoading] = useState(true);
  const [likedLoading, setLikedLoading] = useState(true);
  const [updatedLoading, setUpdatedLoading] = useState(true);
  const chapterExtensionCacheRef = useRef<Map<string, SupportedExtension | null>>(new Map());
  const volumeExtensionCacheRef = useRef<Map<string, SupportedExtension | null>>(new Map());
  const seriesExtensionCacheRef = useRef<Map<string, ExtensionBadge | "">>(new Map());
  const loadSequenceRef = useRef(0);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isFirstMount = useRef(true);

  const loadData = useCallback(
    (options: { isInitial?: boolean } = {}) => {
      const currentLoad = ++loadSequenceRef.current;
      const current = () => currentLoad === loadSequenceRef.current;
      setRecentProgressExtensionMap({});
      setHomeSeriesExtensionMap({});
      if (options.isInitial) {
        setProgressLoading(true);
        setLikedLoading(true);
        setUpdatedLoading(true);
      }

      // Libraries control the empty-library state, not when the card requests start.
      void fetchLibraries(options.isInitial).then(() => {
        if (current()) setLibrariesReady(true);
      }).catch((error) => {
        console.error("Failed to load libraries:", error);
        if (current()) setLibrariesReady(true);
      });

      void progressAPI.getRecent(10).then((res) => {
        if (!current()) return;
        const recentList: RecentProgress[] = res.data.recent_progress || [];
        setRecentProgress(recentList);
        const recentExtMap: Partial<Record<string, ExtensionBadge>> = {};
        recentList.forEach((progress) => {
          const ext = parseSupportedExtension(progress.chapter_path || progress.volume_path || progress.series_path);
          if (ext) recentExtMap[progress.id] = ext;
        });
        setRecentProgressExtensionMap(recentExtMap);
      }).catch((error) => console.error("Failed to load recent progress:", error))
        .finally(() => { if (current()) setProgressLoading(false); });

      void settingAPI.list().then((settings) => {
        if (!current() || !settings.home_layout_order) return;
        const order = settings.home_layout_order;
        if (order === "swapped") setSectionOrder(["updated", "continue", "liked"]);
        else if (order === "default") setSectionOrder(["continue", "liked", "updated"]);
        else {
          const parts = order.split(",").filter((s: string) => s);
          if (parts.length > 0) setSectionOrder(parts);
        }
      }).catch((error) => console.error("Failed to load Home settings:", error));

      const loadSeries = (section: "updated" | "liked") => {
        void seriesAPI.getHome(section).then((res) => {
          if (!current()) return;
          const series = section === "updated" ? res.data.updated_series || [] : res.data.liked_series || [];
          if (section === "updated") setUpdatedSeries(series);
          else setLikedSeries(series);
          // Badge lookup is deliberately deferred until the cards are visible.
          const ids = series.map((s) => s.id);
          if (ids.length === 0) return;
          void seriesAPI.getExtensionsBatch(ids).then((extRes) => {
            if (!current()) return;
            const extensions = extRes.data.extensions || {};
            const nextMap: Partial<Record<string, ExtensionBadge>> = {};
            series.forEach((s) => {
              const ext = extensions[s.id];
              if (ext) {
                const badge = parseSupportedExtension(ext);
                if (badge) nextMap[s.id] = badge;
              }
            });
            setHomeSeriesExtensionMap((previous) => ({ ...previous, ...nextMap }));
          }).catch((error) => console.warn("Failed to fetch series extensions in batch:", error));
        }).catch((error) => console.error(`Failed to load Home ${section} series:`, error))
          .finally(() => {
            if (!current()) return;
            if (section === "updated") setUpdatedLoading(false);
            else setLikedLoading(false);
          });
      };
      loadSeries("updated");
      loadSeries("liked");
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


  // 실제 로컬 라이브러리만 확인 (SYSTEM 타입 제외)
  const localLibraries = libraries.filter((lib) => lib.type !== "SYSTEM");

  // 라이브러리가 없는 경우
  if (librariesReady && localLibraries.length === 0) {
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
      {progressLoading && recentProgress.length === 0 ? (
        <LoadingSpinner className={styles.sectionLoading} />
      ) : recentProgress.length === 0 ? (
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
                  title: progress.volume_title || progress.series_display_title || progress.series_title,
                  thumbnail_url: progress.thumbnail_url,
                  unit: progress.volume_unit,
                  volume_number: progress.volume_number || 0,
                  path: progress.volume_path || progress.path || "",
                  chapter_count: progress.volume_chapter_count,
                  created_at: progress.updated_at,
                  has_audio: progress.has_audio,
                  library_type: progress.library_type,
                  is_bookmarked: progress.series_is_bookmarked ?? false,
                }
              : {
                  id: progress.series_id,
                  title: progress.series_title,
                  display_title: progress.series_display_title,
                  thumbnail_url: progress.thumbnail_url,
                  path: progress.series_path || progress.path || "",
                  updated_at: progress.updated_at,
                  library_id: "",
                  created_at: progress.updated_at,
                  has_audio: progress.has_audio,
                  library_type: progress.library_type,
                  is_bookmarked: progress.series_is_bookmarked,
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
      {likedLoading && likedSeries.length === 0 ? (
        <LoadingSpinner className={styles.sectionLoading} />
      ) : likedSeries.length === 0 ? (
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
      {updatedLoading && updatedSeries.length === 0 ? (
        <LoadingSpinner className={styles.sectionLoading} />
      ) : updatedSeries.length === 0 ? (
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
