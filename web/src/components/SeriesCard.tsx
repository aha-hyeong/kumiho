import { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Play,
  MoreVertical,
  BookCheck,
  BookX,
  CheckCircle2,
  Shield,
  Download,
  Music,
  FileText,
} from "lucide-react";
import { volumeAPI, seriesAPI, chapterAPI } from "../api/client";
import { getAuthenticatedImageUrl } from "../utils/image";
import { normalizeExtensionBadge, parseSupportedExtension } from "../utils/extension";
import type { Series, Volume } from "../types/series";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { buildViewerRouteState } from "../utils/viewerRouteState";
import styles from "./SeriesCard.module.css";
import { AlertModal, type AlertType } from "./modals/AlertModal";

export interface SeriesCardProps {
  item: Series | Volume;
  type?: "series" | "volume";
  customSubtitle?: string;
  hideMarkPrevious?: boolean;
  progress?: number;
  chapterId?: string;
  volumeId?: string;
  onStatusChange?: () => void | Promise<void>;
  progressStyle?: "overlay" | "bar";
  onDownload?: () => void;
  showExtensionBadge?: boolean;
  extensionBadgeText?: string | null;
  extensionBadgePlacement?: "thumbnail" | "meta";
}

export function SeriesCard({
  item,
  type = "series",
  customSubtitle,
  hideMarkPrevious,
  progress,
  chapterId,
  volumeId,
  onStatusChange,
  progressStyle = "bar",
  onDownload,
  showExtensionBadge,
  extensionBadgeText = null,
  extensionBadgePlacement = "thumbnail",
}: SeriesCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const viewerFrom = `${location.pathname}${location.search}`;
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuAlign, setMenuAlign] = useState<"right" | "left">("right");
  const [menuMeasured, setMenuMeasured] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [forceShowProgress, setForceShowProgress] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [optimisticCompleted, setOptimisticCompleted] = useState<boolean | null>(null);
  const [optimisticProgress, setOptimisticProgress] = useState<number | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    message: string;
    onConfirm?: () => void | Promise<void>;
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  let calculatedProgress = progress;
  if (calculatedProgress === undefined && "progress_percent" in item && typeof item.progress_percent === "number") {
    calculatedProgress = item.progress_percent;
  }
  if (calculatedProgress === undefined && item.read_page_count !== undefined && item.total_page_count !== undefined) {
    if (item.total_page_count > 0) {
      calculatedProgress = (item.read_page_count / item.total_page_count) * 100;
    }
  }

  const validProgress =
    typeof calculatedProgress === "number"
      ? Math.min(100, Math.max(0, isNaN(calculatedProgress) ? 0 : calculatedProgress))
      : null;

  const displayProgress = optimisticProgress !== null ? optimisticProgress : validProgress;
  const completionFromItem =
    "is_completed" in item && typeof item.is_completed === "boolean" ? item.is_completed : undefined;
  const isCompletedFromData =
    completionFromItem !== undefined
      ? completionFromItem && (displayProgress === null || displayProgress >= 100)
      : displayProgress !== null && displayProgress >= 100;
  const isCompleted = optimisticCompleted !== null ? optimisticCompleted : isCompletedFromData;

  useEffect(() => {
    setOptimisticCompleted(null);
    setOptimisticProgress(null);
  }, [item.id, completionFromItem, validProgress]);

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

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const menuEl = dropdownRef.current;
    if (!menuEl) return;

    const rect = menuEl.getBoundingClientRect();
    if (rect.left < 8 || rect.right > window.innerWidth - 8) {
      setMenuAlign("left");
    } else {
      setMenuAlign("right");
    }
    setMenuMeasured(true);
  }, [menuOpen]);

  const handleCardClick = (e: React.MouseEvent) => {
    if (e.defaultPrevented || window.getSelection()?.toString()) return;

    if (type === "volume") {
      navigate(`/volumes/${item.id}`);
    } else {
      navigate(`/series/${item.id}`);
    }
  };

  const isAudiobook = "library_type" in item && item.library_type === "audiobook";
  const playAudio = async () => {
    const store = useAudioPlayerStore.getState();
    try {
      const result =
        type === "volume"
          ? await store.bootstrapAndPlay({
              source: "volume",
              seriesId: (item as Volume).series_id,
              volumeId: item.id,
              volume: item as Volume,
            })
          : await store.bootstrapAndPlay({
              source: "series",
              seriesId: item.id,
              series: item as Series,
            });
      if (!result.ok) {
        if (result.reason === "no_chapters") {
          setAlertModal({ isOpen: true, type: "warning", message: t("series.alert.no_readable_chapter") });
        }
        return;
      }
    } catch (err) {
      console.error("Failed to start audio playback:", err);
    }
  };

  const playSmart = async (incognito = false) => {
    setIsUpdating(true);
    try {
      const viewerState = buildViewerRouteState({ from: viewerFrom, isIncognito: incognito });

      // 오디오북이면 오디오 플레이어로 재생
      if (isAudiobook) {
        await playAudio();
        return;
      }

      if (type === "volume") {
        // 1. 재귀적 진행도 먼저 확인 (하위 볼륨 포함)
        const progressRes = await volumeAPI.getProgress(item.id);
        const progressList = Array.isArray(progressRes.data) ? progressRes.data : progressRes.data?.progress_list || [];

        if (progressList.length > 0) {
          // 백엔드에서 이미 업데이트 시간(DESC) 및 챕터 번호(DESC) 순으로 정렬되어 옴
          const lastProgress = progressList[0];

          if (lastProgress && lastProgress.chapter_id) {
            navigate(`/viewer/${lastProgress.chapter_id}`, { state: viewerState });
            return;
          }
        }

        // 2. 진행도가 없으면 첫 번째 챕터 탐색
        const firstChapter = await volumeAPI.findFirstChapterRecursively(item.id);
        if (firstChapter) {
          navigate(`/viewer/${firstChapter.id}`, { state: viewerState });
        } else {
          navigate(`/volumes/${item.id}`);
        }
        return;
      }

      const progressRes = await seriesAPI.getProgress(item.id);
      const targetProgress = progressRes.data?.progress;

      if (targetProgress && targetProgress.chapter_id) {
        navigate(`/viewer/${targetProgress.chapter_id}`, { state: viewerState });
        return;
      }

      // 시리즈 전체 챕터를 가져와서 첫 번째 챕터 탐색
      const chaptersRes = await seriesAPI.getChapters(item.id);
      const chapters = chaptersRes.data.chapters || [];

      if (chapters.length > 0) {
        navigate(`/viewer/${chapters[0].id}`, { state: viewerState });
      } else {
        navigate(`/series/${item.id}`);
      }
    } catch (error) {
      console.error("Failed to determine start chapter:", error);
      if (type === "volume") navigate(`/volumes/${item.id}`);
      else navigate(`/series/${item.id}`);
    } finally {
      setIsUpdating(false);
    }
  };

  const handlePlayClick = async (e: React.MouseEvent, incognito = false) => {
    e.preventDefault();
    e.stopPropagation();

    if (isUpdating) return;

    const viewerState = buildViewerRouteState({ from: viewerFrom, isIncognito: incognito });

    if (chapterId && type === "series") {
      navigate(`/viewer/${chapterId}`, { state: viewerState });
    } else {
      await playSmart(incognito);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!menuOpen) {
      setMenuAlign("right");
      setMenuMeasured(false);
    }
    setMenuOpen(!menuOpen);
  };

  const handleMarkAsRead = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    setAlertModal({
      isOpen: true,
      type: "warning",
      message:
        chapterId && type === "series"
          ? t("series.alert.mark_complete_chapter_msg")
          : type === "series"
            ? t("series.alert.mark_complete_series_msg")
            : t("series.alert.mark_complete_volume_msg"),
      onConfirm: async () => {
        setForceShowProgress(true);
        setOptimisticCompleted(true);
        setOptimisticProgress(100);
        setIsUpdating(true);
        try {
          if (chapterId && type === "series") {
            await chapterAPI.markComplete(chapterId);
          } else if (type === "volume") {
            await volumeAPI.markComplete(item.id);
          } else if (volumeId) {
            await volumeAPI.markComplete(volumeId);
          } else if (type === "series") {
            await seriesAPI.markComplete(item.id);
          }
          await Promise.resolve(onStatusChange?.());
          closeAlert();
        } catch (error) {
          console.error("Failed to mark as read:", error);
          setOptimisticCompleted(null);
          setOptimisticProgress(null);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.complete_failed") });
        } finally {
          setForceShowProgress(false);
          setIsUpdating(false);
        }
      },
    });
  };

  const handleMarkPreviousAsRead = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    if (type !== "volume") return;

    setAlertModal({
      isOpen: true,
      type: "warning",
      message: t("series.alert.mark_previous_completed_msg"),
      onConfirm: async () => {
        setIsUpdating(true);
        try {
          const seriesId = "series_id" in item ? (item as Volume).series_id : undefined;

          if (!seriesId) {
            throw new Error("Series ID is missing for this volume");
          }

          await seriesAPI.markPreviousComplete(seriesId, item.id);
          await Promise.resolve(onStatusChange?.());
          closeAlert();
        } catch (error) {
          console.error("Failed to mark previous as read:", error);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.complete_failed") });
        } finally {
          setIsUpdating(false);
        }
      },
    });
  };

  const handleMarkAsUnread = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);

    setAlertModal({
      isOpen: true,
      type: "warning",
      message:
        chapterId && type === "series"
          ? t("series.alert.reset_chapter_msg")
          : type === "series"
            ? t("series.alert.reset_progress_series_msg")
            : t("series.alert.reset_progress_volume_msg"),
      onConfirm: async () => {
        setForceShowProgress(true);
        setOptimisticCompleted(false);
        setOptimisticProgress(0);
        setIsUpdating(true);
        try {
          if (chapterId && type === "series") {
            await chapterAPI.deleteProgress(chapterId);
          } else if (type === "volume") {
            await volumeAPI.deleteCompletion(item.id);
          } else if (volumeId) {
            await volumeAPI.deleteCompletion(volumeId);
          } else if (type === "series") {
            await seriesAPI.resetProgress(item.id);
          }
          await Promise.resolve(onStatusChange?.());
          closeAlert();
        } catch (error) {
          console.error("Failed to mark as unread:", error);
          setOptimisticCompleted(null);
          setOptimisticProgress(null);
          setAlertModal({ isOpen: true, type: "error", message: t("series.alert.reset_failed") });
        } finally {
          setForceShowProgress(false);
          setIsUpdating(false);
        }
      },
    });
  };

  const showMenu = true;
  const shouldShowExtensionBadge = showExtensionBadge ?? type === "volume";
  const extensionBadge = shouldShowExtensionBadge
    ? (normalizeExtensionBadge(extensionBadgeText) ??
      normalizeExtensionBadge((item as Series | Volume).extension) ??
      parseSupportedExtension(item.path))
    : null;
  const showMetaExtensionBadge = shouldShowExtensionBadge && extensionBadgePlacement === "meta" && !!extensionBadge;
  const showThumbnailExtensionBadge =
    shouldShowExtensionBadge && extensionBadgePlacement === "thumbnail" && !!extensionBadge;
  const isAudioLayout = isAudiobook;
  const showOverlayProgress =
    progressStyle === "overlay" && displayProgress !== null && (displayProgress > 0 || forceShowProgress);
  const thumbnailSrc = useMemo(() => {
    if (!item.thumbnail_url) return "";

    const versionSource = item.updated_at || item.created_at;
    const parsedTime = Date.parse(versionSource);
    const cacheBuster = Number.isFinite(parsedTime) ? parsedTime : 0;
    const separator = item.thumbnail_url.includes("?") ? "&" : "?";
    const withCacheBuster = `${item.thumbnail_url}${separator}_cb=${cacheBuster}`;
    return getAuthenticatedImageUrl(withCacheBuster);
  }, [item.thumbnail_url, item.updated_at, item.created_at]);
  const lowerItemPath = String(item.path || "").toLowerCase();
  const isTextFile = extensionBadge === "TXT" || lowerItemPath.endsWith(".txt");

  let displaySubtitle = customSubtitle;
  if (!displaySubtitle) {
    if (type === "series") {
      const s = item as Series;
      if (s.chapter_count && s.chapter_count > 0) {
        displaySubtitle = t("series.unit.chapter_count", { count: s.chapter_count });
      } else if (s.volume_count && s.volume_count > 0) {
        displaySubtitle = t("series.unit.volume", { count: s.volume_count });
      }
    } else if (type === "volume" && "volume_number" in item) {
      const v = item as Volume;
      // 챕터가 있으면 챕터 개수를 표시
      if (v.chapter_count && v.chapter_count > 0) {
        displaySubtitle = t("series.unit.chapter_count", { count: v.chapter_count });
      }
      // 챕터가 없고 하위 볼륨이 있으면 하위 볼륨 개수를 표시
      else if (v.sub_volume_count && v.sub_volume_count > 0) {
        displaySubtitle = t("series.unit.volume", { count: v.sub_volume_count });
      }
      // 둘 다 없으면 자신의 번호 표시
      else {
        displaySubtitle = t(v.unit === "chapter" ? "series.unit.chapter" : "series.unit.volume", {
          count: v.volume_number,
        });
      }
    }
  }

  return (
    <div
      onClick={handleCardClick}
      className={`${styles.seriesCard} ${isUpdating ? styles.updating : ""}`}
      role="button"
      tabIndex={0}
      style={{ cursor: "pointer" }}
    >
      <div className={styles.seriesCover}>
        <div className={styles.seriesThumbnailWrapper}>
          {item.thumbnail_url && !imageError ? (
            isAudioLayout ? (
              <>
                <img
                  src={thumbnailSrc}
                  alt=""
                  className={styles.seriesThumbnailBlur}
                  loading="lazy"
                  draggable={false}
                  aria-hidden="true"
                />
                <img
                  src={thumbnailSrc}
                  alt={item.title}
                  className={styles.seriesThumbnailContain}
                  loading="lazy"
                  onError={() => setImageError(true)}
                  draggable={false}
                />
              </>
            ) : (
              <img
                src={thumbnailSrc}
                alt={item.title}
                className={styles.seriesThumbnail}
                loading="lazy"
                onError={() => setImageError(true)}
                draggable={false}
              />
            )
          ) : isAudioLayout ? (
            <div className={styles.seriesPlaceholderImageWrapper}>
              <img
                src="/audio-kumiho.png"
                alt=""
                className={styles.seriesPlaceholderImage}
                loading="lazy"
                draggable={false}
              />
            </div>
          ) : isTextFile ? (
            <div className={styles.seriesPlaceholderImageWrapper}>
              <img
                src="/reading-kumiho.png"
                alt=""
                className={styles.seriesPlaceholderImage}
                loading="lazy"
                draggable={false}
              />
            </div>
          ) : item.path?.toLowerCase().endsWith(".pdf") ? (
            <FileText
              className={styles.seriesIcon}
              size={48}
            />
          ) : (
            <BookOpen
              className={styles.seriesIcon}
              size={48}
            />
          )}

          <div className={styles.seriesHoverOverlay}>
            <button
              className={styles.seriesPlayButton}
              onClick={handlePlayClick}
              title={t("series.action.read_now")}
            >
              <Play
                size={24}
                fill="white"
              />
            </button>
          </div>

          {isCompleted && (
            <>
              <div className={styles.seriesCompletedOverlay} />
              <div className={styles.seriesCompletedBadge}>
                <CheckCircle2
                  size={28}
                  fill="#10B981"
                  color="white"
                  strokeWidth={1.5}
                />
              </div>
            </>
          )}

          {showOverlayProgress && (
            <div className={styles.seriesThumbnailProgressOverlay}>
              <div
                className={`${styles.seriesThumbnailProgressInfo} ${
                  showThumbnailExtensionBadge ? styles.withExtensionBadge : ""
                }`}
              >
                {showThumbnailExtensionBadge && (
                  <span className={`${styles.seriesExtensionBadge} ${styles.seriesExtensionBadgeOverlay}`}>
                    {extensionBadge}
                  </span>
                )}
                {!isCompleted && (
                  <span className={styles.seriesThumbnailProgressText}>{Math.floor(displayProgress)}%</span>
                )}
              </div>
              <div className={styles.seriesThumbnailProgressTrack}>
                <div
                  className={`${styles.seriesThumbnailProgressFill} ${isCompleted ? styles.completed : ""}`}
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
            </div>
          )}

          {showThumbnailExtensionBadge && !showOverlayProgress && (
            <div className={styles.seriesExtensionBadge}>{extensionBadge}</div>
          )}
        </div>

        {showMenu && (
          <div
            className={styles.seriesMenuWrapper}
            ref={menuRef}
          >
            <button
              className={styles.seriesMenuButton}
              onClick={handleMenuClick}
              title={t("series.card.menu_tooltip")}
            >
              <MoreVertical size={18} />
            </button>
            {menuOpen && (
              <div
                ref={dropdownRef}
                className={`${styles.seriesDropdownMenu} ${menuAlign === "left" ? styles.alignLeft : ""}`}
                style={menuMeasured ? undefined : { opacity: 0, pointerEvents: "none" }}
              >
                <button
                  className={styles.seriesMenuItem}
                  onClick={handleMarkAsRead}
                >
                  <BookCheck size={16} />
                  <span>{t("series.action.mark_completed")}</span>
                </button>
                {type === "volume" && !hideMarkPrevious && (
                  <button
                    className={styles.seriesMenuItem}
                    onClick={handleMarkPreviousAsRead}
                  >
                    <BookCheck size={16} />
                    <span>{t("series.action.mark_previous_completed")}</span>
                  </button>
                )}
                <button
                  className={styles.seriesMenuItem}
                  onClick={handleMarkAsUnread}
                >
                  <BookX size={16} />
                  <span>{t("series.action.mark_unread")}</span>
                </button>
                <button
                  className={styles.seriesMenuItem}
                  onClick={(e) => handlePlayClick(e, true)}
                >
                  <Shield size={16} />
                  <span>{t("series.action.incognito")}</span>
                </button>
                {onDownload && (
                  <button
                    className={styles.seriesMenuItem}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setMenuOpen(false);
                      onDownload();
                    }}
                  >
                    <Download size={16} />
                    <span>{t("series.action.download")}</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className={styles.seriesInfo}>
        <h3
          className={styles.seriesTitle}
          title={item.title}
        >
          {item.title}
        </h3>
        {displaySubtitle || isAudioLayout || showMetaExtensionBadge ? (
          <div
            className={`${styles.seriesMeta} ${!displaySubtitle && !isAudioLayout && showMetaExtensionBadge ? styles.seriesMetaOnlyBadge : ""}`}
          >
            {(displaySubtitle || isAudioLayout) && (
              <span className={styles.seriesMetaLeft}>
                {displaySubtitle && <span>{displaySubtitle}</span>}
                {isAudioLayout && (
                  <Music
                    size={14}
                    className={styles.audioIcon}
                    style={{ marginLeft: "4px", verticalAlign: "middle" }}
                  />
                )}
              </span>
            )}
            {showMetaExtensionBadge && (
              <span className={`${styles.seriesExtensionBadge} ${styles.seriesExtensionBadgeMeta}`}>
                {extensionBadge}
              </span>
            )}
          </div>
        ) : progressStyle === "bar" && displayProgress !== null ? (
          <div className={styles.seriesMeta}>
            <span>{Math.floor(displayProgress)}%</span>
          </div>
        ) : null}

        {progressStyle === "bar" && displayProgress !== null && (
          <div className={styles.seriesProgressTrack}>
            <div
              className={`${styles.seriesProgressFill} ${isCompleted ? styles.completed : ""}`}
              style={{ width: `${displayProgress}%` }}
            />
          </div>
        )}
      </div>
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
