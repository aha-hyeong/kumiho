import { useState, useMemo } from "react";
import { Play, Edit2, Heart, Shield, BookCheck, BookX, ChevronDown, Download } from "lucide-react";
import { Link } from "react-router-dom";
import type { Series, Volume, ReadingProgress, SeriesProgressSummary } from "../types/series";
import { EditSeriesModal } from "./modals/EditSeriesModal";
import { AlertModal, type AlertType } from "./modals/AlertModal";
import { seriesAPI, volumeAPI } from "../api/client";
import { getAuthenticatedImageUrl } from "../utils/image";
import { useViewerStore } from "../stores/viewerStore";
import styles from "./SeriesInfoCard.module.css";

interface SeriesInfoCardProps {
  series: Series;
  volume?: Volume;
  type?: "series" | "volume";
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  onUpdate?: (updatedSeries: Series) => void;
  onPlay: () => void;
  onRefresh?: () => void;
  onAlert?: (message: string, type: "success" | "error" | "warning" | "info") => void;
  onDownload?: () => void;
}

export function SeriesInfoCard({
  series,
  volume,
  type = "series",
  progress,
  summary,
  onUpdate,
  onPlay,
  onRefresh,
  onAlert,
  onDownload,
}: SeriesInfoCardProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const setIncognito = useViewerStore((state) => state.setIncognito);
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

  const isVolumeType = type === "volume";

  // 시리즈 완독 처리 실행
  const executeMarkComplete = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      if (isVolumeType && volume) {
        await volumeAPI.markComplete(volume.id);
        onAlert?.("볼륨이 완독 처리되었습니다.", "success");
      } else {
        await seriesAPI.markComplete(series.id);
        onAlert?.("시리즈가 완독 처리되었습니다.", "success");
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to mark as complete:", error);
      onAlert?.("완독 처리에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 완독 처리 확인
  const handleMarkComplete = () => {
    const title = isVolumeType ? "볼륨 완독 처리" : "시리즈 완독 처리";
    const message = isVolumeType
      ? "이 볼륨을 완독 상태로 표시합니다. 계속하시겠습니까?"
      : "시리즈의 모든 권/화를 완독 상태로 표시합니다. 계속하시겠습니까?";

    setConfirmModal({
      isOpen: true,
      type: "warning",
      title,
      message,
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
      if (isVolumeType && volume) {
        // 볼륨의 경우 완독 상태 취소를 우선 수행 (완전 초기화 API 부재 시)
        await volumeAPI.deleteCompletion(volume.id);
        onAlert?.("볼륨 완독 상태가 초기화되었습니다.", "success");
      } else {
        await seriesAPI.resetProgress(series.id);
        onAlert?.("독서 기록이 초기화되었습니다.", "success");
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to reset progress:", error);
      onAlert?.("초기화에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 독서 기록 초기화 확인
  const handleResetProgress = () => {
    const title = isVolumeType ? "볼륨 독서 초기화" : "독서 기록 초기화";
    const message = isVolumeType
      ? "이 볼륨의 완독 상태가 초기화됩니다. 계속하시겠습니까?"
      : "시리즈의 모든 독서 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?";

    setConfirmModal({
      isOpen: true,
      type: "warning",
      title,
      message,
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        executeResetProgress();
      },
    });
  };

  // 진행률 계산
  const progressPercent = useMemo(() => {
    if (isVolumeType) {
      // 1. 현재 읽고 있는 진행도(progress)가 있으면 최우선 반영 (역주행 고려)
      if (progress) {
        return Math.min(100, progress.progress_percent);
      }
      // 2. 완독 상태이면 100%
      if (volume?.is_completed) return 100;
      // 3. 그 외: read_page_count 정보 활용
      if (volume?.total_page_count && volume.total_page_count > 0) {
        return Math.min(100, ((volume.read_page_count || 0) / volume.total_page_count) * 100);
      }
      return 0; // forceShowProgress가 true면 여기서 0을 반환해도 UI는 유지됨
    }

    if (series.total_page_count && series.total_page_count > 0) {
      const p = ((series.read_page_count || 0) / series.total_page_count) * 100;
      return Math.min(100, Math.max(0, p));
    }
    if (summary?.total_volumes && summary.current_volume_number >= 0) {
      return Math.min(100, (summary.current_volume_number / summary.total_volumes) * 100);
    }
    return progress ? Math.min(100, Math.max(0, progress.progress_percent)) : 0;
  }, [progress, summary, series, volume, isVolumeType]);

  // 마지막 읽은 시간
  const getLastReadTime = () => {
    const updatedAt = isVolumeType ? lastProgressUpdate : progress?.updated_at;
    if (!updatedAt) return null;
    const date = new Date(updatedAt);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const diffDays = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) return "오늘 읽음";
    if (diffDays === 1) return "어제 읽음";
    if (diffDays < 7) return `${diffDays}일 전 읽음`;
    return date.toLocaleDateString();
  };

  // 볼륨의 마지막 업데이트 시간 (가정)
  const lastProgressUpdate = useMemo(() => {
    // 실제 API에서 Volume 상세 정보에 last_read_at 등을 주는지 확인 필요
    // 여기서는 progress.updated_at을 우선 사용
    return progress?.updated_at;
  }, [progress]);

  // 썸네일 URL
  const thumbnailUrl = useMemo(() => {
    const rawUrl = isVolumeType ? volume?.thumbnail_url || series.thumbnail_url : series.thumbnail_url;
    if (!rawUrl) return null;

    const cacheBuster = `_cb=${new Date((isVolumeType ? volume?.created_at : series.updated_at) || Date.now()).getTime()}`;
    const separator = rawUrl.includes("?") ? "&" : "?";
    return getAuthenticatedImageUrl(`${rawUrl}${separator}${cacheBuster}`);
  }, [series, volume, isVolumeType]);

  // 진행도 텍스트 생성
  const getProgressLabel = () => {
    if (isVolumeType) {
      // 1. 현재 읽고 있는 진행도(progress)가 있으면 최우선 반영
      if (progress) {
        return `${progress.current_page} / ${progress.total_pages} P`;
      }
      // 2. 완독 상태
      if (volume?.is_completed) return "완독 (100%)";
      // 3. 그 외
      if (volume?.total_page_count && volume.total_page_count > 0) {
        return `${volume.read_page_count || 0} / ${volume.total_page_count} P`;
      }
      return "읽지 않음";
    }

    if (series.total_page_count && series.total_page_count > 0) {
      const p = ((series.read_page_count || 0) / series.total_page_count) * 100;
      return `${Math.floor(p)}% (${series.read_page_count || 0} / ${series.total_page_count} P)`;
    }
    if (summary?.total_volumes) {
      return `${summary.current_volume_number} / ${summary.total_volumes} 권`;
    }
    if (progress) {
      return `${progress.current_page} / ${progress.total_pages} P`;
    }
    return "읽지 않음";
  };

  // 즐겨찾기 (좋아요) 토글
  const handleToggleBookmark = async () => {
    if (!onUpdate) return;

    const newValue = !series.is_bookmarked;
    // Optimistic update
    onUpdate({ ...series, is_bookmarked: newValue });

    try {
      await seriesAPI.update(series.id, { is_bookmarked: newValue });
    } catch (error) {
      console.error("Failed to toggle bookmark:", error);
      onAlert?.("즐겨찾기 변경에 실패했습니다.", "error");
      // Revert on error
      onUpdate({ ...series, is_bookmarked: !newValue });
    }
  };

  return (
    <div className={`${styles.seriesInfoCard} ${isVolumeType ? styles.volumeMode : ""}`}>
      {/* 배경 블러 */}
      <div className={styles.seriesBackdrop}>
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            className={styles.seriesBackdropImage}
          />
        )}
      </div>

      {/* 썸네일 */}
      <div className={styles.seriesThumbnailContainer}>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={isVolumeType ? volume?.title : series.title}
            className={styles.seriesThumbnail}
          />
        ) : (
          <div className={styles.seriesThumbnailPlaceholder} />
        )}

        {/* 재생 오버레이 */}
        <div
          className={styles.thumbnailPlayOverlay}
          onClick={onPlay}
        >
          <div className={styles.playIconWrapper}>
            <Play
              size={32}
              fill="currentColor"
            />
          </div>
        </div>

        {!isVolumeType && (
          <div className={`${styles.seriesStatusBadge} ${styles[`status${series.metadata?.status}`]}`}>
            {series.metadata?.status === "ONGOING"
              ? "연재 중"
              : series.metadata?.status === "COMPLETED"
                ? "완결"
                : series.metadata?.status === "HIATUS"
                  ? "휴재"
                  : series.metadata?.status}
          </div>
        )}
      </div>

      {/* 콘텐츠 */}
      <div className={styles.seriesContent}>
        <div className={styles.seriesHeader}>
          {isVolumeType ? (
            <>
              <h1 className={styles.volumeTitle}>{volume?.title}</h1>
              <Link
                to={`/series/${series.id}`}
                className={styles.seriesSubtitle}
              >
                {series.title}
              </Link>
            </>
          ) : (
            <>
              <h1>{series.title}</h1>
              <div className={styles.seriesMeta}>
                {series.metadata?.authors}
                {series.metadata?.authors && series.metadata?.publication_year && (
                  <span className={styles.divider}>·</span>
                )}
                {series.metadata?.publication_year}
              </div>
            </>
          )}

          {!isVolumeType && series.metadata?.tags && (
            <div className={styles.seriesTags}>
              {series.metadata.tags.split(",").map((tag, i) => (
                <span
                  key={i}
                  className={styles.tagChip}
                >
                  #{tag.trim()}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 진행 상태 */}
        <div className={styles.seriesProgressSection}>
          <div className={styles.progressLabels}>
            <span>{getProgressLabel()}</span>
            <span className={styles.lastReadTime}>{getLastReadTime()}</span>
          </div>
          <div className={styles.progressBarBg}>
            <div
              className={styles.progressBarFill}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* 줄거리 (시리즈 모드에서만 표시) */}
        {!isVolumeType && series.description && (
          <div className={styles.seriesDescription}>
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
                className={styles.btnMore}
              >
                {isDescriptionExpanded ? "접기" : "더보기"}
              </button>
            )}
          </div>
        )}

        {/* 액션 버튼 */}
        <div className={styles.seriesActions}>
          <div className={styles.splitButtonGroup}>
            <button
              className={styles.btnSplitMain}
              onClick={onPlay}
            >
              <Play
                size={20}
                fill="currentColor"
              />
              {isVolumeType ? (progress ? "이어보기" : "첫 챕터 읽기") : progress ? "이어보기" : "첫 권 읽기"}
            </button>
            <button
              className={styles.btnSplitArrow}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <ChevronDown size={16} />
            </button>

            {isDropdownOpen && (
              <div className={styles.dropdownMenu}>
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    setIncognito(true);
                    onPlay();
                    setIsDropdownOpen(false);
                  }}
                >
                  <Shield size={16} /> 시크릿 모드
                </button>
              </div>
            )}
          </div>

          <button
            className={`${styles.btnAction} ${styles.btnSecondary}`}
            onClick={handleMarkComplete}
            disabled={isProcessing}
            title={isVolumeType ? "볼륨을 완독 상태로 표시" : "시리즈 전체를 완독 상태로 표시"}
          >
            <BookCheck size={18} /> 완독
          </button>
          <button
            className={`${styles.btnAction} ${styles.btnSecondary}`}
            onClick={handleResetProgress}
            disabled={isProcessing}
            title={isVolumeType ? "볼륨 완독 상태 초기화" : "시리즈 전체 독서 기록 초기화"}
          >
            <BookX size={18} /> 독서 초기화
          </button>

          {!isVolumeType && (
            <button
              className={`${styles.btnIcon} ${series.is_bookmarked ? styles.active : ""}`}
              onClick={handleToggleBookmark}
            >
              <Heart
                size={20}
                fill={series.is_bookmarked ? "currentColor" : "none"}
              />
            </button>
          )}

          {onDownload && (
            <button
              className={styles.btnIcon}
              onClick={onDownload}
              title="다운로드"
            >
              <Download size={20} />
            </button>
          )}

          {onUpdate && (
            <button
              className={styles.btnIcon}
              onClick={() => setIsEditModalOpen(true)}
            >
              <Edit2 size={20} />
            </button>
          )}
        </div>
      </div>

      {!isVolumeType && onUpdate && (
        <EditSeriesModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          series={series}
          onUpdate={onUpdate}
        />
      )}

      <AlertModal
        isOpen={confirmModal.isOpen}
        type={confirmModal.type}
        title={confirmModal.title}
        message={confirmModal.message}
        showCancel={true}
        onConfirm={confirmModal.onConfirm}
        onCancel={() => setConfirmModal((prev) => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
}
