import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookOpen, Play, MoreVertical, BookCheck, BookX } from "lucide-react";
import { volumeAPI } from "../api/client";
import "./SeriesCard.css";

export interface Series {
  id: string;
  title: string;
  library_id: string;
  created_at: string;
  updated_at: string;
  thumbnail_url?: string; // 백엔드에서 추가될 예정
}

export interface SeriesCardProps {
  series: Series;
  customSubtitle?: string;
  progress?: number;
  // 계속 읽기 섹션용 추가 정보
  chapterId?: string;
  currentPage?: number;
  volumeId?: string;
  onStatusChange?: () => void; // 상태 변경 시 부모 컴포넌트에 알림
}

export function SeriesCard({
  series,
  customSubtitle,
  progress,
  chapterId,
  currentPage,
  volumeId,
  onStatusChange,
}: SeriesCardProps) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const formattedDate = new Date(series.updated_at).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });

  const validProgress = typeof progress === "number" ? Math.min(100, Math.max(0, isNaN(progress) ? 0 : progress)) : 0;

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
  const handlePlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (chapterId) {
      // 이어서 읽기 (계속 읽기 섹션에서 사용)
      // page 파라미터 없이 이동하면 Viewer에서 저장된 진행도 자동 로드
      navigate(`/viewer/${chapterId}`);
    } else {
      // 시리즈 페이지로 이동 (기본 동작)
      navigate(`/series/${series.id}`);
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

  // 읽지 않은 것으로 표시 (1페이지 상태)
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
                  <span>읽은 것으로 표시</span>
                </button>
                <button
                  className="series-menu-item"
                  onClick={handleMarkAsUnread}
                >
                  <BookX size={16} />
                  <span>읽지 않은 것으로 표시</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="series-info">
        <h3 className="series-title">{series.title}</h3>
        <div className="series-meta">
          <span>{customSubtitle || formattedDate}</span>
        </div>
        {typeof progress === "number" && (
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
