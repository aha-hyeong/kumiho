import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Play, MoreVertical, BookCheck, BookX } from "lucide-react";
import { volumeAPI, seriesAPI } from "../api/client";
import type { Chapter } from "../types/series";
import "./SeriesCard.css";

export interface Series {
  id: string;
  title: string;
  library_id: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string;
}

export interface SeriesCardProps {
  series: Series;
  customSubtitle?: string;
  progress?: number;
  // 계속 읽기 섹션용 추가 정보
  chapterId?: string;
  volumeId?: string;
  onStatusChange?: () => void; // 상태 변경 시 부모 컴포넌트에 알림
}

export function SeriesCard({ series, customSubtitle, progress, chapterId, volumeId, onStatusChange }: SeriesCardProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 명시적으로 전달된 progress만 사용
  const validProgress =
    typeof progress === "number" ? Math.min(100, Math.max(0, isNaN(progress) ? 0 : progress)) : null;

  const getImageUrl = (url: string) => {
    const token = localStorage.getItem("access_token");
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${token}`;
  };

  // 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [menuOpen]);

  // 바로 읽기 버튼 클릭
  const handlePlayClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // 이미 로딩 중이면 무시 (더블 클릭 방지)
    if (isUpdating) return;

    if (chapterId) {
      // 1. 이미 chapterId가 있는 경우 (계속 읽기 섹션 등)
      // page 파라미터 없이 이동하면 Viewer에서 저장된 진행도 자동 로드
      navigate(`/viewer/${chapterId}`);
    } else {
      // 2. 시리즈 카드에서 클릭한 경우 (업데이트된 시리즈 등)
      // 진행도가 있는지 확인하고, 있으면 이어보기, 없으면 첫 권부터 시작
      setIsUpdating(true);
      try {
        // 2-1. 시리즈 진행도 조회
        const progressRes = await seriesAPI.getProgress(series.id);
        const progress = progressRes.data?.progress;

        if (progress && progress.chapter_id) {
          // 진행도가 있으면 해당 챕터로 이동
          navigate(`/viewer/${progress.chapter_id}`);
        } else {
          // 2-2. 진행도가 없으면 첫 번째 볼륨의 첫 번째 챕터 조회
          const volumesRes = await seriesAPI.getVolumes(series.id);
          const volumes = volumesRes.data.volumes || [];

          if (volumes.length > 0) {
            // 볼륨 번호 순 정렬
            const sortedVolumes = [...volumes].sort((a, b) => a.volume_number - b.volume_number);
            const firstVolume = sortedVolumes[0];

            // 첫 볼륨의 챕터 조회
            const chaptersRes = await volumeAPI.getChapters(firstVolume.id);
            const chapters = Array.isArray(chaptersRes.data) ? chaptersRes.data : chaptersRes.data.chapters || [];

            if (chapters.length > 0) {
              // 챕터 번호 순 정렬
              const sortedChapters = [...chapters].sort(
                (a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number
              );
              // 첫 챕터로 이동
              navigate(`/viewer/${sortedChapters[0].id}`);
            } else {
              // 챕터가 없으면 볼륨 상세 페이지로 이동 (fallback)
              navigate(`/series/${series.id}`);
            }
          } else {
            // 볼륨도 없으면 시리즈 상세 페이지로 이동 (fallback)
            navigate(`/series/${series.id}`);
          }
        }
      } catch (error) {
        console.error("Failed to determine start chapter:", error);
        // 에러 발생 시 시리즈 상세 페이지로 이동 (fallback)
        navigate(`/series/${series.id}`);
      } finally {
        setIsUpdating(false);
      }
    }
  };

  // 설정 메뉴 버튼 클릭
  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(!menuOpen);
  };

  // 읽은 것으로 표시 (완독 상태)
  const handleMarkAsRead = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    if (!volumeId) return;

    setIsUpdating(true);
    try {
      await volumeAPI.markComplete(volumeId);
      onStatusChange?.();
    } catch (error) {
      console.error("Failed to mark as read:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  // 읽지 않은 것으로 표시 (완독 상태 해제)
  const handleMarkAsUnread = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    if (!volumeId) return;

    setIsUpdating(true);
    try {
      await volumeAPI.deleteCompletion(volumeId);
      onStatusChange?.();
    } catch (error) {
      console.error("Failed to mark as unread:", error);
    } finally {
      setIsUpdating(false);
    }
  };

  // volumeId가 있어야 설정 메뉴 표시
  const showMenu = !!volumeId;

  return (
    <Link
      to={`/series/${series.id}`}
      className={`series-card ${isUpdating ? "updating" : ""}`}
    >
      <div className="series-cover">
        {series.thumbnail_url ? (
          <img
            src={getImageUrl(series.thumbnail_url)}
            alt={series.title}
            className="series-thumbnail"
            loading="lazy"
          />
        ) : (
          <BookOpen
            className="series-icon"
            size={48}
          />
        )}
        {/* 호버 오버레이 */}
        <div className="series-hover-overlay">
          <button
            className="series-play-button"
            onClick={handlePlayClick}
            title="바로 읽기"
          >
            <Play
              size={24}
              fill="white"
            />
          </button>
        </div>
        {/* 설정 메뉴 버튼 */}
        {showMenu && (
          <div
            className="series-menu-wrapper"
            ref={menuRef}
          >
            <button
              className="series-menu-button"
              onClick={handleMenuClick}
              title="더보기"
            >
              <MoreVertical size={18} />
            </button>
            {/* 드롭다운 메뉴 */}
            {menuOpen && (
              <div className="series-dropdown-menu">
                <button
                  className="series-menu-item"
                  onClick={handleMarkAsRead}
                >
                  <BookCheck size={16} />
                  <span>완독</span>
                </button>
                <button
                  className="series-menu-item"
                  onClick={handleMarkAsUnread}
                >
                  <BookX size={16} />
                  <span>독서 초기화</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="series-info">
        <h3
          className="series-title"
          title={series.title}
        >
          {series.title}
        </h3>
        {/* customSubtitle이 있으면 표시, 없으면 진행률 퍼센트 표시 */}
        {customSubtitle ? (
          <div className="series-meta">
            <span>{customSubtitle}</span>
          </div>
        ) : validProgress !== null ? (
          <div className="series-meta">
            <span>{validProgress}%</span>
          </div>
        ) : null}
        {validProgress !== null && (
          <div className="series-progress-track">
            <div
              className="series-progress-fill"
              style={{ width: `${validProgress}%` }}
            />
          </div>
        )}
      </div>
    </Link>
  );
}
