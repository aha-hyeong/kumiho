import { useEffect, useState, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Play, CheckCircle, Folder, Check, RotateCcw, FileText } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { api, volumeAPI, downloadAPI } from "../api/client";
import { initiateDownload } from "../utils/download";
import { useAuthStore } from "../stores/authStore";
import styles from "./Volume.module.css";

import type { Volume, Chapter, Series, ReadingProgress } from "../types/series";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function VolumePage() {
  const { t } = useTranslation();
  const { volumeId } = useParams<{ volumeId: string }>();
  const navigate = useNavigate();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [series, setSeries] = useState<Series | null>(null);
  const [lastProgress, setLastProgress] = useState<ReadingProgress | null>(null);
  const [progressList, setProgressList] = useState<ReadingProgress[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

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

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  const loadData = useCallback(async () => {
    try {
      // 볼륨 상세 정보
      const volRes = await api.get(`/volumes/${volumeId}`);
      setVolume(volRes.data);

      // 챕터 목록
      const chapRes = await volumeAPI.getChapters(volumeId!);
      const chapterList = Array.isArray(chapRes.data) ? chapRes.data : chapRes.data.chapters || [];
      setChapters(chapterList.sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number));

      // 부모 시리즈 정보
      if (volRes.data.series_id) {
        const seriesRes = await api.get(`/series/${volRes.data.series_id}`);
        setSeries(seriesRes.data);
      }

      // 최근 읽기 진행도 가져오기 (볼륨 단위)
      try {
        const progressRes = await api.get(`/volumes/${volumeId}/progress`);
        const list = progressRes.data.progress_list;

        if (Array.isArray(list)) {
          setProgressList(list);

          if (list.length > 0) {
            // 가장 최근 기록 찾기 (미완독 우선, 그 다음 최신 타임스탬프, 그 다음 높은 챕터 번호)
            const sorted = list.sort((a: ReadingProgress, b: ReadingProgress) => {
              // 1. 미완독(progress_percent < 100) 우선
              const aIncomplete = a.progress_percent < 100 ? 0 : 1;
              const bIncomplete = b.progress_percent < 100 ? 0 : 1;
              if (aIncomplete !== bIncomplete) return aIncomplete - bIncomplete;

              // 2. 최신 타임스탬프 우선
              const timeDiff = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
              if (timeDiff !== 0) return timeDiff;

              // 3. 같은 타임스탬프면 챕터 번호가 높은 것 (최근 읽은 것)
              // chapter_id로 chapters 배열에서 chapter_number 찾기
              const chapterA = chapterList.find((c: Chapter) => c.id === a.chapter_id);
              const chapterB = chapterList.find((c: Chapter) => c.id === b.chapter_id);
              const numA = chapterA?.chapter_number ?? 0;
              const numB = chapterB?.chapter_number ?? 0;
              return numB - numA;
            });
            setLastProgress(sorted[0]);
          } else {
            setLastProgress(null);
          }
        } else {
          setProgressList([]);
          setLastProgress(null);
        }
      } catch {
        setProgressList([]);
        setLastProgress(null);
      }
    } catch (error) {
      console.error("Failed to load volume data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [volumeId]);

  const handleReset = (chapter: Chapter) => {
    setAlertModal({
      isOpen: true,
      type: "warning",
      message: chapter.is_read ? t("series.alert.reset_chapter_complete_msg") : t("series.alert.reset_chapter_msg"),
      onConfirm: async () => {
        try {
          await api.delete(`/chapters/${chapter.id}/progress`);
          await loadData();
          closeAlert();
        } catch (err) {
          console.error(err);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.reset_failed") });
        }
      },
    });
  };

  useEffect(() => {
    if (volumeId) loadData();
  }, [volumeId, loadData]);

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <LoadingSpinner fullScreen />
      </div>
    );
  }

  if (!volume || !series) {
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

  // 이어보기 또는 첫 챕터 읽기
  const handlePlay = () => {
    if (lastProgress && lastProgress.chapter_id) {
      navigate(`/viewer/${lastProgress.chapter_id}`);
      return;
    }

    if (chapters.length > 0) {
      navigate(`/viewer/${chapters[0].id}`);
    } else {
      showAlert(t("series.alert.no_readable_chapter"), "warning");
    }
  };
  const handleDownloadVolume = () => {
    if (!volume) return;
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

  const handleUpdate = (updated: Volume | Series) => {
    // Volume 타입인 경우만 처리
    if ("volume_number" in updated) {
      setVolume(updated as Volume);
    }
  };

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
          {
            label: (
              <>
                <Folder size={14} /> {series.title}
              </>
            ),
            to: `/series/${series.id}`,
          },
          { label: volume.title },
        ]}
        onBack={() => {
          if (series) {
            navigate(`/series/${series.id}`);
          } else {
            navigate(-1);
          }
        }}
      />

      <div className={styles.pageContentWrapper}>
        <main className={styles.volumeMain}>
          <SeriesInfoCard
            series={series}
            volume={volume}
            type="volume"
            progress={lastProgress || undefined}
            onPlay={handlePlay}
            onAlert={showAlert}
            onRefresh={loadData}
            onUpdate={handleUpdate}
            onDownload={canDownload ? handleDownloadVolume : undefined}
          />

          <div className={styles.chapterCount}>
            <Trans
              i18nKey="series.chapter_count"
              count={chapters.length}
              components={{ strong: <strong /> }}
            />
          </div>

          {chapters.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t("series.empty_chapters")}</p>
            </div>
          ) : (
            <div className={styles.chapterList}>
              {chapters.map((chapter) => {
                const chapterProgress = progressList.find((p) => p.chapter_id === chapter.id);
                const hasProgress = chapterProgress && chapterProgress.current_page > 0;

                return (
                  <div
                    key={chapter.id}
                    className={`${styles.chapterItem} ${lastProgress?.chapter_id === chapter.id ? styles.current : ""}`}
                    onClick={() => navigate(`/viewer/${chapter.id}`)}
                  >
                    <div className={styles.chapterThumbnailWrapper}>
                      {chapter.thumbnail_url && !imageErrors[chapter.id] ? (
                        <img
                          src={`${chapter.thumbnail_url}${
                            chapter.thumbnail_url.includes("?") ? "&" : "?"
                          }token=${localStorage.getItem("access_token")}`}
                          alt={chapter.title}
                          className={styles.chapterThumbnail}
                          onError={() => setImageErrors((prev) => ({ ...prev, [chapter.id]: true }))}
                        />
                      ) : (
                        <div className={styles.chapterThumbnailPlaceholder}>
                          {String(chapter.path || "")
                            .toLowerCase()
                            .endsWith(".pdf") ? (
                            <FileText
                              size={20}
                              style={{ opacity: 0.5 }}
                            />
                          ) : (
                            <Folder size={20} />
                          )}
                        </div>
                      )}
                    </div>

                    <div className={styles.chapterInfo}>
                      <span className={styles.chapterNumber}>Chapter {chapter.chapter_number}</span>
                      <span className={styles.chapterTitle}>{chapter.title}</span>
                      <span className={styles.chapterPages}>
                        {chapterProgress
                          ? `${chapterProgress.current_page} / ${chapter.page_count} P`
                          : `${chapter.page_count} Pages`}
                      </span>
                    </div>

                    <div className={styles.chapterStatus}>
                      {/* 완독 마크 (클릭 시 초기화) */}
                      {chapter.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReset(chapter);
                          }}
                          title="완독 해제 (초기화)"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            padding: "0 8px 0 0",
                            display: "flex",
                            alignItems: "center",
                          }}
                        >
                          <CheckCircle
                            size={18}
                            className={styles.completeIcon}
                          />
                        </button>
                      )}

                      {!chapter.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .post(`/chapters/${chapter.id}/complete`)
                              .then(() => loadData())
                              .catch((err) => console.error(err));
                          }}
                          aria-label={t("series.action.mark_as_read")}
                          data-tooltip={t("series.action.mark_as_read")}
                          className={`${styles.chapterActionButton} ${styles.tooltip}`}
                        >
                          <Check size={18} />
                        </button>
                      )}

                      {/* 초기화 버튼 (읽지 않았지만 진행도가 있을 때만 표시) */}
                      {!chapter.is_read && hasProgress && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleReset(chapter);
                          }}
                          aria-label={t("series.action.reset_progress")}
                          data-tooltip={t("series.action.reset_progress")}
                          className={`${styles.chapterActionButton} ${styles.resetButton} ${styles.tooltip}`}
                        >
                          <RotateCcw size={18} />
                        </button>
                      )}

                      <Play
                        size={18}
                        className={styles.playIcon}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

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
