import { useEffect, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Play, CheckCircle, Folder, Check, RotateCcw } from "lucide-react";
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
            // 가장 최근 기록 찾기
            const sorted = list.sort(
              (a: ReadingProgress, b: ReadingProgress) =>
                new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
            );
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
      message: chapter.is_read
        ? "완독 상태를 해제하고 독서 기록을 초기화하시겠습니까?"
        : "독서 기록을 초기화하시겠습니까?",
      onConfirm: async () => {
        try {
          await api.delete(`/chapters/${chapter.id}/progress`);
          await loadData();
          closeAlert();
        } catch (err) {
          console.error(err);
          setAlertModal({ isOpen: true, type: "error", message: "초기화 실패" });
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
        <Header />
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <p>{t("home.loading")}</p>
        </div>
      </div>
    );
  }

  if (!volume || !series) {
    return (
      <div className={styles.pageContainer}>
        <Header />
        <div className={styles.errorContainer}>
          <p>정보를 찾을 수 없습니다</p>
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

  // 이어보기 또는 첫 챕터 읽기
  const handlePlay = () => {
    if (lastProgress && lastProgress.chapter_id) {
      navigate(`/viewer/${lastProgress.chapter_id}`);
      return;
    }

    if (chapters.length > 0) {
      navigate(`/viewer/${chapters[0].id}`);
    } else {
      showAlert("읽을 수 있는 챕터가 없습니다.", "warning");
    }
  };
  const handleDownloadVolume = () => {
    if (!volume) return;
    setAlertModal({
      isOpen: true,
      type: "info",
      message: `"${volume.title}"을(를) 다운로드하시겠습니까?`,
      onConfirm: () => {
        try {
          const url = downloadAPI.getVolumeUrl(volume.id);
          initiateDownload(url);
          closeAlert();
        } catch (error: unknown) {
          const err = error as { message?: string };
          showAlert(err.message || "다운로드 실패", "error");
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
            총 <strong>{chapters.length}</strong>개의 챕터
          </div>

          {chapters.length === 0 ? (
            <div className={styles.emptyState}>
              <p>스캔된 챕터가 없습니다</p>
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
                      {chapter.thumbnail_url ? (
                        <img
                          src={`${chapter.thumbnail_url}${
                            chapter.thumbnail_url.includes("?") ? "&" : "?"
                          }token=${localStorage.getItem("access_token")}`}
                          alt={chapter.title}
                          className={styles.chapterThumbnail}
                        />
                      ) : (
                        <div className={styles.chapterThumbnailPlaceholder}>
                          <Folder size={20} />
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

                      {/* 완독 버튼 (안 읽었을 때만 표시) */}
                      {!chapter.is_read && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            api
                              .post(`/chapters/${chapter.id}/complete`)
                              .then(() => loadData())
                              .catch((err) => console.error(err));
                          }}
                          title="완독 표시"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                            padding: "4px",
                            marginRight: "4px",
                            display: "flex",
                            alignItems: "center",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#10b981")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
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
                          title="독서 초기화"
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--text-muted)",
                            padding: "4px",
                            marginRight: "4px",
                            display: "flex",
                            alignItems: "center",
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
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
