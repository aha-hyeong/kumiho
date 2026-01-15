import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { BookOpen, ArrowLeft, Folder, Play } from "lucide-react";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { api, volumeAPI } from "../api/client";
import "./Series.css";

import type { Series, Volume, Library, ReadingProgress, Chapter } from "../types/series";
import { SeriesInfoCard } from "../components/SeriesInfoCard";

export function SeriesPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [series, setSeries] = useState<Series | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [progress, setProgress] = useState<ReadingProgress | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [openingVolumeId, setOpeningVolumeId] = useState<string | null>(null);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 볼륨 클릭 시 첫 번째 챕터로 뷰어 이동
  const handleVolumeClick = async (volume: Volume, e: React.MouseEvent) => {
    e.preventDefault();
    setOpeningVolumeId(volume.id);

    try {
      const res = await volumeAPI.getChapters(volume.id);
      const chapters: Chapter[] = res.data.chapters || [];

      if (chapters.length > 0) {
        // 챕터 번호순 정렬 후 첫 번째 챕터로 이동
        const sortedChapters = [...chapters].sort((a, b) => a.chapter_number - b.chapter_number);
        navigate(`/viewer/${sortedChapters[0].id}`);
      } else {
        alert("읽을 수 있는 챕터가 없습니다.");
      }
    } catch (error) {
      console.error("챕터 로드 실패:", error);
      alert("챕터를 불러올 수 없습니다.");
    } finally {
      setOpeningVolumeId(null);
    }
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
        onAddLibrary={() => alert("라이브러리 페이지에서만 추가할 수 있습니다.")}
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
            onUpdate={setSeries}
            onPlay={() => {
              if (progress && progress.chapter_id) {
                // 이어보기
                navigate(`/viewer/${progress.chapter_id}`);
              } else if (volumes.length > 0) {
                // 첫 권 읽기
                // volumes[0]의 첫 챕터 찾기 (이미 volume 목록에 챕터 정보가 없으므로 API 호출 필요할 수도 있지만,
                // handleVolumeClick 로직 재사용하거나 첫 볼륨 클릭 효과 흉내)
                // 여기서는 간단히 첫 번째 볼륨 클릭 핸들러 호출
                const firstVolume = volumes.sort((a, b) => a.volume_number - b.volume_number)[0];
                // 가짜 이벤트 객체 전달
                handleVolumeClick(firstVolume, { preventDefault: () => {} } as React.MouseEvent);
              } else {
                alert("읽을 수 있는 권이 없습니다.");
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
              <div
                key={volume.id}
                className={`volume-card ${openingVolumeId === volume.id ? "loading" : ""}`}
                onClick={(e) => handleVolumeClick(volume, e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && handleVolumeClick(volume, e as unknown as React.MouseEvent)}
              >
                <div className="volume-cover">
                  {volume.thumbnail_url ? (
                    <img
                      src={(() => {
                        const token = localStorage.getItem("access_token");
                        if (!token) return volume.thumbnail_url;
                        const separator = volume.thumbnail_url?.includes("?") ? "&" : "?";
                        return `${volume.thumbnail_url}${separator}token=${token}`;
                      })()}
                      alt={volume.title}
                      className="volume-thumbnail"
                      loading="lazy"
                    />
                  ) : (
                    <BookOpen size={40} />
                  )}
                  {/* 재생 오버레이 */}
                  <div className="volume-play-overlay">
                    {openingVolumeId === volume.id ? (
                      <div className="loading-spinner small" />
                    ) : (
                      <Play
                        size={32}
                        fill="white"
                      />
                    )}
                  </div>
                </div>
                <div className="volume-info">
                  <h3 className="volume-title">{volume.title}</h3>
                  <p className="volume-number">{volume.volume_number}권</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
