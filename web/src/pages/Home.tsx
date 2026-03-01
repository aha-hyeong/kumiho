import { useEffect, useState, useCallback, useRef, type JSX } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Clock, Heart } from "lucide-react";
import { useLibraryStore } from "../stores/libraryStore";
import { chapterAPI, libraryAPI, progressAPI, seriesAPI, settingAPI, volumeAPI } from "../api/client";
import { Header } from "../components/headers/Header";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import { HorizontalDragScroll } from "../components/common/HorizontalDragScroll";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import type { Series } from "../types/series";
import { parseSupportedExtension, resolveExtensionFromVolumePaths } from "../utils/extension";
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
  volume_chapter_count?: number;
  chapter_id?: string;
  chapter_number?: number;
  chapter_title?: string;
  path?: string;
  chapter_path?: string;
  volume_path?: string;
}

export function HomePage() {
  const { t } = useTranslation();
  const { libraries, fetchLibraries, refreshKey } = useLibraryStore();
  const [recentProgress, setRecentProgress] = useState<RecentProgress[]>([]);
  const [recentProgressExtensionMap, setRecentProgressExtensionMap] = useState<Record<string, string>>({});
  const [homeSeriesExtensionMap, setHomeSeriesExtensionMap] = useState<Record<string, string>>({});
  const [updatedSeries, setUpdatedSeries] = useState<Series[]>([]);
  const [likedSeries, setLikedSeries] = useState<Series[]>([]);
  const [sectionOrder, setSectionOrder] = useState<string[]>(["continue", "liked", "updated"]);
  const [isLoading, setIsLoading] = useState(true);
  const chapterExtensionCacheRef = useRef<Map<string, string | null>>(new Map());
  const volumeExtensionCacheRef = useRef<Map<string, string | null>>(new Map());
  const seriesExtensionCacheRef = useRef<Map<string, string>>(new Map());

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      // 라이브러리 목록도 전역 스토어에서 갱신
      await fetchLibraries();

      // 병렬로 데이터 요청
      const [progressRes, settingsRes, likedRes] = await Promise.all([
        progressAPI.getRecent(10),
        settingAPI.list(),
        libraryAPI.getSeries("system-likes"),
      ]);

      const recentList: RecentProgress[] = progressRes.data.recent_progress || [];
      setRecentProgress(recentList);
      const likedSeriesList = (likedRes.data.series || []) as Series[];
      setLikedSeries(likedSeriesList);

      const resolvedRecentExtensions = await Promise.all(
        recentList.map(async (progress) => {
          const directExt = parseSupportedExtension(progress.path || progress.chapter_path || progress.volume_path);
          if (directExt) return [progress.id, directExt] as const;

          if (progress.chapter_id) {
            if (!chapterExtensionCacheRef.current.has(progress.chapter_id)) {
              try {
                const chapterRes = await chapterAPI.get(progress.chapter_id);
                chapterExtensionCacheRef.current.set(
                  progress.chapter_id,
                  parseSupportedExtension((chapterRes.data as { path?: string } | undefined)?.path),
                );
              } catch {
                chapterExtensionCacheRef.current.set(progress.chapter_id, null);
              }
            }
            const chapterExt = chapterExtensionCacheRef.current.get(progress.chapter_id);
            if (chapterExt) return [progress.id, chapterExt] as const;
          }

          if (progress.volume_id) {
            if (!volumeExtensionCacheRef.current.has(progress.volume_id)) {
              try {
                const volumeRes = await volumeAPI.get(progress.volume_id);
                volumeExtensionCacheRef.current.set(
                  progress.volume_id,
                  parseSupportedExtension((volumeRes.data as { path?: string } | undefined)?.path),
                );
              } catch {
                volumeExtensionCacheRef.current.set(progress.volume_id, null);
              }
            }
            const volumeExt = volumeExtensionCacheRef.current.get(progress.volume_id);
            if (volumeExt) return [progress.id, volumeExt] as const;
          }

          return [progress.id, ""] as const;
        }),
      );

      const extensionMap: Record<string, string> = {};
      resolvedRecentExtensions.forEach(([progressId, ext]) => {
        if (ext) extensionMap[progressId] = ext;
      });
      setRecentProgressExtensionMap(extensionMap);

      const resolveSeriesExtensionMap = async (seriesList: Series[]) => {
        const missingSeries = seriesList.filter((series) => !seriesExtensionCacheRef.current.has(series.id));
        const concurrency = 4;
        let cursor = 0;

        const workers = Array.from({ length: Math.min(concurrency, missingSeries.length) }, async () => {
          while (cursor < missingSeries.length) {
            const index = cursor;
            cursor += 1;
            const series = missingSeries[index];
            try {
              const volumesRes = await seriesAPI.getVolumes(series.id);
              const volumes = Array.isArray(volumesRes.data?.volumes) ? volumesRes.data.volumes : [];
              const badge = resolveExtensionFromVolumePaths(
                series.path,
                volumes.map((volume: { path?: string }) => volume.path),
              );
              seriesExtensionCacheRef.current.set(series.id, badge);
            } catch (error) {
              console.warn(`Failed to resolve extension for home series ${series.id}:`, error);
              seriesExtensionCacheRef.current.set(series.id, "");
            }
          }
        });
        await Promise.all(workers);

        const nextMap: Record<string, string> = {};
        seriesList.forEach((series) => {
          const ext = seriesExtensionCacheRef.current.get(series.id) ?? "";
          if (ext) nextMap[series.id] = ext;
        });
        setHomeSeriesExtensionMap(nextMap);
      };

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

        // updated_at 기준 최신순 정렬
        allSeries.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

        // 기간 필터링 적용
        const filteredSeries = allSeries.filter((series) => {
          const updatedDate = new Date(series.updated_at);
          return updatedDate >= cutoffDate;
        });

        setUpdatedSeries(filteredSeries);
        const uniqueSeriesMap = new Map<string, Series>();
        [...likedSeriesList, ...filteredSeries].forEach((series) => {
          uniqueSeriesMap.set(series.id, series);
        });
        await resolveSeriesExtensionMap(Array.from(uniqueSeriesMap.values()));
      } else {
        setUpdatedSeries([]);
        await resolveSeriesExtensionMap(likedSeriesList);
      }
    } catch (error) {
      console.error("Failed to load data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [fetchLibraries]);

  useEffect(() => {
    loadData();
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
            if (progress.volume_id && progress.chapter_id) {
              // 볼륨 내 챕터가 1개뿐인 경우 볼륨 정보만 표시
              if (progress.volume_chapter_count === 1) {
                subtitle = t("series.unit.volume", { count: progress.volume_number });
              } else {
                subtitle = `${t("series.unit.volume", { count: progress.volume_number })} - ${t("series.unit.chapter", { count: progress.chapter_number })}`;
              }
            } else if (progress.volume_id) {
              subtitle = t("series.unit.volume", { count: progress.volume_number });
            } else if (progress.chapter_id) {
              subtitle = t("series.unit.chapter", { count: progress.chapter_number });
            } else {
              subtitle = t("series.unit.page", { count: progress.current_page });
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
                showExtensionBadge
                extensionBadgePlacement="meta"
                extensionBadgeText={recentProgressExtensionMap[progress.id]}
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
