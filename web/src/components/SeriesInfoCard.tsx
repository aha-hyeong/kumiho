import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Play, Edit2, Heart, Shield, BookCheck, BookX, ChevronDown, Download, FileText, BookOpen } from "lucide-react";
import type { Series, Volume, ReadingProgress, SeriesProgressSummary } from "../types/series";
import { EditSeriesModal } from "./modals/EditSeriesModal";
import { EditVolumeModal } from "./modals/EditVolumeModal";
import { AlertModal, type AlertType } from "./modals/AlertModal";
import { seriesAPI, volumeAPI } from "../api/client";
import { getAuthenticatedImageUrl } from "../utils/image";
import { useViewerStore } from "../stores/viewerStore";
import { useAuthStore } from "../stores/authStore";
import styles from "./SeriesInfoCard.module.css";

interface SeriesInfoCardProps {
  series: Series;
  volume?: Volume;
  type?: "series" | "volume";
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  onUpdate?: (updated: Series | Volume) => void;
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
  const { t } = useTranslation();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const setIncognito = useViewerStore((state) => state.setIncognito);
  const user = useAuthStore((state) => state.user);
  const isAdmin = user?.role === "MASTER";
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
        onAlert?.(t("series.alert.complete_success"), "success");
      } else {
        await seriesAPI.markComplete(series.id);
        onAlert?.(t("series.alert.complete_success"), "success");
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to mark as complete:", error);
      onAlert?.(t("series.alert.complete_failed"), "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 완독 처리 확인
  const handleMarkComplete = () => {
    const title = t("series.alert.mark_complete_title");
    const message = isVolumeType
      ? t("series.alert.mark_complete_unit_msg")
      : t("series.alert.mark_complete_series_msg");

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
        onAlert?.(t("series.alert.reset_success"), "success");
      } else {
        await seriesAPI.resetProgress(series.id);
        onAlert?.(t("series.alert.reset_success"), "success");
      }
      onRefresh?.();
    } catch (error) {
      console.error("Failed to reset progress:", error);
      onAlert?.(t("series.alert.reset_failed"), "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 시리즈 독서 기록 초기화 확인
  const handleResetProgress = () => {
    const title = t("series.alert.reset_progress_title");
    const message = isVolumeType
      ? t("series.alert.reset_progress_unit_msg")
      : t("series.alert.reset_progress_series_msg");

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
      if (!volume) return 0;
      // 1. 완독 상태이면 100%
      if (volume.is_completed) return 100;
      // 2. 볼륨 전체 페이지 정보가 있으면 이를 우선 사용 (모든 챕터 합산 진행도 - 백엔드에서 집계됨)
      if (volume.total_page_count && volume.total_page_count > 0) {
        return Math.min(100, ((volume.read_page_count || 0) / volume.total_page_count) * 100);
      }
      // 3. 현재 읽고 있는 진행도(progress)가 있으면 반영 (fallback)
      if (progress) {
        return Math.min(100, progress.progress_percent);
      }
      return 0;
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

    if (diffDays <= 0) return t("series.info.read_today");
    if (diffDays === 1) return t("series.info.read_yesterday");
    if (diffDays < 7) return t("series.info.read_days_ago", { count: diffDays });
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
      if (!volume) return t("series.info.not_read");
      // 1. 완독 상태
      if (volume.is_completed) return t("series.info.completed");
      // 2. 볼륨 전체 페이지 정보가 있으면 이를 우선 사용 (백엔드에서 집계된 전체 합계)
      if (volume.total_page_count && volume.total_page_count > 0) {
        return `${volume.read_page_count || 0} / ${volume.total_page_count} P`;
      }
      // 3. 현재 읽고 있는 진행도(progress)가 있으면 fallback
      if (progress) {
        return `${progress.current_page} / ${progress.total_pages} P`;
      }
      return t("series.info.not_read");
    }

    if (series.total_page_count && series.total_page_count > 0) {
      const p = ((series.read_page_count || 0) / series.total_page_count) * 100;
      return `${Math.floor(p)}% (${series.read_page_count || 0} / ${series.total_page_count} P)`;
    }
    if (summary?.total_pages && summary.total_pages > 0) {
      const p = ((summary.read_pages || 0) / summary.total_pages) * 100;
      return `${Math.floor(p)}% (${summary.read_pages || 0} / ${summary.total_pages} P)`;
    }
    if (summary?.total_volumes) {
      return `${summary.current_volume_number} / ${summary.total_volumes} ${t("series.unit.volume", { count: 1 }).replace(/\d+/, "").trim()}`;
    }
    if (progress) {
      return `${progress.current_page} / ${progress.total_pages} P`;
    }
    return t("series.info.not_read");
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
      onAlert?.(t("series.alert.bookmark_failed"), "error");
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
        {thumbnailUrl && !imageError ? (
          <img
            src={thumbnailUrl}
            alt={isVolumeType ? volume?.title : series.title}
            className={styles.seriesThumbnail}
            onError={() => setImageError(true)}
          />
        ) : (
          <div className={styles.seriesThumbnailPlaceholder}>
            {((isVolumeType ? volume?.path : series.path) || "").toLowerCase().endsWith(".pdf") ? (
              <FileText
                size={64}
                style={{ opacity: 0.5 }}
              />
            ) : (
              <BookOpen
                size={64}
                style={{ opacity: 0.5 }}
              />
            )}
          </div>
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
              ? t("series.status.ongoing")
              : series.metadata?.status === "COMPLETED"
                ? t("series.status.completed")
                : series.metadata?.status === "HIATUS"
                  ? t("series.status.hiatus")
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
              <div className={styles.seriesMeta}>
                {volume?.authors || series.metadata?.authors}
                {(volume?.authors || series.metadata?.authors) &&
                  (volume?.publication_year || series.metadata?.publication_year) && (
                    <span className={styles.divider}>·</span>
                  )}
                {volume?.publication_year || series.metadata?.publication_year}
              </div>
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

        {/* 줄거리 */}
        {(isVolumeType ? volume?.description || series.description : series.description) && (
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
              {isVolumeType ? volume?.description || series.description : series.description}
            </p>
            {(isVolumeType ? volume?.description || series.description : series.description)!.length > 150 && (
              <button
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className={styles.btnMore}
              >
                {isDescriptionExpanded ? t("series.action.less") : t("series.action.more")}
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
              {isVolumeType
                ? progress
                  ? t("series.action.continue")
                  : t("series.action.read_first_chapter")
                : progress
                  ? t("series.action.continue")
                  : t("series.action.read_first_volume")}
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
                  <Shield size={16} /> {t("series.action.incognito")}
                </button>
              </div>
            )}
          </div>

          <button
            className={`${styles.btnAction} ${styles.btnSecondary}`}
            onClick={handleMarkComplete}
            disabled={isProcessing}
            title={isVolumeType ? t("series.alert.mark_complete_title") : t("series.alert.mark_complete_title")}
          >
            <BookCheck size={18} /> {t("series.action.mark_completed")}
          </button>
          <button
            className={`${styles.btnAction} ${styles.btnSecondary}`}
            onClick={handleResetProgress}
            disabled={isProcessing}
            title={isVolumeType ? t("series.alert.reset_progress_title") : t("series.alert.reset_progress_title")}
          >
            <BookX size={18} /> {t("series.action.mark_unread")}
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
              title={t("series.action.download")}
            >
              <Download size={20} />
            </button>
          )}

          {onUpdate && isAdmin && (
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

      {isVolumeType && onUpdate && volume && (
        <EditVolumeModal
          isOpen={isEditModalOpen}
          onClose={() => setIsEditModalOpen(false)}
          volume={volume}
          series={series}
          onUpdate={onUpdate as (updatedVolume: Volume) => void}
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
