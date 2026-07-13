// 뷰어 네비게이션 훅 (키보드, 클릭, 페이지 이동)

import { useEffect, useCallback, useState, useRef, useMemo, type RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useViewerStore } from "../../../stores/viewerStore";
import { isFullscreen as isDocumentFullscreen, isFullscreenToggleShortcut } from "../../../utils/fullscreen";
import { startChapterSwitching } from "../../../stores/fullscreenSwitchStore";
import { buildViewerRouteState } from "../../../utils/viewerRouteState";
import type { PageMeta } from "../types";
import type { ReadingDirection, ReadingMode, SubPage } from "../../../stores/viewerStore";
import { getNextNavState, getPrevNavState } from "../../../utils/pageCalculator";

import type { ViewerAnimationHandles } from "../types";

interface UseViewerNavigationParams {
  currentPage: number;
  totalPages: number;
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  keyboardDirection: ReadingDirection;
  pageOffset: number;
  pageMetaMap: Map<number, PageMeta>;
  subPage: SubPage;
  setSubPage: (subPage: SubPage) => void;
  nextChapterId: string | null;
  prevChapterId: string | null;
  saveProgress: () => Promise<void>;
  isSettingsOpen: boolean;
  closeSettings: () => void;
  handleToggleFullscreen: () => void;
  animationRef?: RefObject<ViewerAnimationHandles>;
  currentChapterId: string | undefined;
  onReachedSeriesEnd?: () => void;
}

interface UseViewerNavigationReturn {
  handleNext: () => Promise<void>;
  handlePrev: () => Promise<void>;
  handleBack: () => void;
  showNextHint: boolean;
  showPrevHint: boolean;
  /** 마지막 페이지에서 다음 챕터로 넘어갈 수 있는 상태 */
  canGoNextChapter: boolean;
  /** 첫 페이지에서 이전 챕터로 넘어갈 수 있는 상태 */
  canGoPrevChapter: boolean;
}

/**
 * 뷰어 네비게이션 로직을 관리하는 커스텀 훅
 * - 다음/이전 페이지 이동
 * - 키보드 단축키 처리
 * - 클릭 영역 처리
 * - 챕터 이동 힌트 표시
 */
