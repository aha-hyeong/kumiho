// 뷰어 페이지 - 리팩토링된 버전
// 훅과 컴포넌트로 로직과 UI를 분리하여 유지보수성 향상

import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useViewerStore } from "../stores/viewerStore";
import { enterFullscreen, exitFullscreen, isFullscreen as isDocumentFullscreen } from "../utils/fullscreen";
import { ViewerSettings as ViewerSettingsModal } from "../components/viewer/ViewerSettings";

// Feature imports
import {
  useChapterLoader,
  useBGM,
  useImagePreloader,
  useAdjacentChapters,
  useProgress,
  useViewerNavigation,
  useVerticalScroll,
  ViewerHeader,
  ViewerFooter,
  ChapterNavHint,
  PullIndicator,
  PageJumpModal,
  ViewerContent,
  UI_HIDE_DELAY,
  useNextChapterPreloader,
  useProgressSync,
  SyncConfirmModal,
} from "../features/viewer";
import { useViewerWS } from "../hooks/useViewerWS";
import { useReadingTime } from "../hooks/useReadingTime";
import { AlertModal } from "../components/modals/AlertModal";
import type { ViewerAnimationHandles } from "../features/viewer/types";
import { useTranslation } from "react-i18next";

import { getDisplayPages, getPrevTargetPage, getNextTargetPage } from "../utils/pageCalculator";
import styles from "./Viewer.module.css";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();

  // 뷰어 스토어
  const {
    currentPage,
    totalPages,
    isUIVisible,
    isSettingsOpen,
    isFullscreen,
    settings,
    goToPage,
    toggleSettings,
    closeSettings,
    setFullscreen,
    setReadingMode,
    togglePageOffset,
    isIncognito,
    setCurrentPage,
  } = useViewerStore();
  const { t } = useTranslation();
  const navigate = useNavigate();

  // ===== Custom Hooks =====

  // 챕터 로딩
  const { chapter, isLoading, error, seriesId, volumeId, pageMetaMap, isInitialScrollingRef } = useChapterLoader({
    chapterId,
  });

  // 인접 챕터 탐색
  const { nextChapterId, prevChapterId, nextChapterTitle, prevChapterTitle, isLastChapterOfVolume } =
    useAdjacentChapters({ volumeId, chapterId, seriesId });

  // 이미지 프리로딩
  const { imageLoading, handleImageLoad, maxAllowedPage } = useImagePreloader({
    chapter,
    chapterId,
    currentPage,
    totalPages,
    preloadCount: settings.preloadCount,
    readingMode: settings.readingMode,
  });

  // BGM 제어
  const isBgmReady = !isLoading && imageLoading[currentPage] === false;
  const { bgmInfo, isBgmPlaying, setIsBgmPlaying, audioRef } = useBGM({
    volumeId,
    chapterId,
    isReady: isBgmReady,
  });

  // 진행도 저장
  const { saveProgress, handleVolumeCompletion } = useProgress({
    seriesId,
    chapterId,
    chapter,
    currentPage,
    totalPages,
    isLoading,
    isIncognito,
    isLastChapterOfVolume,
    isInitialScrollingRef,
  });

  // 진행도 동기화
  const { showSyncModal, serverProgress, handleConfirmSync, handleCloseModal } = useProgressSync({
    seriesId,
    chapter,
    currentPage,
    isLoading,
  });

  // 세로 스크롤 (vertical 모드)
  const { pullOffset, viewerContentRef, isTouching } = useVerticalScroll({
    readingMode: settings.readingMode,
    isLoading,
    currentPage,
    totalPages,
    nextChapterId,
    prevChapterId,
    pullThreshold: settings.pullThreshold,
    pullSensitivity: settings.pullSensitivity,
    saveProgress,
    handleVolumeCompletion,
    chapterId,
    isInitialScrollingRef,
  });

  // 전체화면 토글 핸들러
  const handleToggleFullscreen = useCallback(() => {
    try {
      if (!isDocumentFullscreen()) {
        enterFullscreen().catch(() => {});
      } else {
        exitFullscreen().catch(() => {});
      }
    } catch (err) {
      console.error("Fullscreen toggle failed:", err);
    }
  }, []);

  // ===== Zoom & Click Logic =====
  // Handled inside ViewerContent

  // Animation Ref for Keyboard Navigation
  const animationRef = useRef<ViewerAnimationHandles>(null);

  // 네비게이션
  const { handleNext, handlePrev, handleBack, showNextHint, showPrevHint } = useViewerNavigation({
    currentPage,
    totalPages,
    readingMode: settings.readingMode,
    clickDirection: settings.clickDirection,
    keyboardDirection: settings.keyboardDirection,
    pageOffset: settings.pageOffset,
    pageMetaMap,
    nextChapterId,
    prevChapterId,
    saveProgress,
    isSettingsOpen,
    closeSettings,
    handleToggleFullscreen,
    animationRef: animationRef as React.RefObject<ViewerAnimationHandles>,
  });

  // 다음 챕터 프리로딩
  // 현재 챕터의 첫 3페이지가 로딩되었거나, 전체 페이지가 적을 경우 로딩 완료로 간주
  const isCurrentChapterLoaded =
    !isLoading &&
    chapter &&
    (imageLoading[1] === false || (chapter.page_count > 0 && imageLoading[chapter.page_count] === false));

  useNextChapterPreloader({
    nextChapterId,
    currentChapterId: chapterId,
    isCurrentChapterLoaded: !!isCurrentChapterLoaded,
    preloadCount: 5,
  });

  // 웹소켓 실시간 동기화 및 중복 세션 제어
  const { terminatedInfo } = useViewerWS({ seriesId: seriesId || "", chapterId, currentPage });

  // 세션 종료 핸들러
  const handleTerminatedConfirm = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // 읽기 시간 측정 (활성화)
  useReadingTime(seriesId || undefined, !isLoading && !error, chapterId);

  // ===== Zoom & Click Logic =====
  // Handled inside ViewerContent

  // Local State for Page Jump Modal
  const [showPageJump, setShowPageJump] = useState(false);

  // 브라우저 전체화면 상태와 스토어 동기화
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isActuallyFullscreen = isDocumentFullscreen();
      if (isFullscreen !== isActuallyFullscreen) {
        setFullscreen(isActuallyFullscreen);
      }
    };

    const events = ["fullscreenchange", "webkitfullscreenchange", "mozfullscreenchange", "MSFullscreenChange"];
    events.forEach((event) => document.addEventListener(event, handleFullscreenChange));

    return () => {
      events.forEach((event) => document.removeEventListener(event, handleFullscreenChange));
    };
  }, [isFullscreen, setFullscreen]);

  // 뷰어 종료 시 전체화면 해제
  useEffect(() => {
    return () => {
      if (isDocumentFullscreen()) {
        exitFullscreen().catch(() => {});
      }
    };
  }, []);

  // UI 자동 숨김 타이머
  useEffect(() => {
    let hideTimer: number | null = null;

    if (isUIVisible && !isSettingsOpen) {
      hideTimer = window.setTimeout(() => {
        useViewerStore.getState().hideUI();
      }, UI_HIDE_DELAY);
    }

    return () => {
      if (hideTimer) {
        clearTimeout(hideTimer);
      }
    };
  }, [isUIVisible, isSettingsOpen, currentPage]);

  // 표시할 페이지 계산
  const displayPages = getDisplayPages({
    currentPage,
    totalPages,
    readingMode: settings.readingMode,
    pageOffset: settings.pageOffset,
    pageMetaMap,
  });

  // 이전 뷰의 '기준 페이지'를 구하고 그 페이지의 디스플레이 셋을 구함
  const prevTargetPage = getPrevTargetPage(currentPage, settings.readingMode, pageMetaMap);
  const prevDisplayPages =
    prevTargetPage !== -1
      ? getDisplayPages({
          currentPage: prevTargetPage,
          totalPages,
          readingMode: settings.readingMode,
          pageOffset: settings.pageOffset,
          pageMetaMap: pageMetaMap,
        })
      : [];

  const nextTargetPage = getNextTargetPage(currentPage, totalPages, settings.readingMode, pageMetaMap);
  // nextTargetPage가 totalPages를 넘어가면 -1이 아니라, 범위를 벗어난 값이 나옴. getDisplayPages 내부에서 처리하거나 체크 필요.
  const nextDisplayPages =
    nextTargetPage !== -1
      ? getDisplayPages({
          currentPage: nextTargetPage,
          totalPages,
          readingMode: settings.readingMode,
          pageOffset: settings.pageOffset,
          pageMetaMap,
        })
      : [];

  return (
    <div
      className={styles.viewerContainer}
      style={{ background: settings.backgroundColor }}
    >
      {/* BGM Audio Element - Rendered as early as possible to capture interactions */}
      {bgmInfo?.exists && bgmInfo.url && (
        <audio
          ref={audioRef}
          src={bgmInfo.url}
          playsInline
        />
      )}

      {isLoading ? (
        <div className={styles.viewerContent}>
          <div className={styles.pageLoading}>
            <div className={styles.spinner} />
          </div>
        </div>
      ) : error || !chapter ? (
        <div className={styles.viewerContent}>
          <div style={{ color: "white", textAlign: "center" }}>
            <p>{error || "챕터를 찾을 수 없습니다."}</p>
            <button
              onClick={handleBack}
              style={{ marginTop: 16, color: "white" }}
            >
              돌아가기
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 상단 바 */}
          <ViewerHeader
            title={chapter.title}
            currentPage={currentPage}
            totalPages={totalPages}
            isUIVisible={isUIVisible}
            isIncognito={isIncognito}
            isFullscreen={isFullscreen}
            bgmInfo={bgmInfo}
            isBgmPlaying={isBgmPlaying}
            onBack={handleBack}
            onToggleFullscreen={handleToggleFullscreen}
            onToggleSettings={toggleSettings}
            onToggleBgm={() => setIsBgmPlaying(!isBgmPlaying)}
          />

          {/* 세로 모드 당김 인디케이터 */}
          {settings.readingMode === "vertical" && (
            <>
              <PullIndicator
                type="prev"
                pullOffset={pullOffset}
                pullThreshold={settings.pullThreshold}
                showThreshold={settings.showThreshold}
                chapterId={prevChapterId}
                chapterTitle={prevChapterTitle}
                saveProgress={saveProgress}
              />
              <PullIndicator
                type="next"
                pullOffset={pullOffset}
                pullThreshold={settings.pullThreshold}
                showThreshold={settings.showThreshold}
                chapterId={nextChapterId}
                chapterTitle={nextChapterTitle}
                saveProgress={saveProgress}
              />
            </>
          )}

          {/* 이미지 영역 */}
          <div
            ref={viewerContentRef}
            className={`${styles.viewerContent} ${styles[`mode${settings.readingMode.charAt(0).toUpperCase() + settings.readingMode.slice(1)}`]} ${styles[`direction${settings.readingDirection.charAt(0).toUpperCase() + settings.readingDirection.slice(1)}`]}`}
            style={{
              background: settings.backgroundColor,
              transform: settings.readingMode === "vertical" ? `translateY(${pullOffset * 0.3}px)` : "none",
              transition: !isTouching && pullOffset === 0 ? "transform 0.4s cubic-bezier(0.2, 0, 0.2, 1)" : "none",
              willChange: "transform",
            }}
          >
            <ViewerContent
              ref={animationRef}
              readingMode={settings.readingMode}
              readingDirection={settings.readingDirection}
              swipeDirection={settings.swipeDirection}
              clickDirection={settings.clickDirection}
              fitMode={settings.fitMode}
              displayPages={displayPages}
              prevDisplayPages={prevDisplayPages}
              nextDisplayPages={nextDisplayPages}
              chapterId={chapter.id}
              totalPages={totalPages}
              maxAllowedPage={maxAllowedPage}
              imageLoading={imageLoading}
              handleImageLoad={handleImageLoad}
              onNext={handleNext}
              onPrev={handlePrev}
            />
          </div>

          {/* 하단 바 */}
          <ViewerFooter
            currentPage={currentPage}
            totalPages={totalPages}
            isUIVisible={isUIVisible}
            readingMode={settings.readingMode}
            pageOffset={settings.pageOffset}
            seriesId={seriesId}
            nextChapterId={nextChapterId}
            onPrev={handlePrev}
            onNext={handleNext}
            onGoToPage={goToPage}
            onSliderChange={(e) => setCurrentPage(parseInt(e.target.value, 10))}
            onPageJumpClick={() => setShowPageJump(true)}
            onReadingModeChange={setReadingMode}
            onTogglePageOffset={togglePageOffset}
          />

          {/* 설정 모달 */}
          {isSettingsOpen && <ViewerSettingsModal onClose={closeSettings} />}

          {/* 페이지 점프 모달 */}
          <PageJumpModal
            show={showPageJump}
            totalPages={totalPages}
            onClose={() => setShowPageJump(false)}
            onJump={goToPage}
          />

          {/* 챕터 이동 힌트 */}
          <ChapterNavHint
            type="next"
            title={nextChapterTitle || ""}
            show={showNextHint && !!nextChapterTitle}
          />
          <ChapterNavHint
            type="prev"
            title={prevChapterTitle || ""}
            show={showPrevHint && !!prevChapterTitle}
          />

          {/* 진행도 동기화 모달 */}
          <SyncConfirmModal
            show={showSyncModal}
            serverProgress={serverProgress}
            onConfirm={handleConfirmSync}
            onClose={handleCloseModal}
          />

          {/* 세션 강제 종료 알림 모달 */}
          <AlertModal
            isOpen={terminatedInfo.isOpen}
            type="warning"
            title={t("viewer.session.force_logout_title")}
            message={terminatedInfo.reason}
            onConfirm={handleTerminatedConfirm}
          />
        </>
      )}
    </div>
  );
}
