import { useState, useMemo } from "react";
import { Play, Edit2, Heart, Shield } from "lucide-react";
import type { Series, ReadingProgress } from "../types/series";
import { EditSeriesModal } from "./EditSeriesModal";
import "./SeriesInfoCard.css";

interface SeriesInfoCardProps {
  series: Series;
  progress?: ReadingProgress;
  onUpdate: (updatedSeries: Series) => void;
  onPlay: () => void;
}

export function SeriesInfoCard({ series, progress, onUpdate, onPlay }: SeriesInfoCardProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);

  // 진행률 계산
  const progressPercent = progress ? Math.min(100, Math.max(0, progress.progress_percent)) : 0;

  // 마지막 읽은 시간 표시 (간단한 포맷팅)
  const getLastReadTime = () => {
    if (!progress?.updated_at) return null;
    const date = new Date(progress.updated_at);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "오늘 읽음";
    if (diffDays === 1) return "어제 읽음";
    if (diffDays < 7) return `${diffDays}일 전 읽음`;
    return date.toLocaleDateString();
  };

  // 썸네일 URL 계산 (캐시 무효화 포함)
  // series.updated_at이 변경되거나 series.thumbnail_url이 변경될 때만 URL을 새로 생성합니다.
  const thumbnailUrl = useMemo(() => {
    if (!series.thumbnail_url) return null;
    const token = localStorage.getItem("access_token");
    // 캐시 무효화를 위한 타임스탬프 (마지막 업데이트 시간 기준 + 현재 시간)
    // 단순히 Date.now()만 쓰면 매 렌더링마다 깜빡일 수 있으므로 useMemo로 감쌉니다.
    const cacheBuster = `_cb=${new Date(series.updated_at || Date.now()).getTime()}`;

    let url = series.thumbnail_url;
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}${cacheBuster}`;

    if (token) {
      url = `${url}&token=${token}`;
    }
    return url;
  }, [series.thumbnail_url, series.updated_at]);

  return (
    <div className="series-info-card">
      {/* 배경 블러 이미지 */}
      <div className="series-backdrop">
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className="series-backdrop-image"
          />
        )}
      </div>

      {/* 썸네일 */}
      <div className="series-thumbnail-container">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={series.title}
            className="series-thumbnail"
          />
        ) : (
          <div className="series-thumbnail-placeholder" />
        )}
        <div className={`series-status-badge status-${series.status}`}>
          {series.status === "ONGOING"
            ? "연재 중"
            : series.status === "COMPLETED"
            ? "완결"
            : series.status === "HIATUS"
            ? "휴재"
            : series.status}
        </div>
      </div>

      {/* 콘텐츠 */}
      <div className="series-content">
        <div className="series-header">
          <h1>{series.title}</h1>
          <div className="series-meta">
            {series.authors && <span>{series.authors}</span>}
            {series.authors && series.created_at && <span>•</span>}
            <span>{new Date(series.created_at).getFullYear()}</span>
          </div>
          {series.tags && (
            <div className="series-tags">
              {series.tags.split(",").map((tag, i) => (
                <span
                  key={i}
                  className="tag-chip"
                >
                  #{tag.trim()}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 진행 상태 */}
        <div className="series-progress-section">
          <div className="progress-labels">
            <span>{progress ? `${progress.current_page} / ${progress.total_pages} 페이지` : "읽지 않음"}</span>
            <span className="last-read-time">{getLastReadTime()}</span>
          </div>
          <div className="progress-bar-bg">
            <div
              className="progress-bar-fill"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 줄거리 */}
        {series.description && (
          <div className="series-description">
            <p
              style={{
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: isDescriptionExpanded ? "unset" : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {series.description}
            </p>
            {series.description.length > 150 && (
              <button
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#667eea",
                  padding: "4px 0",
                  cursor: "pointer",
                  fontSize: "0.85rem",
                }}
              >
                {isDescriptionExpanded ? "접기" : "더보기"}
              </button>
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className="series-actions">
          <button
            className="btn-action btn-primary"
            onClick={onPlay}
          >
            <Play
              size={20}
              fill="currentColor"
            />
            {progress && progress.current_page > 0 ? "이어보기" : "첫 권 읽기"}
          </button>

          <button className="btn-action btn-secondary">
            <Shield size={18} /> 시크릿
          </button>

          <button
            className={`btn-icon ${series.is_bookmarked ? "active" : ""}`}
            onClick={() => onUpdate({ ...series, is_bookmarked: !series.is_bookmarked })}
          >
            <Heart
              size={20}
              fill={series.is_bookmarked ? "currentColor" : "none"}
            />
          </button>

          <button
            className="btn-icon"
            onClick={() => setIsEditModalOpen(true)}
          >
            <Edit2 size={20} />
          </button>
        </div>
      </div>

      <EditSeriesModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        series={series}
        onUpdate={onUpdate}
      />
    </div>
  );
}