export function useViewerNavigation({
  currentPage,
  totalPages,
  readingMode,
  readingDirection,
  keyboardDirection,
  pageOffset,
  pageMetaMap,
  subPage,
  setSubPage,
  nextChapterId,
  prevChapterId,
  saveProgress,
  isSettingsOpen,
  closeSettings,
  handleToggleFullscreen,
  animationRef,
  currentChapterId,
  onReachedSeriesEnd,
}: UseViewerNavigationParams): UseViewerNavigationReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const { goToPage } = useViewerStore();
  const viewerFrom = typeof location.state?.from === "string" ? location.state.from : undefined;
  const routeIsIncognito = location.state?.isIncognito === true;

  /*
   * 힌트 상태를 boolean이 아닌 '힌트가 발동된 챕터 ID'로 관리합니다.
   * 이렇게 하면 챕터가 변경되었을 때(currentChapterId 변경) 별도의 useEffect 없이도
   * 자동으로 힌트 상태가 초기화(불일치)되는 효과를 얻을 수 있습니다.
   */
  const [nextHintTriggeredChapterId, setNextHintTriggeredChapterId] = useState<string | null>(null);
  const [prevHintTriggeredChapterId, setPrevHintTriggeredChapterId] = useState<string | null>(null);

  // 현재 챕터에서 발동된 힌트인지 확인 (Derived State)
  const showNextHint = nextHintTriggeredChapterId === currentChapterId;
  const showPrevHint = prevHintTriggeredChapterId === currentChapterId;
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
  }, []);

  // 현재 챕터의 페이지/챕터 경계 여부 (애니메이션 억제용)
  // single 모드에서는 wide 이미지의 subPage 이동이 남아 있을 수 있으므로
  // getNextNavState / getPrevNavState 결과를 함께 고려한다.
  const canGoNextChapter = useMemo(() => {
    if (totalPages <= 0 || !nextChapterId) return false;
    if (readingMode === "single") {
      const navState = getNextNavState(currentPage, totalPages, subPage, pageMetaMap, readingDirection);
      return navState === null;
    }
    return currentPage >= totalPages;
  }, [currentPage, totalPages, readingMode, readingDirection, pageMetaMap, subPage, nextChapterId]);

  const canGoPrevChapter = useMemo(() => {
    if (totalPages <= 0 || !prevChapterId) return false;
    if (readingMode === "single") {
      const navState = getPrevNavState(currentPage, subPage, pageMetaMap, readingDirection);
      return navState === null;
    }
    return currentPage <= 1;
  }, [currentPage, totalPages, readingMode, readingDirection, pageMetaMap, subPage, prevChapterId]);

  // 다음 페이지/챕터 핸들러
  const handleNext = useCallback(async () => {
    // PDF가 아직 로딩 중이면 네비게이션 무시 (totalPages=0일 때 "책 끝남" 오판 방지)
    if (totalPages <= 0) return;

    // single 모드 스프레드 분할 처리
    if (readingMode === "single") {
      const navState = getNextNavState(currentPage, totalPages, subPage, pageMetaMap, readingDirection);
      if (navState) {
        if (navState.page !== currentPage) {
          goToPage(navState.page);
        }
        setSubPage(navState.subPage);
        return;
      }
      // navState가 null이면 마지막 페이지의 마지막 subPage → 챕터 끝 처리로 fall through
    }

    if (currentPage < totalPages) {
      // 2장 보기 모드일 때 오프셋 설정에 따라 이동 간격(step) 계산
      let step = 1;
      if (readingMode === "double") {
        // wide 페이지 체크
        const currentMeta = pageMetaMap.get(currentPage);
        const nextMeta = pageMetaMap.get(currentPage + 1);

        if (currentMeta?.isWide || nextMeta?.isWide) {
          step = 1;
        } else {
          // 기본 이동 간격 계산
          step = pageOffset === 1 && currentPage === 1 ? 1 : 2;
        }
      }
      goToPage(currentPage + step);
    } else {
      // 마지막 페이지
      if (showNextHint && nextChapterId) {
        // 이미 힌트가 떠있으면 이동 전 현재 진행도 즉시 저장
        await saveProgress();
        startChapterSwitching(isDocumentFullscreen());
        navigate(`/viewer/${nextChapterId}`, {
          replace: true,
          state: buildViewerRouteState({ from: viewerFrom, isIncognito: routeIsIncognito }),
        });
      } else if (nextChapterId) {
        // 기존 타이머 정리
        if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);

        // 힌트 표시 (현재 챕터 ID 저장)
        setNextHintTriggeredChapterId(currentChapterId || null);
        // 3초 후 힌트 사라짐
        hintTimeoutRef.current = setTimeout(() => {
          setNextHintTriggeredChapterId(null);
          hintTimeoutRef.current = null;
        }, 3000);
      } else {
        onReachedSeriesEnd?.();
      }
    }
  }, [
    currentPage,
    totalPages,
    goToPage,
    showNextHint,
    nextChapterId,
    navigate,
    saveProgress,
    readingMode,
    readingDirection,
    pageOffset,
    pageMetaMap,
    subPage,
    setSubPage,
    currentChapterId,
    onReachedSeriesEnd,
    viewerFrom,
    routeIsIncognito,
  ]);

  // 이전 페이지/챕터 핸들러
  const handlePrev = useCallback(async () => {
    // PDF가 아직 로딩 중이면 네비게이션 무시
    if (totalPages <= 0) return;

    // single 모드 스프레드 분할 처리
    if (readingMode === "single") {
      const navState = getPrevNavState(currentPage, subPage, pageMetaMap, readingDirection);
      if (navState) {
        if (navState.page !== currentPage) {
          goToPage(navState.page);
        }
        setSubPage(navState.subPage);
        return;
      }
      // navState가 null이면 첫 페이지의 첫 subPage → 이전 챕터 처리로 fall through
    }

    if (currentPage > 1) {
      // 2장 보기 모드일 때 오프셋 설정에 따라 이동 간격(step) 계산
      let step = 1;
      if (readingMode === "double") {
        // wide 페이지 체크
        const currentMeta = pageMetaMap.get(currentPage);
        const prevMeta = pageMetaMap.get(currentPage - 1);

        if (currentMeta?.isWide || prevMeta?.isWide) {
          step = 1;
        } else {
          // 기본 이동 간격 계산
          step = pageOffset === 1 && currentPage === 2 ? 1 : 2;
        }
      }
      goToPage(currentPage - step);
    } else {
      // 첫 페이지
      if (showPrevHint && prevChapterId) {
        await saveProgress();
        startChapterSwitching(isDocumentFullscreen());
        navigate(`/viewer/${prevChapterId}`, {
          replace: true,
          state: buildViewerRouteState({
            from: viewerFrom,
            isIncognito: routeIsIncognito,
            preventComplete: true,
          }),
        });
      } else if (prevChapterId) {
        // 기존 타이머 정리
        if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);

        setPrevHintTriggeredChapterId(currentChapterId || null);
        hintTimeoutRef.current = setTimeout(() => {
          setPrevHintTriggeredChapterId(null);
          hintTimeoutRef.current = null;
        }, 3000);
      }
    }
  }, [
    currentPage,
    totalPages,
    goToPage,
    showPrevHint,
    prevChapterId,
    navigate,
    saveProgress,
    readingMode,
    readingDirection,
    pageOffset,
    pageMetaMap,
    subPage,
    setSubPage,
    currentChapterId,
    viewerFrom,
    routeIsIncognito,
  ]);

  // 뒤로가기
  const handleBack = useCallback(() => {
    saveProgress();
    if (viewerFrom) {
      navigate(viewerFrom, { replace: true });
    } else {
      navigate(-1);
    }
  }, [saveProgress, navigate, viewerFrom]);

  // 클릭 핸들러

  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 중이면 무시
      const target = e.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
      if (isEditable) return;

      if (isFullscreenToggleShortcut(e)) {
        e.preventDefault();
        handleToggleFullscreen();
        return;
      }

      const isRTL = keyboardDirection === "rtl";

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (isRTL) {
            // RTL: 왼쪽 화살표 = 다음
            if (canGoNextChapter) {
              void handleNext();
            } else if (animationRef?.current) {
              animationRef.current.animateNext();
            } else {
              handleNext();
            }
          } else {
            // LTR: 왼쪽 화살표 = 이전
            if (canGoPrevChapter) {
              void handlePrev();
            } else if (animationRef?.current) {
              animationRef.current.animatePrev();
            } else {
              handlePrev();
            }
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (isRTL) {
            // RTL: 오른쪽 화살표 = 이전
            if (canGoPrevChapter) {
              void handlePrev();
            } else if (animationRef?.current) {
              animationRef.current.animatePrev();
            } else {
              handlePrev();
            }
          } else {
            // LTR: 오른쪽 화살표 = 다음
            if (canGoNextChapter) {
              void handleNext();
            } else if (animationRef?.current) {
              animationRef.current.animateNext();
            } else {
              handleNext();
            }
          }
          break;
        case " ":
          e.preventDefault();
          if (canGoNextChapter) {
            void handleNext();
          } else if (animationRef?.current) {
            animationRef.current.animateNext();
          } else {
            handleNext();
          }
          break;
        case "Home":
          e.preventDefault();
          goToPage(1);
          break;
        case "End":
          e.preventDefault();
          goToPage(totalPages);
          break;
        case "Escape":
          if (isSettingsOpen) {
            closeSettings();
          } else if (document.fullscreenElement) {
            document.exitFullscreen();
          } else {
            handleBack();
          }
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    keyboardDirection,
    handleNext,
    handlePrev,
    goToPage,
    totalPages,
    isSettingsOpen,
    closeSettings,
    handleToggleFullscreen,
    handleBack,
    animationRef,
    canGoNextChapter,
    canGoPrevChapter,
  ]);

  return {
    handleNext,
    handlePrev,
    handleBack,
    showNextHint,
    showPrevHint,
    canGoNextChapter,
    canGoPrevChapter,
  };
}
