import { useState, useMemo } from "react";
import { Play, Edit2, Heart, Shield, BookCheck, BookX } from "lucide-react";
import type { Series, ReadingProgress, SeriesProgressSummary } from "../types/series";
import { EditSeriesModal } from "./EditSeriesModal";
import { AlertModal, type AlertType } from "./AlertModal";
import { seriesAPI } from "../api/client";
import "./SeriesInfoCard.css";

interface SeriesInfoCardProps {
  series: Series;
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  onUpdate: (updatedSeries: Series) => void;
  onPlay: () => void;
  onRefresh?: () => void;
  onAlert?: (message: string, type: "success" | "error" | "warning" | "info") => void;
}

export function SeriesInfoCard({
  series,
  progress,
  summary,
  onUpdate,
  onPlay,
  onRefresh,
  onAlert,
}: SeriesInfoCardProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    type: "warning",
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // 시리즈 완독 처리 실행
  const executeMarkComplete = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await seriesAPI.markComplete(series.id);
      onAlert?.("시리즈가 완독 처리되었습니다.", "success");
      onRefresh?.();
    } catch (error) {
      console.error("Failed to mark series as complete:", error);
      onAlert?.("완독 처리에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 완독 처리 확인
  const handleMarkComplete = () => {
    setConfirmModal({
      isOpen: true,
      type: "warning",
      title: "시리즈 완독 처리",
      message: "시리즈의 모든 권/화를 완독 상태로 표시합니다. 계속하시겠습니까?",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        executeMarkComplete();
      },
    });
  };

  // 시리즈 독서 기록 초기화 실행
  const executeResetProgress = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await seriesAPI.resetProgress(series.id);
      onAlert?.("독서 기록이 초기화되었습니다.", "success");
      onRefresh?.();
    } catch (error) {
      console.error("Failed to reset series progress:", error);
      onAlert?.("초기화에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 독서 기록 초기화 확인
  const handleResetProgress = () => {
    setConfirmModal({
      isOpen: true,
      type: "warning",
      title: "독서 기록 초기화",
      message: "시리즈의 모든 독서 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        executeResetProgress();
      },
    });
  };

  // 진행률 계산 (summary가 있으면 전체 볼륨/챕터 대비 진행률 사용)
  const progressPercent = useMemo(() => {
    // [Priority] 페이지 기준 진행률 (서버에서 계산된 값)
    if (series.total_page_count && series.total_page_count > 0) {
      const p = ((series.read_page_count || 0) / series.total_page_count) * 100;
      return Math.min(100, Math.max(0, p));
    }
    // 볼륨 기준 진행률
    if (summary?.total_volumes && summary.current_volume_number >= 0) {
      return Math.min(100, (summary.current_volume_number / summary.total_volumes) * 100);
    }
    // 챕터 기준 진행률
    if (summary?.total_chapters && summary.current_chapter_number >= 0) {
      return Math.min(100, (summary.current_chapter_number / summary.total_chapters) * 100);
    }
    // Fallback: 페이지 기반 진행률
    return progress ? Math.min(100, Math.max(0, progress.progress_percent)) : 0;
  }, [progress, summary, series.total_page_count, series.read_page_count]);

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
          <div className="series-author">
            {series.authors}
            {series.authors && series.publication_year && <span className="divider">·</span>}
            {series.publication_year}
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
            <span>
              {series.total_page_count && series.total_page_count > 0
                ? `${Math.round(((series.read_page_count || 0) / series.total_page_count) * 100)}% (${
                    series.read_page_count || 0
                  } / ${series.total_page_count} P)`
                : summary?.total_volumes
                ? `${summary.current_volume_number} / ${summary.total_volumes} 권`
                : summary?.total_chapters
                ? `${summary.current_chapter_number} / ${summary.total_chapters} 화`
                : progress
                ? `${progress.current_page} / ${progress.total_pages} 페이지`
                : "읽지 않음"}
            </span>
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

          <button
            className="btn-action btn-secondary"
            onClick={handleMarkComplete}
            disabled={isProcessing}
            title="시리즈 전체를 완독 상태로 표시"
            aria-label="시리즈 전체를 완독 상태로 표시"
          >
            <BookCheck size={18} /> 완독
          </button>
          <button
            className="btn-action btn-secondary"
            onClick={handleResetProgress}
            disabled={isProcessing}
            title="시리즈 전체 독서 기록 초기화"
            aria-label="시리즈 전체 독서 기록 초기화"
          >
            <BookX size={18} /> 독서 초기화
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

      <AlertModal
        isOpen={confirmModal.isOpen}
        type={confirmModal.type}
        title={confirmModal.title}
        message={confirmModal.message}
        showCancel={true}
        confirmText="확인"
        cancelText="취소"
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
