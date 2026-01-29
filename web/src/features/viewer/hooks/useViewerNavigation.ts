// 뷰어 네비게이션 훅 (키보드, 클릭, 페이지 이동)

import { useEffect, useCallback, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useViewerStore } from "../../../stores/viewerStore";
import type { PageMeta } from "../types";
import type { ReadingDirection, ReadingMode } from "../../../stores/viewerStore";

interface UseViewerNavigationParams {
  currentPage: number;
  totalPages: number;
  readingMode: ReadingMode;
  clickDirection: ReadingDirection;
  keyboardDirection: ReadingDirection;
  pageOffset: number;
  pageMetaMap: Map<number, PageMeta>;
  nextChapterId: string | null;
  prevChapterId: string | null;
  saveProgress: () => Promise<void>;
  isSettingsOpen: boolean;
  closeSettings: () => void;
  handleToggleFullscreen: () => void;
}

interface UseViewerNavigationReturn {
  handleNext: () => Promise<void>;
  handlePrev: () => Promise<void>;
  handleBack: () => void;
  showNextHint: boolean;
  showPrevHint: boolean;
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
  keyboardDirection,
  pageOffset,
  pageMetaMap,
  nextChapterId,
  prevChapterId,
  saveProgress,
  isSettingsOpen,
  closeSettings,
  handleToggleFullscreen,
}: UseViewerNavigationParams): UseViewerNavigationReturn {
  const navigate = useNavigate();
  const { goToPage } = useViewerStore();

  const [showNextHint, setShowNextHint] = useState(false);
  const [showPrevHint, setShowPrevHint] = useState(false);
  const hintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) {
        clearTimeout(hintTimeoutRef.current);
      }
    };
  }, []);

  // 다음 페이지/챕터 핸들러
  const handleNext = useCallback(async () => {
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
        navigate(`/viewer/${nextChapterId}`, { replace: true });
      } else if (nextChapterId) {
        // 기존 타이머 정리
        if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);

        // 힌트 표시
        setShowNextHint(true);
        // 3초 후 힌트 사라짐
        hintTimeoutRef.current = setTimeout(() => {
          setShowNextHint(false);
          hintTimeoutRef.current = null;
        }, 3000);
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
    pageOffset,
    pageMetaMap,
  ]);

  // 이전 페이지/챕터 핸들러
  const handlePrev = useCallback(async () => {
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
        navigate(`/viewer/${prevChapterId}?page=last`, { replace: true });
      } else if (prevChapterId) {
        // 기존 타이머 정리
        if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);

        setShowPrevHint(true);
        hintTimeoutRef.current = setTimeout(() => {
          setShowPrevHint(false);
          hintTimeoutRef.current = null;
        }, 3000);
      }
    }
  }, [
    currentPage,
    goToPage,
    showPrevHint,
    prevChapterId,
    navigate,
    saveProgress,
    readingMode,
    pageOffset,
    pageMetaMap,
  ]);

  // 뒤로가기
  const handleBack = useCallback(() => {
    saveProgress();
    navigate(-1);
  }, [saveProgress, navigate]);

  // 클릭 핸들러

  // 키보드 이벤트
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 입력 중이면 무시
      if (e.target instanceof HTMLInputElement) return;

      const isRTL = keyboardDirection === "rtl";

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (isRTL) {
            handleNext();
          } else {
            handlePrev();
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (isRTL) {
            handlePrev();
          } else {
            handleNext();
          }
          break;
        case " ":
          e.preventDefault();
          handleNext();
          break;
        case "Home":
          e.preventDefault();
          goToPage(1);
          break;
        case "End":
          e.preventDefault();
          goToPage(totalPages);
          break;
        case "f":
        case "F":
        case "ㄹ": // 한글 입력 상태 대비
          e.preventDefault();
          handleToggleFullscreen();
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
  ]);

  return {
    handleNext,
    handlePrev,
    handleBack,
    showNextHint,
    showPrevHint,
  };
}
