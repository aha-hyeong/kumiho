import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Folder } from "lucide-react";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { VolumeCard } from "../components/VolumeCard";
import { api, volumeAPI } from "../api/client";
import "./Series.css";

import type { Series, Volume, Library, ReadingProgress, SeriesProgressSummary } from "../types/series";
import { SeriesInfoCard } from "../components/SeriesInfoCard";
import { AlertModal, type AlertType } from "../components/AlertModal";

export function SeriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [series, setSeries] = useState<Series | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>(undefined);
  const [summary, setSummary] = useState<SeriesProgressSummary | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  // openingVolumeId 제거

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

  // 볼륨 클릭 시 볼륨 상세 페이지로 이동
  const handleVolumeClick = (volume: Volume, e: React.MouseEvent) => {
    e.preventDefault();
    navigate(`/volumes/${volume.id}`);
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
        // API returns { progress: ..., series: ... }
        if (progressRes.data && progressRes.data.progress) {
          setProgress(progressRes.data.progress);
        }
        if (progressRes.data && progressRes.data.summary) {
          setSummary(progressRes.data.summary);
        }
      } catch (e) {
        // 진행도가 없을 수 있음 (무시)
      }
    } catch (error) {
      console.error("Failed to load series:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <Header />
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!series) {
    return (
      <div className="page-container">
        <Header />
        <div className="error-container">
          <p>시리즈를 찾을 수 없습니다</p>
          <Link
            to="/"
            className="back-link"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className={`page-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        refreshKey={0}
        onAddLibrary={() => showAlert("라이브러리 페이지에서만 추가할 수 있습니다.", "info")}
      />

      {/* 서브 헤더 */}
      <div className="sub-header">
        <div className="sub-header-left">
          <Link
            to={library ? `/libraries/${library.id}` : "/"}
            className="back-button"
          >
            <ArrowLeft size={16} /> 뒤로
          </Link>
          <div className="breadcrumb">
            {library && (
              <>
                <Link
                  to={`/libraries/${library.id}`}
                  className="breadcrumb-link"
                >
                  <Folder size={14} /> {library.name}
                </Link>
                <span className="breadcrumb-separator">/</span>
              </>
            )}
            <span className="breadcrumb-current">{series.title}</span>
          </div>
        </div>
      </div>

      {/* 볼륨 그리드 */}
      <main className="series-main">
        {series && (
          <SeriesInfoCard
            series={series}
            progress={progress}
            summary={summary}
            onUpdate={setSeries}
            onPlay={async () => {
              if (progress && progress.chapter_id) {
                // 이어보기
                navigate(`/viewer/${progress.chapter_id}?page=${progress.current_page}`);
              } else if (volumes.length > 0) {
                // 첫 권 읽기 (바로 뷰어로 이동)
                const sortedVolumes = [...volumes].sort((a, b) => a.volume_number - b.volume_number);
                const firstVolume = sortedVolumes[0];

                try {
                  const res = await volumeAPI.getChapters(firstVolume.id);
                  // API 응답 구조 대응 (배열 또는 { chapters: [...] })
                  const chapters = Array.isArray(res.data) ? res.data : res.data.chapters || [];

                  if (chapters.length > 0) {
                    // 챕터 번호로 정렬하여 첫 번째 챕터 선택
                    const sortedChapters = chapters.sort((a: any, b: any) => a.chapter_number - b.chapter_number);
                    navigate(`/viewer/${sortedChapters[0].id}`);
                  } else {
                    // 챕터가 없으면 볼륨 상세로 이동
                    handleVolumeClick(firstVolume, { preventDefault: () => {} } as React.MouseEvent);
                  }
                } catch (error) {
                  console.error("Failed to load chapters for first play:", error);
                  // 에러 시 볼륨 상세로 이동
                  handleVolumeClick(firstVolume, { preventDefault: () => {} } as React.MouseEvent);
                }
              } else {
                showAlert("읽을 수 있는 권이 없습니다.", "warning");
              }
            }}
          />
        )}
        <div className="volume-count">
          총 <strong>{volumes.length}</strong>권
        </div>

        {volumes.length === 0 ? (
          <div className="empty-state">
            <p>스캔된 볼륨이 없습니다</p>
          </div>
        ) : (
          <div className="volume-grid">
            {volumes.map((volume) => (
              <VolumeCard
                key={volume.id}
                volume={volume}
                onStatusChange={loadData}
              />
            ))}
          </div>
        )}
      </main>

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        message={alertModal.message}
        onConfirm={closeAlert}
      />
    </div>
  );
}
