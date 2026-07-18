import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import { Folder } from "lucide-react";
import { shallow } from "zustand/shallow";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { api, seriesAPI, volumeAPI, downloadAPI } from "../api/client";
import { initiateDownload } from "../utils/download";
import { useAuthStore } from "../stores/authStore";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { buildViewerRouteState } from "../utils/viewerRouteState";
import { rememberReturnFocus, takeReturnFocus } from "../utils/returnFocus";
import { prefersReducedMotion } from "../utils/reducedMotion";
import { findMissingNumberRanges } from "../utils/missingNumbers";
import styles from "./Series.module.css";

import type { Series, Volume, Library, ReadingProgress, SeriesProgressSummary, Chapter, SeriesCharacter } from "../types/series";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function SeriesPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = `${location.pathname}${location.search}`;
  const [series, setSeries] = useState<Series | null>(null);
  const [characters, setCharacters] = useState<SeriesCharacter[]>([]);

  const refreshCharacters = useCallback(() => {
    if (!id) return;
    seriesAPI.getCharacters(id).then((res) => {
      setCharacters(res.characters || []);
    }).catch(() => setCharacters([]));
  }, [id]);

  const handleUpdate = (updated: Series | Volume) => {
    // 서재 페이지에서는 Series만 다룸
    if (!("volume_number" in updated)) {
      const updatedSeries = updated as Series;
      setSeries(updatedSeries);
      // 메타데이터 업데이트 시 등장인물도 재조회
      refreshCharacters();
      // 오디오 플레이어 스토어 동기화
      const audioStore = useAudioPlayerStore.getState();
      if (audioStore.currentSeries?.id === updatedSeries.id) {
        audioStore.updateCurrentSeries(updatedSeries);
      }
    }
  };
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const volumeCardRefs = useRef<Record<string, HTMLDivElement>>({});
  const [library, setLibrary] = useState<Library | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>(undefined);
  const [summary, setSummary] = useState<SeriesProgressSummary | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 알림 모달 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    message: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  const user = useAuthStore((state) => state.user);
  const canDownload = user?.role === "MASTER" || user?.can_download;
  const seriesTitle = series?.display_title || series?.title || "";
  const missingNumberRanges = useMemo(
    () => findMissingNumberRanges(volumes.map((volume) => volume.volume_number)),
    [volumes],
  );
  const preferPercentLabel =
    volumes.length > 0 &&
    volumes.every((volume) => {
      const lowerPath = String(volume.path || "").toLowerCase();
      return lowerPath.endsWith(".txt") || lowerPath.endsWith(".epub");
    });

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 볼륨 상세 페이지로 이동
  const openVolume = (volume: Volume) => {
    navigate(`/volumes/${volume.id}`);
  };
  const handleDownloadSeries = () => {
    if (!series) return;
    setAlertModal({
      isOpen: true,
      type: "info",
      message: t("series.alert.download_series_confirm", { title: series.display_title || series.title }),
      onConfirm: () => {
        try {
          const url = downloadAPI.getSeriesUrl(series.id);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || t("series.alert.download_failed"), "error");
        }
      },
    });
  };

  const handleDownloadVolume = (volume: Volume) => {
    setAlertModal({
      isOpen: true,
      type: "info",
      message: t("series.alert.download_volume_confirm", { title: volume.title }),
      onConfirm: () => {
        try {
          const url = downloadAPI.getVolumeUrl(volume.id);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || t("series.alert.download_failed"), "error");
        }
      },
    });
  };

  const loadData = useCallback(async () => {
    try {
      // 1. 핵심 데이터(시리즈, 볼륨, 진행도) 병렬 페칭
      const [seriesRes, volumesRes, progressRes] = await Promise.all([
        api.get(`/series/${id}`),
        api.get(`/series/${id}/volumes?parent_id=root`),
        api.get(`/series/${id}/progress`).catch(() => ({ data: null })),
      ]);

      const seriesData = seriesRes.data;
      setSeries(seriesData);

      // 볼륨 목록 정밀화 및 설정
      const rawVolumes = Array.isArray(volumesRes.data?.volumes) ? volumesRes.data.volumes : [];
      const normalizedVolumes: Volume[] = rawVolumes.map((raw: Volume & { is_completed?: boolean }) => ({
        ...raw,
        is_completed: raw.is_completed === true,
      }));
      setVolumes(normalizedVolumes);

      // 진행도 설정
      if (progressRes.data) {
        setProgress(progressRes.data.progress ?? undefined);
        setSummary(progressRes.data.summary ?? undefined);
      } else {
        setProgress(undefined);
        setSummary(undefined);
      }

      // 2. 등장인물 정보 비동기 로드
      refreshCharacters();

      // 3. 라이브러리 정보는 시리즈 데이터 로드 후 비동기로 처리 (병목 방지)
      if (seriesData.library_id) {
        api
          .get(`/libraries/${seriesData.library_id}`)
          .then((libRes) => {
            setLibrary(libRes.data);
          })
          .catch((err) => console.error("Failed to load library:", err));
      }
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setIsLoading(false);
    }
  }, [id, refreshCharacters]);

  useEffect(() => {
    if (id) loadData();
  }, [id, loadData]);

  useEffect(() => {
    if (!id || isLoading) return;

    // App의 전역 scroll-to-top effect가 끝난 다음 프레임에 복귀 스크롤을 적용한다.
    // StrictMode의 effect 재실행에서도 취소된 프레임은 storage를 소비하지 않는다.
    const frameId = window.requestAnimationFrame(() => {
      const volumeId = takeReturnFocus("series", id);
      const target = volumeId ? volumeCardRefs.current[volumeId] : null;
      if (!target) return;

      target.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [id, isLoading, volumes]);

  // 시리즈 데이터가 변경될 때마다 오디오 플레이어 스토어 동기화
  useEffect(() => {
    if (series) {
      const audioStore = useAudioPlayerStore.getState();
      if (audioStore.currentSeries?.id === series.id) {
        audioStore.updateCurrentSeries(series);
      }
    }
  }, [series]);

  // 오디오 재생 중이면 스토어의 currentTime을 구독하여 summary를 실시간 갱신
  const baseListenedRef = useRef<number | null>(null);
  const baseChapterTimeRef = useRef<number>(0);
  const currentChapterIdRef = useRef<string | null>(null);
  const lastChapterTimeRef = useRef<number>(0);
  const wasPlayingRef = useRef(false);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  useEffect(() => {
    if (!id || !series) return;
    const isAudioSeries = series.library_type === "audiobook";
    if (!isAudioSeries) return;

    let lastUpdate = 0;
    let lastVolumeUpdate = 0;
    let lastVolumeId: string | null = null;
    const unsub = useAudioPlayerStore.subscribe(
      (state) => ({
        currentSeriesId: state.currentSeries?.id ?? null,
        status: state.status,
        playerMode: state.playerMode,
        currentChapterId: state.currentChapter?.id ?? null,
        currentVolumeId: state.currentVolumeId ?? state.currentChapter?.volume_id ?? null,
        currentTime: state.currentTime,
        duration: state.duration,
      }),
      (audioState) => {
        const isThisSeries = audioState.currentSeriesId === id;
        const isActive =
          isThisSeries &&
          (audioState.status === "playing" || audioState.status === "paused") &&
          audioState.playerMode !== "hidden";

        // 플레이어가 닫히거나 다른 시리즈로 전환 시 서버에서 최신 진행도 가져오기
        if (wasPlayingRef.current && !isActive) {
          wasPlayingRef.current = false;
          baseListenedRef.current = null;
          baseChapterTimeRef.current = 0;
          currentChapterIdRef.current = null;
          lastChapterTimeRef.current = 0;
          lastVolumeUpdate = 0;
          lastVolumeId = null;
          // 서버에 저장이 완료된 후 fetch (saveProgress 네트워크 요청 대기)
          if (refreshTimeoutRef.current) {
            clearTimeout(refreshTimeoutRef.current);
          }
          refreshTimeoutRef.current = setTimeout(() => {
            void loadData();
            refreshTimeoutRef.current = null;
          }, 800);
          return;
        }

        if (!isActive) return;
        wasPlayingRef.current = true;

        const currentChapterId = audioState.currentChapterId;
        if (currentChapterIdRef.current !== currentChapterId) {
          if (currentChapterIdRef.current !== null) {
            const completedDelta = Math.max(0, lastChapterTimeRef.current - baseChapterTimeRef.current);
            baseListenedRef.current = Math.max(0, (baseListenedRef.current ?? 0) + completedDelta);
          }
          currentChapterIdRef.current = currentChapterId;

          const serverProgress = progressRef.current;
          const sameChapter = serverProgress?.chapter_id === currentChapterId;
          baseChapterTimeRef.current = sameChapter ? (serverProgress?.current_time ?? 0) : 0;
          lastChapterTimeRef.current = audioState.currentTime;
        } else {
          lastChapterTimeRef.current = audioState.currentTime;
        }

        const now = Date.now();
        if (now - lastUpdate < 5000) return;
        lastUpdate = now;

        setSummary((prev) => {
          if (!prev) return prev;
          // total_duration이 없으면 현재 재생 중인 챕터의 duration으로 초기화
          const totalDur = prev.total_duration || audioState.duration;
          if (!totalDur || totalDur <= 0) return prev;

          // 첫 호출 시 서버에서 온 listened_duration을 기준값으로 저장
          // baseChapterTime은 서버에 저장된 current_time 사용 (live state.currentTime 대신)
          // → 서버의 listened_duration과 동일 기준점을 사용하여 delta 오차 방지
          if (baseListenedRef.current === null) {
            baseListenedRef.current = prev.listened_duration ?? 0;
            const serverProgress = progressRef.current;
            const sameChapter = serverProgress?.chapter_id === audioState.currentChapterId;
            baseChapterTimeRef.current = sameChapter ? (serverProgress?.current_time ?? 0) : 0;
          }
          const delta = Math.max(0, audioState.currentTime - baseChapterTimeRef.current);
          const newListened = Math.max(0, (baseListenedRef.current ?? 0) + delta);
          return {
            ...prev,
            total_duration: totalDur,
            listened_duration: Math.min(newListened, totalDur),
          };
        });

        // 현재 재생 중인 볼륨 카드의 progress_percent도 실시간 갱신
        const currentVolumeId = audioState.currentVolumeId;
        if (currentVolumeId && audioState.duration > 0) {
          const nowForVolume = Date.now();
          if (lastVolumeId === currentVolumeId && nowForVolume - lastVolumeUpdate < 1000) {
            return;
          }
          lastVolumeUpdate = nowForVolume;
          lastVolumeId = currentVolumeId;

          const volumePercent = Math.min(100, (audioState.currentTime / audioState.duration) * 100);
          setVolumes((prev) => {
            const index = prev.findIndex((volume) => volume.id === currentVolumeId);
            if (index < 0) return prev;

            const currentVolume = prev[index];
            if (
              typeof currentVolume.progress_percent === "number" &&
              Math.abs(currentVolume.progress_percent - volumePercent) < 0.01
            ) {
              return prev;
            }

            const next = [...prev];
            next[index] = { ...currentVolume, progress_percent: volumePercent };
            return next;
          });
        }
      },
      { equalityFn: shallow },
    );
    return () => {
      unsub();
      baseListenedRef.current = null;
      baseChapterTimeRef.current = 0;
      currentChapterIdRef.current = null;
      lastChapterTimeRef.current = 0;
      wasPlayingRef.current = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [id, series, loadData]);

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  if (!series) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <div className={styles.errorContainer}>
          <p>{t("series.not_found")}</p>
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
    <div className={`${styles.pageContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      {/* 서브 헤더 */}
      <SubHeader
        items={[
          ...(library
            ? [
                {
                  label: (
                    <>
                      <Folder size={14} /> {library.name}
                    </>
                  ),
                  to: `/libraries/${library.id}`,
                },
              ]
            : []),
          { label: seriesTitle },
        ]}
      />

      {/* 볼륨 그리드 */}
      <main className={styles.seriesMain}>
        {series ? (
          <>
            <SeriesInfoCard
              series={series}
              library={library}
              characters={characters}
              progress={progress}
              summary={summary}
              preferPercentLabel={preferPercentLabel}
              missingNumberRanges={missingNumberRanges}
              onUpdate={handleUpdate}
              onRefresh={loadData}
              onAlert={showAlert}
              onPlay={async (incognito = false) => {
                const viewerState = buildViewerRouteState({ from: viewerFrom, isIncognito: incognito });
                const isAudio = series.library_type === "audiobook";

                if (isAudio) {
                  const store = useAudioPlayerStore.getState();
                  const result = await store.bootstrapAndPlay({
                    source: "series",
                    seriesId: series.id,
                    series,
                  });
                  if (!result.ok) {
                    if (result.reason === "no_chapters") {
                      showAlert(t("series.alert.no_readable_chapter"), "warning");
                      return;
                    }
                    showAlert(t("series.alert.load_failed", { defaultValue: "오디오 정보를 불러오는데 실패했습니다." }), "error");
                    return;
                  }
                  return;
                }

                if (progress && progress.chapter_id) {
                  navigate(`/viewer/${progress.chapter_id}`, { state: viewerState });
                } else if (volumes.length > 0) {
                  try {
                    const sortedVolumes = [...volumes].sort((a, b) => a.volume_number - b.volume_number);
                    const [chaptersRes, volumesRes] = await Promise.all([
                      seriesAPI.getChapters(series.id),
                      seriesAPI.getVolumes(series.id),
                    ]);
                    const allChapters: Chapter[] = chaptersRes.data.chapters || [];
                    const allVolumes: Volume[] = volumesRes.data.volumes || [];
                    const chapterSearchContext = {
                      seriesId: series.id,
                      allChapters,
                      allVolumes,
                    };

                    // 재귀적으로 첫 번째 챕터 탐색
                    let firstChapter: Chapter | null = null;
                    for (const vol of sortedVolumes) {
                      firstChapter = await volumeAPI.findFirstChapterRecursively(vol.id, chapterSearchContext);
                      if (firstChapter) break;
                    }

                    if (firstChapter) {
                      navigate(`/viewer/${firstChapter.id}`, { state: viewerState });
                    } else {
                      // 챕터를 전혀 찾지 못한 경우 첫 번째 볼륨으로 이동
                      openVolume(sortedVolumes[0]);
                    }
                  } catch (error) {
                    console.error("Failed to find first readable chapter:", error);
                    showAlert(t("series.alert.load_failed", { defaultValue: "시리즈 정보를 불러오는데 실패했습니다." }), "error");
                  }
                } else {
                  showAlert(t("series.alert.no_readable_volume"), "warning");
                }
              }}
              onDownload={canDownload ? handleDownloadSeries : undefined}
            />

            <div className={styles.volumeCount}>
              {(() => {
                const hasChapterCount = !!series.chapter_count && series.chapter_count > 0;
                const useChapterLabel = hasChapterCount && series.display_unit !== "volume";
                const displayCount = useChapterLabel
                  ? (series.chapter_count ?? 0)
                  : series.volume_count || volumes.length;

                return (
                  <Trans
                    i18nKey={useChapterLabel ? "series.chapter_count" : "series.count"}
                    count={displayCount}
                    components={{ strong: <strong /> }}
                  />
                );
              })()}
            </div>

            {volumes.length === 0 ? (
              <div className={styles.emptyState}>
                <p>{t("series.empty_volumes")}</p>
              </div>
            ) : (
              <div className={styles.volumeGrid}>
                {volumes.map((volume) => (
                  <div
                    key={volume.id}
                    ref={(node) => {
                      if (node) {
                        volumeCardRefs.current[volume.id] = node;
                      } else {
                        delete volumeCardRefs.current[volume.id];
                      }
                    }}
                    className={styles.volumeCardAnchor}
                  >
                    <SeriesCard
                      item={volume}
                      type="volume"
                      progressStyle="overlay"
                      extensionBadgePlacement="meta"
                      onStatusChange={loadData}
                      onBeforeNavigate={() => {
                        if (id) rememberReturnFocus("series", id, volume.id);
                      }}
                      onDownload={canDownload ? () => handleDownloadVolume(volume) : undefined}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </main>

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        message={alertModal.message}
        onConfirm={alertModal.onConfirm || closeAlert}
        onCancel={alertModal.onConfirm ? closeAlert : undefined}
        showCancel={!!alertModal.onConfirm}
      />
    </div>
  );
}
