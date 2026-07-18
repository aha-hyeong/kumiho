import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Play, Edit2, Heart, Shield, BookCheck, BookX, ChevronDown, Download, FileText, BookOpen, CircleAlert } from "lucide-react";
import type { Series, Volume, ReadingProgress, SeriesProgressSummary, SeriesCharacter, Library } from "../types/series";
import { formatMissingNumberRanges, type NumberRange } from "../utils/missingNumbers";
import { EditSeriesModal } from "./modals/EditSeriesModal";
import { EditVolumeModal } from "./modals/EditVolumeModal";
import { AlertModal, type AlertType } from "./modals/AlertModal";
import { seriesAPI, volumeAPI } from "../api/client";
import { getAuthenticatedImageUrl } from "../utils/image";
import { localizedOriginalTitle } from "../utils/originalTitles";
import { calculateProgressDisplay } from "../utils/progressUtils";
import { useAuthStore } from "../stores/authStore";
import { Tooltip } from "./common/Tooltip";
import styles from "./SeriesInfoCard.module.css";

interface SeriesInfoCardProps {
  series: Series;
  library?: Library | null;
  volume?: Volume;
  type?: "series" | "volume";
  progress?: ReadingProgress;
  summary?: SeriesProgressSummary;
  preferPercentLabel?: boolean;
  missingNumberRanges?: NumberRange[];
  characters?: SeriesCharacter[];
  onUpdate?: (updated: Series | Volume) => void;
  onPlay: (incognito?: boolean) => void | Promise<void>;
  onRefresh?: () => void;
  onAlert?: (message: string, type: "success" | "error" | "warning" | "info") => void;
  onDownload?: () => void;
}

