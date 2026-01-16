import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { BookOpen, ArrowLeft, Folder, Play, CheckCircle, BookCheck, BookX } from "lucide-react";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { api, volumeAPI } from "../api/client";
import infoStyles from "../components/SeriesInfoCard.module.css";
import styles from "./Volume.module.css";

import type { Series, Volume, Chapter, ReadingProgress } from "../types/series";
import { AlertModal, type AlertType } from "../components/AlertModal";

export function VolumePage() {
  const { volumeId } = useParams<{ volumeId: string }>();
  const navigate = useNavigate();
  const [volume, setVolume] = useState<Volume | null>(null);
  const [series, setSeries] = useState<Series | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // 챕터 ID를 키로 하는 진행도 맵
  const [progressMap, setProgressMap] = useState<Record<string, ReadingProgress>>({});
  // 이 볼륨의 마지막 진행도 (이어보기용)
  const [lastProgress, setLastProgress] = useState<ReadingProgress | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [openingChapterId, setOpeningChapterId] = useState<string | null>(null);

  // 사이드바 상태
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 알림 모달 상태
  const [alertModal, setAlertModal] = useState<{
    isOpen: boolean;
    type: AlertType;
    message: string;
  }>({
    isOpen: false,
    type: "info",
    message: "",
  });

  // 확인 모달 상태
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

  const [isProcessing, setIsProcessing] = useState(false);

  const showAlert = (message: string, type: AlertType = "info") => {
    setAlertModal({ isOpen: true, type, message });
  };

  const closeAlert = () => {
    setAlertModal((prev) => ({ ...prev, isOpen: false }));
  };

  // 볼륨 완독 처리 실행
  const executeMarkComplete = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await volumeAPI.markComplete(volumeId!);
      showAlert("볼륨이 완독 처리되었습니다.", "success");
      loadData();
    } catch (error) {
      console.error("Failed to mark as complete:", error);
      showAlert("완독 처리에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 볼륨 완독 처리 확인
  const handleMarkComplete = () => {
    setConfirmModal({
      isOpen: true,
      type: "warning",
      title: "볼륨 완독 처리",
      message: "이 볼륨의 모든 챕터를 완독 상태로 표시합니다. 계속하시겠습니까?",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        executeMarkComplete();
      },
    });
  };

  // 볼륨 독서 기록 초기화 실행
  const executeResetProgress = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      await volumeAPI.deleteCompletion(volumeId!);
      showAlert("독서 기록이 초기화되었습니다.", "success");
      loadData();
    } catch (error) {
      console.error("Failed to reset progress:", error);
      showAlert("초기화에 실패했습니다.", "error");
    } finally {
      setIsProcessing(false);
    }
  };

  // 볼륨 독서 기록 초기화 확인
  const handleResetProgress = () => {
    setConfirmModal({
      isOpen: true,
      type: "warning",
      title: "독서 기록 초기화",
      message: "이 볼륨의 모든 독서 기록이 삭제됩니다. 이 작업은 되돌릴 수 없습니다. 계속하시겠습니까?",
      onConfirm: () => {
        setConfirmModal((prev) => ({ ...prev, isOpen: false }));
        executeResetProgress();
      },
    });
  };

  // 챕터 완료 여부 판단 (95% 이상 또는 마지막 페이지 도달)
  const isChapterCompleted = (p: ReadingProgress) => {
    return p.progress_percent > 95 || (p.total_pages > 0 && p.total_pages - p.current_page <= 1);
  };

  // 챕터 클릭 시 뷰어로 이동 (저장된 진행도에서 시작)
  const handleChapterClick = (chapter: Chapter, e: React.MouseEvent) => {
    e.preventDefault();
    setOpeningChapterId(chapter.id);

    // page 파라미터 없이 이동하면 Viewer에서 저장된 진행도를 자동으로 로드
    navigate(`/viewer/${chapter.id}`);
  };

  useEffect(() => {
    if (volumeId) loadData();
  }, [volumeId]);

  const loadData = async () => {
    try {
      // 볼륨 정보
      const volumeRes = await volumeAPI.get(volumeId!);
      setVolume(volumeRes.data);

      // 시리즈 정보
      if (volumeRes.data.series_id) {
        const seriesRes = await api.get(`/series/${volumeRes.data.series_id}`);
        setSeries(seriesRes.data);
      }

      // 읽기 진행도 (볼륨 내 모든 챕터)
      try {
        const progressRes = await volumeAPI.getProgress(volumeId!);
        const list: ReadingProgress[] = progressRes.data.progress_list || [];

        // 맵으로 변환
        const map: Record<string, ReadingProgress> = {};

        // 가장 최근 읽은 기록 찾기
        let latest: ReadingProgress | undefined = undefined;
        let latestTime = 0;

        list.forEach((p) => {
          if (p.chapter_id) {
            map[p.chapter_id] = p;

            // 최근 기록 갱신
            const time = new Date(p.updated_at).getTime();
            if (time > latestTime) {
              latestTime = time;
              latest = p;
            }
          }
        });

        setProgressMap(map);
        setLastProgress(latest);
      } catch (err) {
        console.warn("진행도 로드 실패:", err);
      }

      // 챕터 목록
      const chaptersRes = await volumeAPI.getChapters(volumeId!);
      const chapterList = chaptersRes.data.chapters || [];
      // 챕터 번호순 정렬
      setChapters(chapterList.sort((a: Chapter, b: Chapter) => a.chapter_number - b.chapter_number));
    } catch (error) {
      console.error("Failed to load volume:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <Header />
        <div className="loading-container">
          <div className="loading-spinner" />
          <p>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!volume) {
    return (
      <div className="page-container">
        <Header />
        <div className="error-container">
          <p>볼륨을 찾을 수 없습니다</p>
          <Link
            to="/"
            className="back-link"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  // 이어보기 또는 첫 챕터 읽기
  const handlePlay = () => {
    // 가장 최근 읽은 챕터가 있으면 거기로
    if (lastProgress && lastProgress.chapter_id) {
      navigate(`/viewer/${lastProgress.chapter_id}?page=${lastProgress.current_page}`);
      return;
    }

    // 진행도가 없으면 첫 챕터 읽기
    if (chapters.length > 0) {
      navigate(`/viewer/${chapters[0].id}`);
    } else {
      showAlert("읽을 수 있는 챕터가 없습니다.", "warning");
    }
  };

  // 썸네일 URL
  const getThumbnailUrl = () => {
    // 볼륨 썸네일 우선 사용, 없으면 시리즈 썸네일 사용 (Backend에서 URL 처리됨)
    const url = volume.thumbnail_url || series?.thumbnail_url;
    if (!url) return null;
    const token = localStorage.getItem("access_token");
    if (!token) return url;
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}token=${token}`;
  };

  return (
    <div className={`page-container page-with-sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Header onMenuClick={() => setSidebarOpen(true)} />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        refreshKey={0}
        onAddLibrary={() => showAlert("라이브러리 페이지에서만 추가할 수 있습니다.", "info")}
      />

      {/* 서브 헤더 (뒤로가기, 브레드크럼) */}
      <div className={styles.subHeader}>
        <div className={styles.subHeaderLeft}>
          <Link
            to={series ? `/series/${series.id}` : "/"}
            className={styles.backButton}
          >
            <ArrowLeft size={16} /> 뒤로
          </Link>
          <div className={styles.breadcrumb}>
            {series && (
              <>
                <Link
                  to={`/series/${series.id}`}
                  className={styles.breadcrumbLink}
                >
                  <Folder size={14} /> {series.title}
                </Link>
                <span className={styles.breadcrumbSeparator}>/</span>
              </>
            )}
            <span className={styles.breadcrumbCurrent}>{volume.title}</span>
          </div>
        </div>
      </div>

      <div
        className={styles.pageContentWrapper}
        style={{ maxWidth: "1200px", margin: "0 auto", padding: "0 2rem 2rem 2rem" }}
      >
        {/* 볼륨 정보 헤더 (SeriesInfoCard 스타일) */}
        <div
          className={infoStyles.seriesInfoCard}
          style={{ marginBottom: "3rem" }}
        >
          {/* 볼륨 카드 배경 블러 이미지 영역 */}
          <div className={infoStyles.seriesBackdrop}>
            {getThumbnailUrl() && (
              <img
                src={getThumbnailUrl()!}
                alt=""
                className={infoStyles.seriesBackdropImage}
              />
            )}
          </div>

          <div className={infoStyles.seriesThumbnailContainer}>
            {getThumbnailUrl() ? (
              <img
                src={getThumbnailUrl()!}
                alt={volume.title}
                className={infoStyles.seriesThumbnail}
              />
            ) : (
              <div className={infoStyles.seriesThumbnailPlaceholder}>
                <BookOpen size={48} />
              </div>
            )}
            <div className={`${infoStyles.seriesStatusBadge} ${infoStyles.statusONGOING}`}>
              {volume.volume_number}권
            </div>
          </div>

          <div className={infoStyles.seriesContent}>
            <div className={infoStyles.seriesHeader}>
              <h1>{volume.title}</h1>
              <div className={infoStyles.seriesMeta}>
                <span>{chapters.length}화</span>
                {series?.authors && <span>• {series.authors}</span>}
              </div>
            </div>

            <div className={infoStyles.seriesProgressSection}>
              <div className={infoStyles.progressLabels}>
                <span>
                  {(() => {
                    // 총 페이지: 모든 챕터의 page_count 합계
                    const totalPages = chapters.reduce((sum, ch) => sum + (ch.page_count || 0), 0);
                    // 읽은 페이지: 각 챕터의 current_page 합계
                    const readPages = Object.values(progressMap).reduce((sum, p) => sum + (p.current_page || 0), 0);
                    return readPages > 0 ? `${readPages} / ${totalPages}p 읽음` : "읽지 않음";
                  })()}
                </span>
              </div>
              <div className={infoStyles.progressBarBg}>
                <div
                  className={infoStyles.progressBarFill}
                  style={{
                    width: `${(() => {
                      const totalPages = chapters.reduce((sum, ch) => sum + (ch.page_count || 0), 0);
                      const readPages = Object.values(progressMap).reduce((sum, p) => sum + (p.current_page || 0), 0);
                      return totalPages > 0 ? (readPages / totalPages) * 100 : 0;
                    })()}%`,
                  }}
                />
              </div>
            </div>

            <div className={infoStyles.seriesActions}>
              <button
                className={`${infoStyles.btnAction} ${infoStyles.btnPrimary}`}
                onClick={handlePlay}
              >
                <Play
                  size={20}
                  fill="currentColor"
                />
                {lastProgress ? "이어보기" : "읽기 시작"}
              </button>
              <button
                className={`${infoStyles.btnAction} ${infoStyles.btnSecondary}`}
                onClick={handleMarkComplete}
                disabled={isProcessing}
                title="볼륨을 완독 상태로 표시"
                aria-label="볼륨 전체를 완독 상태로 표시"
              >
                <BookCheck size={20} />
                완독
              </button>
              <button
                className={`${infoStyles.btnAction} ${infoStyles.btnSecondary}`}
                onClick={handleResetProgress}
                disabled={isProcessing}
                title="진행도 및 완독 상태 초기화"
                aria-label="볼륨 전체 독서 기록 초기화"
              >
                <BookX size={20} />
                독서 초기화
              </button>
            </div>
          </div>
        </div>

        {/* 챕터 목록 */}
        <main className={styles.volumeMain}>
          <div className={styles.chapterCount}>
            총 <strong>{chapters.length}</strong>화
          </div>

          {chapters.length === 0 ? (
            <div className={styles.emptyState}>
              <p>스캔된 챕터가 없습니다</p>
            </div>
          ) : (
            <div className={styles.chapterList}>
              {chapters.map((chapter) => {
                const chapterProgress = progressMap[chapter.id];
                const isCurrentChapter = lastProgress?.chapter_id === chapter.id;
                const isComplete = chapterProgress && isChapterCompleted(chapterProgress);

                // 챕터 썸네일 URL
                const getChapterThumb = () => {
                  if (!chapter.thumbnail_url) return null;
                  const token = localStorage.getItem("access_token");
                  if (!token) return chapter.thumbnail_url;
                  const separator = chapter.thumbnail_url.includes("?") ? "&" : "?";
                  return `${chapter.thumbnail_url}${separator}token=${token}`;
                };

                return (
                  <div
                    key={chapter.id}
                    className={`${styles.chapterItem} ${openingChapterId === chapter.id ? styles.loading : ""} ${
                      isCurrentChapter ? styles.current : ""
                    }`}
                    onClick={(e) => handleChapterClick(chapter, e)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) =>
                      e.key === "Enter" && handleChapterClick(chapter, e as unknown as React.MouseEvent)
                    }
                  >
                    <div className={styles.chapterThumbnailWrapper}>
                      {getChapterThumb() ? (
                        <img
                          src={getChapterThumb()!}
                          alt=""
                          className={styles.chapterThumbnail}
                        />
                      ) : (
                        <div className={styles.chapterThumbnailPlaceholder}>
                          <BookOpen size={20} />
                        </div>
                      )}
                    </div>
                    <div className={styles.chapterInfo}>
                      <span className={styles.chapterNumber}>{chapter.chapter_number}화</span>
                      <span className={styles.chapterTitle}>{chapter.title}</span>
                      <span className={styles.chapterPages}>{chapter.page_count}p</span>
                    </div>
                    <div className={styles.chapterStatus}>
                      {isComplete && (
                        <CheckCircle
                          size={18}
                          className={styles.completeIcon}
                        />
                      )}
                      {chapterProgress && !isComplete && (
                        <span className={styles.progressBadge}>
                          {chapterProgress.current_page}/{chapterProgress.total_pages}
                        </span>
                      )}
                      {openingChapterId === chapter.id ? (
                        <div className={`${styles.loadingSpinner} ${styles.small}`} />
                      ) : (
                        <Play
                          size={18}
                          className={styles.playIcon}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      <AlertModal
        isOpen={alertModal.isOpen}
        type={alertModal.type}
        message={alertModal.message}
        onConfirm={closeAlert}
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
