import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
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
import type { Chapter, Series, Volume } from "../types/series";
import { useViewerStore } from "../stores/viewerStore";
import styles from "./SeriesCard.module.css";

export interface SeriesCardProps {
  item: Series | Volume;
  type?: "series" | "volume";
  customSubtitle?: string;
  progress?: number;
  chapterId?: string;
  volumeId?: string;
  onStatusChange?: () => void | Promise<void>;
  progressStyle?: "overlay" | "bar";
  onDownload?: () => void;
}

export function SeriesCard({
  item,
  type = "series",
  customSubtitle,
  progress,
  chapterId,
  volumeId,
  onStatusChange,
  progressStyle = "bar",
  onDownload,
}: SeriesCardProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
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
  const setIncognito = useViewerStore((state) => state.setIncognito);

  let calculatedProgress = progress;
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
    completionFromItem !== undefined ? completionFromItem : displayProgress !== null && displayProgress >= 100;
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

  const playSmart = async () => {
    setIsUpdating(true);
    try {
      if (type === "volume") {
        const chaptersRes = await volumeAPI.getChapters(item.id);
        const chapters = Array.isArray(chaptersRes.data) ? chaptersRes.data : chaptersRes.data.chapters || [];

        if (chapters.length > 0) {
          const sortedChapters = [...chapters].sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number);

          let targetChapter: Chapter | null = null;
          for (let i = sortedChapters.length - 1; i >= 0; i--) {
            const ch = sortedChapters[i] as Chapter & { reading_progress?: { current_page?: number } };
            if (ch.reading_progress && (ch.reading_progress.current_page || 0) > 0) {
              targetChapter = sortedChapters[i];
              break;
            }
          }

          navigate(`/viewer/${targetChapter?.id || sortedChapters[0].id}`);
        } else {
          navigate(`/volumes/${item.id}`);
        }
        return;
      }

      const progressRes = await seriesAPI.getProgress(item.id);
      const targetProgress = progressRes.data?.progress;

      if (targetProgress && targetProgress.chapter_id) {
        navigate(`/viewer/${targetProgress.chapter_id}`);
        return;
      }

      const volumesRes = await seriesAPI.getVolumes(item.id);
      const volumes = volumesRes.data.volumes || [];

      if (volumes.length === 0) {
        navigate(`/series/${item.id}`);
        return;
      }

      const sortedVolumes = [...volumes].sort((a: Volume, b: Volume) => a.volume_number - b.volume_number);
      const firstVolume = sortedVolumes[0];

      const chaptersRes = await volumeAPI.getChapters(firstVolume.id);
      const chapters = Array.isArray(chaptersRes.data) ? chaptersRes.data : chaptersRes.data.chapters || [];

      if (chapters.length > 0) {
        const sortedChapters = [...chapters].sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number);
        navigate(`/viewer/${sortedChapters[0].id}`);
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

    if (incognito) {
      setIncognito(true);
    }

    if (chapterId && type === "series") {
      navigate(`/viewer/${chapterId}`);
    } else {
      await playSmart();
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
    } catch (error) {
      console.error("Failed to mark as read:", error);
      setOptimisticCompleted(null);
      setOptimisticProgress(null);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMarkAsUnread = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
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
    } catch (error) {
      console.error("Failed to mark as unread:", error);
      setOptimisticCompleted(null);
      setOptimisticProgress(null);
    } finally {
      setForceShowProgress(false);
      setIsUpdating(false);
    }
  };

  const showMenu = true;

  let displaySubtitle = customSubtitle;
  if (!displaySubtitle && type === "volume" && "volume_number" in item) {
    if ((item as Volume).unit === "chapter") {
      displaySubtitle = t("series.unit.chapter", { count: item.volume_number });
    } else {
      displaySubtitle = t("series.unit.volume", { count: item.volume_number });
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
            <img
              src={getAuthenticatedImageUrl(item.thumbnail_url)}
              alt={item.title}
              className={styles.seriesThumbnail}
              loading="lazy"
              onError={() => setImageError(true)}
            />
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

          {progressStyle === "overlay" && displayProgress !== null && (displayProgress > 0 || forceShowProgress) && (
            <div className={styles.seriesThumbnailProgressOverlay}>
              <div className={styles.seriesThumbnailProgressInfo}>
                {!isCompleted && <span className={styles.seriesThumbnailProgressText}>{Math.floor(displayProgress)}%</span>}
              </div>
              <div className={styles.seriesThumbnailProgressTrack}>
                <div
                  className={`${styles.seriesThumbnailProgressFill} ${isCompleted ? styles.completed : ""}`}
                  style={{ width: `${displayProgress}%` }}
                />
              </div>
            </div>
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
        {displaySubtitle ? (
          <div className={styles.seriesMeta}>
            <span>{displaySubtitle}</span>
            {"has_audio" in item && item.has_audio && (
              <Music
                size={14}
                className={styles.audioIcon}
                style={{ marginLeft: "4px", verticalAlign: "middle" }}
              />
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
    </div>
  );
}
