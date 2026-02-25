import { useState, useRef, useEffect } from "react";
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
  // 계속 읽기 섹션용 추가 정보 (시리즈 모드일 때 사용함)
  chapterId?: string;
  volumeId?: string;
  onStatusChange?: () => void; // 상태 변경 시 부모 컴포넌트에 알림
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
  const [isUpdating, setIsUpdating] = useState(false);
  const [forceShowProgress, setForceShowProgress] = useState(false); // 애니메이션을 위해 0%일 때도 강제로 렌더링 유지
  const [imageError, setImageError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const setIncognito = useViewerStore((state) => state.setIncognito);

  // 명시적으로 전달된 progress가 있으면 사용하고,
  // 없으면 시리즈/볼륨의 페이지 수 정보로 계산
  let calculatedProgress = progress;
  if (calculatedProgress === undefined && item.read_page_count !== undefined && item.total_page_count !== undefined) {
    if (item.total_page_count > 0) {
      calculatedProgress = (item.read_page_count / item.total_page_count) * 100;
    } else if (item.total_page_count === 0 && item.read_page_count > 0) {
      // EPUB(total_page_count === 0)이고 read_page_count(percentage)가 있는 경우
      calculatedProgress = item.read_page_count;
    }
  }

  const validProgress =
    typeof calculatedProgress === "number"
      ? Math.min(100, Math.max(0, isNaN(calculatedProgress) ? 0 : calculatedProgress))
      : null;

  // 완독 상태 확인 (100% 도달 시)
  const isCompleted = validProgress !== null && validProgress >= 100;

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

  // 카드 클릭 처리
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
        // 볼륨 모드: 해당 볼륨의 첫 챕터(또는 이어보기 가능한 챕터)로 이동
        const chaptersRes = await volumeAPI.getChapters(item.id);
        const chapters = Array.isArray(chaptersRes.data) ? chaptersRes.data : chaptersRes.data.chapters || [];

        if (chapters.length > 0) {
          const sortedChapters = [...chapters].sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number);

          let targetChapter: Chapter | null = null;
          // 뒤에서부터 탐색
          for (let i = sortedChapters.length - 1; i >= 0; i--) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const ch = sortedChapters[i] as any;
            if (ch.reading_progress && ch.reading_progress.current_page > 0) {
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

      // 시리즈 모드
      // 2-1. 시리즈 진행도 조회
      const progressRes = await seriesAPI.getProgress(item.id);
      const targetProgress = progressRes.data?.progress;

      if (targetProgress && targetProgress.chapter_id) {
        navigate(`/viewer/${targetProgress.chapter_id}`);
        return;
      }

      // 2-2. 진행도가 없으면 첫 번째 볼륨 조회
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

  // 바로 읽기 버튼 클릭
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
    setForceShowProgress(true); // 애니메이션 시작 (0%에서 렌더링 유지)

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
    setForceShowProgress(true); // 애니메이션 시작 (100% -> 0% 과정 표시)

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
      onStatusChange?.();
    } catch (error) {
      console.error("Failed to mark as unread:", error);
    } finally {
      setForceShowProgress(false); // 초기화 완료 후 강제 표시 해제 (0% 뱃지 제거)
      setIsUpdating(false);
    }
  };

  // 메뉴 표시 여부: 항상 표시
  const showMenu = true;

  // 서브타이틀 결정
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
          {/* 호버 오버레이 */}
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

          {/* 완독 상태 오버레이 (썸네일 어둡게 + 좌측 상단 체크 아이콘) */}
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

          {/* 진행도 오버레이 (썸네일 하단) - overlay 스타일일 때만 표시 */}
          {progressStyle === "overlay" && validProgress !== null && (validProgress > 0 || forceShowProgress) && (
            <div className={styles.seriesThumbnailProgressOverlay}>
              <div className={styles.seriesThumbnailProgressInfo}>
                {!isCompleted && (
                  <span className={styles.seriesThumbnailProgressText}>{Math.floor(validProgress)}%</span>
                )}
              </div>
              <div className={styles.seriesThumbnailProgressTrack}>
                <div
                  className={`${styles.seriesThumbnailProgressFill} ${isCompleted ? styles.completed : ""}`}
                  style={{ width: `${validProgress}%` }}
                />
              </div>
            </div>
          )}
        </div>
        {/* 설정 메뉴 버튼 */}
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
            {/* 드롭다운 메뉴 */}
            {menuOpen && (
              <div className={styles.seriesDropdownMenu}>
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
        {/* 설명/메타 정보 표시 */}
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
        ) : progressStyle === "bar" && validProgress !== null ? (
          // bar 스타일인데 customSubtitle이 없으면 퍼센트 표시
          <div className={styles.seriesMeta}>
            <span>{Math.floor(validProgress)}%</span>
          </div>
        ) : null}

        {/* 진행도 바 (Bottom 스타일) */}
        {progressStyle === "bar" && validProgress !== null && (
          <div className={styles.seriesProgressTrack}>
            <div
              className={`${styles.seriesProgressFill} ${isCompleted ? styles.completed : ""}`}
              style={{ width: `${validProgress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
