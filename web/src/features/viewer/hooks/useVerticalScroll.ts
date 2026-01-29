// 세로 스크롤 모드 전용 훅

import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useViewerStore } from "../../../stores/viewerStore";

interface UseVerticalScrollParams {
  readingMode: string;
  isLoading: boolean;
  currentPage: number;
  totalPages: number;
  nextChapterId: string | null;
  prevChapterId: string | null;
  pullThreshold: number;
  pullSensitivity: number;
  showThreshold: number;
  saveProgress: () => Promise<void>;
  chapterId: string | undefined;
}

interface UseVerticalScrollReturn {
  pullOffset: number;
  viewerContentRef: React.RefObject<HTMLDivElement | null>;
  isInitialScrollingRef: React.RefObject<boolean>;
  isInternalScrollRef: React.RefObject<boolean>;
  startYRef: React.RefObject<number | null>;
  isTouching: boolean;
}

/**
 * 세로 스크롤 모드 전용 커스텀 훅
 * - 스크롤 위치에 따른 페이지 변경 (IntersectionObserver)
 * - 상/하단 당김 네비게이션
 * - 터치/휠 이벤트 처리
 */
export function useVerticalScroll({
  readingMode,
  isLoading,
  currentPage,
  totalPages,
  nextChapterId,
  prevChapterId,
  pullThreshold,
  pullSensitivity,
  saveProgress,
  chapterId,
}: UseVerticalScrollParams): UseVerticalScrollReturn {
  const navigate = useNavigate();
  const { setCurrentPage } = useViewerStore();

  const [pullOffset, setPullOffset] = useState(0);
  const [isTouching, setIsTouching] = useState(false);
  const pullOffsetRef = useRef(0);
  const isNavigatingRef = useRef(false);
  const viewerContentRef = useRef<HTMLDivElement>(null);
  const startYRef = useRef<number | null>(null);
  const lastYRef = useRef<number | null>(null);
  const isInternalScrollRef = useRef(false);
  const isInitialScrollingRef = useRef(true); // 초기값을 true로 설정하여 로딩 직후 Observer 작동 방지

  // 세로 모드 스크롤 동기화 및 관찰
  useEffect(() => {
    if (readingMode !== "vertical") return;
    if (isLoading) return;

    const content = viewerContentRef.current;

    // 현재 페이지로 스크롤 이동 (외부 요인으로 변경된 경우만)
    if (!isInternalScrollRef.current) {
      // 마지막 페이지인 경우: 스크롤 컨테이너 맨 아래로 직접 이동
      if (currentPage === totalPages && content) {
        requestAnimationFrame(() => {
          content.scrollTop = content.scrollHeight;
          // 마지막 페이지 스크롤 후에는 isInternalScrollRef를 true로 유지하여
          // IntersectionObserver가 중간 페이지를 감지해도 스크롤이 다시 이동하지 않도록 함
          isInternalScrollRef.current = true;
          setTimeout(() => {
            isInitialScrollingRef.current = false;
          }, 150);
        });
      } else {
        // 일반 페이지: 해당 페이지 요소로 스크롤
        const pageEl = document.getElementById(`page-${currentPage}`);
        if (pageEl) {
          requestAnimationFrame(() => {
            pageEl.scrollIntoView({ block: "start" });
            setTimeout(() => {
              isInitialScrollingRef.current = false;
            }, 150);
          });
        } else {
          isInitialScrollingRef.current = false;
        }
      }
    } else {
      // 마지막 페이지가 아닐 때만 리셋 (마지막 페이지에서는 유지)
      if (currentPage !== totalPages) {
        isInternalScrollRef.current = false;
      }
    }
  }, [currentPage, totalPages, readingMode, isLoading]);

  // 페이지 모드(한/두페이지)에서는 로딩 완료 시 즉시 가드 해제
  useEffect(() => {
    if (readingMode === "vertical") return;
    if (!isLoading) {
      isInitialScrollingRef.current = false;
    }
  }, [isLoading, readingMode]);

  // IntersectionObserver로 현재 페이지 감지
  useEffect(() => {
    if (readingMode !== "vertical") return;
    if (isLoading) return;

    const content = viewerContentRef.current;
    if (!content) return; // 컨테이너가 없으면 종료

    const observer = new IntersectionObserver(
      (entries) => {
        // 초기 가드 중이면 무시
        if (isInitialScrollingRef.current) return;

        // 내부 스크롤 중이면 페이지 감지 무시 (마지막 페이지에서 중간 페이지 감지 방지)
        if (isInternalScrollRef.current) {
          // 단, 마지막 페이지에 있는데 스크롤이 바닥이 아니라면(사용자가 위로 스크롤함), 잠금 해제하고 감지 허용
          const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 50;
          const currentStorePage = useViewerStore.getState().currentPage;

          if (currentStorePage === totalPages && !isAtBottom) {
            isInternalScrollRef.current = false;
          } else {
            console.log("[VerticalScroll] skip observer (internal scroll)");
            return;
          }
        }

        // 스크롤이 맨 아래에 있으면 마지막 페이지가 아닌 페이지 감지 무시
        const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 10;
        if (isAtBottom && totalPages > 0) {
          // 맨 아래에서는 무조건 마지막 페이지로 고정
          const currentStorePage = useViewerStore.getState().currentPage;
          if (currentStorePage !== totalPages) {
            console.log(`[VerticalScroll] at bottom, force last page: ${currentStorePage} -> ${totalPages}`);
            isInternalScrollRef.current = true;
            setCurrentPage(totalPages);
          }
          return; // 다른 페이지 감지는 무시
        }

        const intersectingEntry = entries.find((entry) => entry.isIntersecting);
        if (intersectingEntry) {
          const pageNum = parseInt(intersectingEntry.target.id.replace("page-", ""), 10);
          const currentStorePage = useViewerStore.getState().currentPage;

          if (!isNaN(pageNum) && pageNum !== currentStorePage) {
            console.log(`[VerticalScroll] page changed: ${currentStorePage} -> ${pageNum}`);
            isInternalScrollRef.current = true;
            setCurrentPage(pageNum);
          }
        }
      },
      {
        root: content, // 스크롤 컨테이너를 기준으로 감지
        rootMargin: "-50% 0px -50% 0px",
        threshold: 0,
      },
    );

    // 모든 페이지 관찰
    const pages = document.querySelectorAll('[id^="page-"]');
    pages.forEach((page) => observer.observe(page));

    // 스크롤 끝 감지: 마지막 페이지가 화면 중앙에 안 와도 인식되도록
    const handleScroll = () => {
      if (!content || isInitialScrollingRef.current) return;

      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 5;
      if (isAtBottom && totalPages > 0) {
        const currentStorePage = useViewerStore.getState().currentPage;
        if (currentStorePage !== totalPages) {
          isInternalScrollRef.current = true;
          setCurrentPage(totalPages);
        }
      }
    };

    content?.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      observer.disconnect();
      content?.removeEventListener("scroll", handleScroll);
    };
  }, [totalPages, readingMode, setCurrentPage, isLoading, chapterId]);

  // 오버스크롤 감지 (당기기 네비게이션)
  useEffect(() => {
    if (readingMode !== "vertical" || isLoading) return;

    const content = viewerContentRef.current;
    if (!content) return;

    let handleWheel = (e: WheelEvent) => {
      if (isNavigatingRef.current) return;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      if (isAtTop && e.deltaY < 0 && prevChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.max(0, prev - e.deltaY * pullSensitivity);
          pullOffsetRef.current = newOffset;
          if (newOffset >= pullThreshold) {
            isNavigatingRef.current = true;
            saveProgress().then(() => {
              navigate(`/viewer/${prevChapterId}?page=last`, { replace: true });
            });
            return 0;
          }
          return newOffset;
        });
      } else if (isAtBottom && e.deltaY > 0 && nextChapterId) {
        e.preventDefault();
        setPullOffset((prev) => {
          const newOffset = Math.min(0, prev - e.deltaY * pullSensitivity);
          pullOffsetRef.current = newOffset;
          if (Math.abs(newOffset) >= pullThreshold) {
            isNavigatingRef.current = true;
            saveProgress().then(() => {
              navigate(`/viewer/${nextChapterId}`, { replace: true });
            });
            return 0;
          }
          return newOffset;
        });
      } else {
        setPullOffset((current) => {
          if (current !== 0) {
            pullOffsetRef.current = 0;
            return 0;
          }
          return current;
        });
      }
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (isNavigatingRef.current) return;
      startYRef.current = e.touches[0].clientY;
      lastYRef.current = e.touches[0].clientY;
      setIsTouching(true);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (isNavigatingRef.current || startYRef.current === null) return;

      const currentY = e.touches[0].clientY;
      const diff = currentY - (lastYRef.current ?? currentY);
      lastYRef.current = currentY;

      const isAtTop = content.scrollTop <= 0;
      const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 1;

      // Top Pulling
      if ((isAtTop && diff > 0 && prevChapterId) || pullOffsetRef.current > 0) {
        setPullOffset((prev) => {
          const maxPull = 180;
          const resistance = 0.5 * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.max(0, Math.min(prev + diff * resistance, maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (content.scrollTop <= 0 && pullOffsetRef.current > 0) e.preventDefault();
      }
      // Bottom Pulling
      else if ((isAtBottom && diff < 0 && nextChapterId) || pullOffsetRef.current < 0) {
        setPullOffset((prev) => {
          const maxPull = 180;
          const resistance = 0.5 * (1 - Math.abs(prev) / (maxPull * 2));
          const newOffset = Math.min(0, Math.max(prev + diff * resistance, -maxPull));
          pullOffsetRef.current = newOffset;
          return newOffset;
        });
        if (isAtBottom && pullOffsetRef.current < 0) e.preventDefault();
      } else {
        setPullOffset((current) => {
          if (current !== 0) {
            pullOffsetRef.current = 0;
            return 0;
          }
          return current;
        });
      }
    };

    const handleTouchEnd = () => {
      if (isNavigatingRef.current) return;

      const currentOffset = pullOffsetRef.current;

      // 임계값 확인 및 이동
      if (currentOffset >= pullThreshold && prevChapterId) {
        isNavigatingRef.current = true;
        saveProgress().then(() => {
          navigate(`/viewer/${prevChapterId}?page=last`, { replace: true });
        });
      } else if (currentOffset <= -pullThreshold && nextChapterId) {
        isNavigatingRef.current = true;
        saveProgress().then(() => {
          navigate(`/viewer/${nextChapterId}`, { replace: true });
        });
      }

      setPullOffset(0);
      pullOffsetRef.current = 0;
      startYRef.current = null;
      lastYRef.current = null;
      setIsTouching(false);
    };

    // 감쇠 애니메이션
    let rafId: number | null = null;
    const runDecay = () => {
      if (startYRef.current !== null) {
        rafId = requestAnimationFrame(runDecay);
        return;
      }

      setPullOffset((prev) => {
        if (Math.abs(prev) < 1) {
          pullOffsetRef.current = 0;
          rafId = null;
          return 0;
        }
        const newVal = prev * 0.8;
        pullOffsetRef.current = newVal;
        rafId = requestAnimationFrame(runDecay);
        return newVal;
      });
    };

    const startDecay = () => {
      if (rafId === null && pullOffsetRef.current !== 0) {
        rafId = requestAnimationFrame(runDecay);
      }
    };

    const originalHandleWheel = handleWheel;
    handleWheel = (e: WheelEvent) => {
      originalHandleWheel(e);
      startDecay();
    };

    content.addEventListener("wheel", handleWheel, { passive: false });
    content.addEventListener("touchstart", handleTouchStart, { passive: true });
    content.addEventListener("touchmove", handleTouchMove, { passive: false });
    content.addEventListener("touchend", handleTouchEnd, { passive: true });
    content.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      content.removeEventListener("wheel", handleWheel);
      content.removeEventListener("touchstart", handleTouchStart);
      content.removeEventListener("touchmove", handleTouchMove);
      content.removeEventListener("touchend", handleTouchEnd);
      content.removeEventListener("touchcancel", handleTouchEnd);
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      isNavigatingRef.current = false;
    };
  }, [readingMode, prevChapterId, nextChapterId, navigate, isLoading, saveProgress, pullSensitivity, pullThreshold]);

  // 챕터 변경 시 상태 리셋 - flushSync를 사용하여 동기 업데이트
  useEffect(() => {
    // 아무 작업 없이 ref만 업데이트하면 setState를 피할 수 있음
    pullOffsetRef.current = 0;
    isNavigatingRef.current = false;
    isInitialScrollingRef.current = true; // 챕터 변경 시 가드 다시 활성화
    // State 업데이트는 다음 프레임에서 처리 (queueMicrotask)
    queueMicrotask(() => {
      setPullOffset(0);
    });
  }, [chapterId]);

  return {
    pullOffset,
    viewerContentRef,
    isInitialScrollingRef,
    isInternalScrollRef,
    startYRef,
    isTouching,
  };
}