export function SeriesInfoCard({
  series,
  library,
  volume,
  type = "series",
  progress,
  summary,
  preferPercentLabel = false,
  missingNumberRanges = [],
  characters,
  onUpdate,
  onPlay,
  onRefresh,
  onAlert,
  onDownload,
}: SeriesInfoCardProps) {
  const { t, i18n } = useTranslation();
  const incognitoMenuId = useId();
  const characterModalTitleId = useId();
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isDescriptionTruncated, setIsDescriptionTruncated] = useState(false);
  const [isMissingNumberNoticeCollapsed, setIsMissingNumberNoticeCollapsed] = useState(true);
  const descriptionRef = useRef<HTMLParagraphElement | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isCharacterModalOpen, setIsCharacterModalOpen] = useState(false);
  const characterModalRef = useRef<HTMLDivElement | null>(null);
  const characterModalCloseRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isCharacterModalOpen) {
      return undefined;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    characterModalCloseRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsCharacterModalOpen(false);
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const root = characterModalRef.current;
      if (!root) {
        return;
      }

      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (event.shiftKey) {
        if (active === first || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!root.contains(active)) {
        event.preventDefault();
        first.focus();
        return;
      }

      if (active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
      previousFocusRef.current?.focus();
    };
  }, [isCharacterModalOpen]);
  const [imageError, setImageError] = useState(false);
  const splitButtonRef = useRef<HTMLDivElement | null>(null);
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
  const displayedOriginalTitle = localizedOriginalTitle(
    series.metadata?.original_titles,
    i18n.language || "ko",
    series.metadata?.original_title || "",
  );
  const shouldHideOriginalTitle = Boolean(library?.original_title_override);
  const visibleSeriesTitle = series.display_title || series.title;
  const displayPath = (isVolumeType ? volume?.path : series.path) || "";
  const lowerDisplayPath = displayPath.toLowerCase();
  const isTextFile = lowerDisplayPath.endsWith(".txt") || (!isVolumeType && series.extension === "TXT");
  const isAudiobook = series.library_type === "audiobook";
  const shouldUseSeriesDescriptionFallback = isVolumeType && !volume?.description?.trim();
  const rawDescription = isVolumeType && !shouldUseSeriesDescriptionFallback ? volume?.description ?? "" : series.description;
  const translatedDescription = !isVolumeType || shouldUseSeriesDescriptionFallback ? series.metadata?.description_translated : undefined;
  const displayDescription = translatedDescription || rawDescription;
  const isChapterUnit = series.display_unit === "chapter";
  const missingNumberUnit = isChapterUnit
    ? t("series.missing_number_unit.chapter")
    : t("series.missing_number_unit.volume");
  const missingNumberLabel = formatMissingNumberRanges(missingNumberRanges, missingNumberUnit);
  const missingNumberNoticeLabel = isChapterUnit
    ? t("series.missing_chapters", { numbers: missingNumberLabel })
    : t("series.missing_volumes", { numbers: missingNumberLabel });

  useEffect(() => {
    setIsDescriptionExpanded(false);
  }, [displayDescription]);

  useEffect(() => {
    setIsMissingNumberNoticeCollapsed(true);
  }, [missingNumberNoticeLabel]);

  useEffect(() => {
    const descriptionElement = descriptionRef.current;
    if (!descriptionElement || !displayDescription || isDescriptionExpanded) {
      if (!displayDescription) {
        setIsDescriptionTruncated(false);
      }
      return undefined;
    }

    const updateTruncation = () => {
      setIsDescriptionTruncated(descriptionElement.scrollHeight > descriptionElement.clientHeight + 1);
    };

    updateTruncation();
    if (typeof ResizeObserver === "undefined") {
      return undefined;
    }

    const resizeObserver = new ResizeObserver(updateTruncation);
    resizeObserver.observe(descriptionElement);
    return () => resizeObserver.disconnect();
  }, [displayDescription, isDescriptionExpanded]);

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

  // 진행 상태 데이터 계산 (퍼센트 및 라벨)
  const { percent: progressPercent, label: progressLabel } = useMemo(
    () => calculateProgressDisplay({ type, series, volume, progress, summary, preferPercentLabel, t }),
    [type, series, volume, progress, summary, preferPercentLabel, t],
  );

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

    const versionSource = isVolumeType ? volume?.updated_at || volume?.created_at : series.updated_at;
    const parsedTimestamp = versionSource ? Date.parse(versionSource) : NaN;
    const cacheBusterValue = Number.isNaN(parsedTimestamp) ? 0 : parsedTimestamp;
    const cacheBuster = `_cb=${cacheBusterValue}`;
    const separator = rawUrl.includes("?") ? "&" : "?";
    return getAuthenticatedImageUrl(`${rawUrl}${separator}${cacheBuster}`);
  }, [series, volume, isVolumeType]);

  // 진행도 텍스트 생성
  const getProgressLabel = () => progressLabel;

  useEffect(() => {
    if (!isDropdownOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!splitButtonRef.current?.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isDropdownOpen]);

  // 좋아요 (Like) 토글
  const handleToggleLike = async () => {
    if (!onUpdate) return;

    const newValue = !series.is_bookmarked;
    // Optimistic update
    onUpdate({ ...series, is_bookmarked: newValue });

    try {
      await seriesAPI.update(series.id, { is_bookmarked: newValue });
    } catch (error) {
      console.error("Failed to toggle like:", error);
      onAlert?.(t("series.alert.like_failed"), "error");
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

      {/* 썸네일 + 등장인물 */}
      <div className={styles.seriesThumbnailColumn}>
        <div className={styles.seriesThumbnailContainer}>
          {thumbnailUrl && !imageError ? (
            isAudiobook ? (
              <>
                <img
                  src={thumbnailUrl}
                  alt=""
                  className={styles.seriesThumbnailBlur}
                  aria-hidden="true"
                />
                <img
                  src={thumbnailUrl}
                  alt={isVolumeType ? volume?.title : visibleSeriesTitle}
                  className={styles.seriesThumbnailContain}
                  onError={() => setImageError(true)}
                />
              </>
            ) : (
              <img
                src={thumbnailUrl}
                alt={isVolumeType ? volume?.title : visibleSeriesTitle}
                className={styles.seriesThumbnail}
                onError={() => setImageError(true)}
              />
            )
          ) : isAudiobook ? (
            <div className={styles.seriesThumbnailPlaceholder}>
              <img
                src="/audio-kumiho.png"
                alt=""
                className={styles.seriesPlaceholderImage}
                draggable={false}
              />
            </div>
          ) : isTextFile ? (
            <div className={styles.seriesThumbnailPlaceholder}>
              <img
                src="/reading-kumiho.png"
                alt=""
                className={styles.seriesPlaceholderImage}
                draggable={false}
              />
            </div>
          ) : (
            <div className={styles.seriesThumbnailPlaceholder}>
              {lowerDisplayPath.endsWith(".pdf") ? (
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
          <button
            type="button"
            className={styles.thumbnailPlayOverlay}
            aria-label={isAudiobook ? t("series.actions.listen_now") : t("series.actions.read_now")}
            onClick={() => {
              void onPlay();
            }}
          >
            <div className={styles.playIconWrapper}>
              <Play
                size={32}
                fill="currentColor"
              />
            </div>
          </button>

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

        {!isVolumeType && characters && characters.length > 0 && (
          <div className={styles.characterAvatars}>
            {characters.slice(0, 4).map((character) => (
              <div
                key={character.id}
                className={styles.characterAvatar}
              >
                {character.image_url ? (
                  <img
                    src={getAuthenticatedImageUrl(character.image_url)}
                    alt=""
                    aria-hidden="true"
                    className={styles.characterAvatarImage}
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                      (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty("display", "flex");
                    }}
                  />
                ) : null}
                <span
                  className={styles.characterAvatarInitial}
                  aria-hidden="true"
                  style={character.image_url ? { display: "none" } : undefined}
                >
                  {character.name.charAt(0)}
                </span>
                <span className={styles.characterAvatarName}>{character.name}</span>
              </div>
            ))}
            {characters.length > 4 && (
              <button
                type="button"
                className={`${styles.characterAvatar} ${styles.characterAvatarMore}`}
                onClick={() => setIsCharacterModalOpen(true)}
                aria-label={t("series.characters.title")}
              >
                +{characters.length - 4}
              </button>
            )}
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
              <h1>{visibleSeriesTitle}</h1>
              <div className={styles.seriesMeta}>
                {series.metadata?.authors}
                {series.metadata?.authors && series.metadata?.publication_year && (
                  <span className={styles.divider}>·</span>
                )}
                {series.metadata?.publication_year}
              </div>
              {displayedOriginalTitle && !shouldHideOriginalTitle && (
                <div className={styles.seriesExtraMeta}>
                  <span className={styles.seriesExtraMetaLabel}>{t("series.metainfo.original_title")}</span>
                  <span>{displayedOriginalTitle}</span>
                </div>
              )}
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
        {displayDescription && (
          <div className={styles.seriesDescription}>
            <p
              ref={descriptionRef}
              style={{
                margin: 0,
                display: "-webkit-box",
                WebkitLineClamp: isDescriptionExpanded ? "unset" : 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {displayDescription}
            </p>
            {isDescriptionTruncated && (
              <button
                onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                className={styles.btnMore}
              >
                {isDescriptionExpanded ? t("series.action.less") : t("series.action.more")}
              </button>
            )}
          </div>
        )}

        {missingNumberRanges.length > 0 && missingNumberLabel && (
          <button
            type="button"
            className={`${styles.missingNumberNotice} ${isMissingNumberNoticeCollapsed ? styles.missingNumberNoticeCollapsed : ""}`}
            aria-label={missingNumberNoticeLabel}
            aria-pressed={isMissingNumberNoticeCollapsed}
            title={isMissingNumberNoticeCollapsed ? missingNumberNoticeLabel : undefined}
            onClick={() => setIsMissingNumberNoticeCollapsed((collapsed) => !collapsed)}
          >
            <CircleAlert size={16} aria-hidden="true" />
            {!isMissingNumberNoticeCollapsed && <span>{missingNumberNoticeLabel}</span>}
          </button>
        )}

        {/* 액션 버튼 */}
        <div className={styles.seriesActions}>
          <div
            ref={splitButtonRef}
            className={`${styles.splitButtonGroup} ${isDropdownOpen ? styles.splitButtonGroupOpen : ""}`}
          >
            <button
              className={styles.btnSplitMain}
              onClick={() => {
                void onPlay();
              }}
            >
              <Play
                size={20}
                fill="currentColor"
              />
              {(() => {
                const isAudio = series.library_type === "audiobook";
                if (isVolumeType) {
                  return progress
                    ? t("series.action.continue")
                    : isAudio
                      ? t("series.action.listen_first_chapter")
                      : t("series.action.read_first_chapter");
                }
                return progress
                  ? t("series.action.continue")
                  : isAudio
                    ? t("series.action.listen_first_volume")
                    : t("series.action.read_first_volume");
              })()}
            </button>
            <button
              className={styles.btnSplitArrow}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              aria-label={t("series.action.incognito")}
              aria-haspopup="true"
              aria-expanded={isDropdownOpen}
              aria-controls={incognitoMenuId}
            >
              <ChevronDown size={16} />
            </button>

            {isDropdownOpen && (
              <div
                id={incognitoMenuId}
                className={styles.dropdownMenu}
              >
                <button
                  className={styles.dropdownItem}
                  onClick={() => {
                    void onPlay(true);
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
          >
            <BookCheck size={18} /> {t("series.action.mark_completed")}
          </button>
          <button
            className={`${styles.btnAction} ${styles.btnSecondary}`}
            onClick={handleResetProgress}
            disabled={isProcessing}
          >
            <BookX size={18} /> {t("series.action.mark_unread")}
          </button>

          {!isVolumeType && (
            <Tooltip content={t("series.action.like")}>
              <button
                className={`${styles.btnIcon} ${series.is_bookmarked ? styles.active : ""}`}
                onClick={handleToggleLike}
                aria-label={t("series.action.like")}
              >
                <Heart
                  size={20}
                  fill={series.is_bookmarked ? "currentColor" : "none"}
                />
              </button>
            </Tooltip>
          )}
          {onDownload && (
            <Tooltip content={t("series.action.download")}>
              <button
                className={styles.btnIcon}
                onClick={onDownload}
                aria-label={t("series.action.download")}
              >
                <Download size={20} />
              </button>
            </Tooltip>
          )}

          {onUpdate && isAdmin && (
            <Tooltip content={t("common.edit")}>
              <button
                className={styles.btnIcon}
                onClick={() => setIsEditModalOpen(true)}
                aria-label={t("common.edit")}
              >
                <Edit2 size={20} />
              </button>
            </Tooltip>
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

      {isCharacterModalOpen &&
        characters &&
        createPortal(
          <div
            className={styles.characterModalBackdrop}
            onClick={() => setIsCharacterModalOpen(false)}
          >
            <div
              className={styles.characterModalBox}
              role="dialog"
              aria-modal="true"
              aria-labelledby={characterModalTitleId}
              ref={characterModalRef}
              onClick={(e) => e.stopPropagation()}
            >
              <div className={styles.characterModalHeader}>
                <span id={characterModalTitleId}>{t("series.characters.title")}</span>
                <button
                  type="button"
                  className={styles.characterModalClose}
                  onClick={() => setIsCharacterModalOpen(false)}
                  aria-label={t("common.close")}
                  ref={characterModalCloseRef}
                >
                  ✕
                </button>
              </div>
              <div className={styles.characterModalScroll}>
                <div className={styles.characterModalGrid}>
                  {characters.map((character) => (
                    <div
                      key={character.id}
                      className={styles.characterModalItem}
                    >
                      <div className={styles.characterModalAvatar}>
                        {character.image_url ? (
                          <img
                            src={getAuthenticatedImageUrl(character.image_url)}
                            alt=""
                            aria-hidden="true"
                            className={styles.characterModalImage}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = "none";
                              (e.currentTarget.nextElementSibling as HTMLElement | null)?.style.setProperty(
                                "display",
                                "flex",
                              );
                            }}
                          />
                        ) : null}
                        <span
                          className={styles.characterModalInitial}
                          aria-hidden="true"
                          style={character.image_url ? { display: "none" } : undefined}
                        >
                          {character.name.charAt(0)}
                        </span>
                      </div>
                      <span className={styles.characterModalName}>{character.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
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
