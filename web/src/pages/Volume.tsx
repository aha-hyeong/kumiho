import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Play, CheckCircle, Folder } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { api, volumeAPI } from "../api/client";
import styles from "./Volume.module.css";

import type { Volume, Chapter, Series, ReadingProgress } from "../types/series";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";

export function VolumePage() {
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
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  useEffect(() => {
    if (volumeId) loadData();
  }, [volumeId]);

  const loadData = async () => {
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
      } catch (e) {
        setProgressList([]);
        setLastProgress(null);
      }
    } catch (error) {
      console.error("Failed to load volume data:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className={styles.pageContainer}>
        <Header />
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <p>로딩 중...</p>
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

  return (
    <div className={`${styles.pageContainer} page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        refreshKey={0}
        onAddLibrary={() => showAlert("라이브러리 페이지에서만 추가할 수 있습니다.", "info")}
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
                      {chapter.is_read && (
                        <CheckCircle
                          size={18}
                          className={styles.completeIcon}
                        />
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
        onConfirm={closeAlert}
      />
    </div>
  );
}
