import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Folder } from "lucide-react";
import { Header } from "../components/headers/Header";
import { SubHeader } from "../components/headers/SubHeader";
import { Sidebar } from "../components/Sidebar";
import { SeriesCard } from "../components/SeriesCard";
import { api, volumeAPI, downloadAPI } from "../api/client";
import { useAuthStore } from "../stores/authStore";
import styles from "./Series.module.css";

import type { Series, Volume, Library, ReadingProgress, SeriesProgressSummary, Chapter } from "../types/series";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { AlertModal, type AlertType } from "../components/modals/AlertModal";

export function SeriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [series, setSeries] = useState<Series | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
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
      message: `"${series.title}" 시리즈 전체를 다운로드하시겠습니까?\n파일 크기에 따라 시간이 걸릴 수 있습니다.`,
      onConfirm: () => {
        const token = localStorage.getItem("access_token");
        if (!token) {
          showAlert("인증 토큰이 없습니다. 다시 로그인해 주세요.", "error");
          return;
        }
        const url = `${downloadAPI.getSeriesUrl(series.id)}?token=${token}`;
        window.location.href = url;
        closeAlert();
      },
    });
  };

  const handleDownloadVolume = (volume: Volume) => {
    setAlertModal({
      isOpen: true,
      type: "info",
      message: `"${volume.title}"을(를) 다운로드하시겠습니까?`,
      onConfirm: () => {
        const token = localStorage.getItem("access_token");
        if (!token) {
          showAlert("인증 토큰이 없습니다. 다시 로그인해 주세요.", "error");
          return;
        }
        const url = `${downloadAPI.getVolumeUrl(volume.id)}?token=${token}`;
        window.location.href = url;
        closeAlert();
      },
    });
  };

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    try {
      // 시리즈 정보
      const seriesRes = await api.get(`/series/${id}`);
      setSeries(seriesRes.data);

      // 볼륨 목록
      const volumesRes = await api.get(`/series/${id}/volumes`);
      setVolumes(volumesRes.data.volumes || []);

      // 라이브러리 정보
      if (seriesRes.data.library_id) {
        const libRes = await api.get(`/libraries/${seriesRes.data.library_id}`);
        setLibrary(libRes.data);
      }

      // 읽기 진행도
      try {
        const progressRes = await api.get(`/series/${id}/progress`);
        setProgress(progressRes.data?.progress ?? undefined);
        setSummary(progressRes.data?.summary ?? undefined);
      } catch (e) {
        setProgress(undefined);
        setSummary(undefined);
      }
    } catch (error) {
      console.error("Failed to load series:", error);
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

  if (!series) {
    return (
      <div className={styles.pageContainer}>
        <Header />
        <div className={styles.errorContainer}>
          <p>시리즈를 찾을 수 없습니다</p>
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
          { label: series.title },
        ]}
      />

      {/* 볼륨 그리드 */}
      <main className={styles.seriesMain}>
        {series ? (
          <>
            <SeriesInfoCard
              series={series}
              progress={progress}
              summary={summary}
              onUpdate={setSeries}
              onRefresh={loadData}
              onAlert={showAlert}
              onPlay={async () => {
                if (progress && progress.chapter_id) {
                  navigate(`/viewer/${progress.chapter_id}`);
                } else if (volumes.length > 0) {
                  const sortedVolumes = [...volumes].sort((a, b) => a.volume_number - b.volume_number);
                  const firstVolume = sortedVolumes[0];

                  try {
                    const res = await volumeAPI.getChapters(firstVolume.id);
                    const chapters = Array.isArray(res.data) ? res.data : res.data.chapters || [];

                    if (chapters.length > 0) {
                      const sortedChapters = [...chapters].sort(
                        (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number,
                      );
                      navigate(`/viewer/${sortedChapters[0].id}`);
                    } else {
                      openVolume(firstVolume);
                    }
                  } catch (error) {
                    console.error("Failed to load chapters for first play:", error);
                    openVolume(firstVolume);
                  }
                } else {
                  showAlert("읽을 수 있는 권이 없습니다.", "warning");
                }
              }}
              onDownload={canDownload ? handleDownloadSeries : undefined}
            />

            <div className={styles.volumeCount}>
              총 <strong>{volumes.length}</strong>권
            </div>

            {volumes.length === 0 ? (
              <div className={styles.emptyState}>
                <p>스캔된 볼륨이 없습니다</p>
              </div>
            ) : (
              <div className={styles.volumeGrid}>
                {volumes.map((volume) => (
                  <SeriesCard
                    key={volume.id}
                    item={volume}
                    type="volume"
                    progressStyle="overlay"
                    onStatusChange={loadData}
                    onDownload={canDownload ? () => handleDownloadVolume(volume) : undefined}
                  />
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
