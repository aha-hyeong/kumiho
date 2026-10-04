import { useRef, useCallback, useState, useLayoutEffect } from "react";
import type { ReadingDirection } from "../../../stores/viewerStore";

interface UseSwipeParams {
  onNext: () => void;
  onPrev: () => void;
  readingDirection: ReadingDirection; // Used to map swipe direction to Next/Prev
  swipeDirection?: ReadingDirection; // Explicit swipe direction (overrides readingDirection if provided)
  isZoomed: boolean;
  threshold?: number;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  gap?: number;
  duration?: number;
  prepareTransition?: (direction: "next" | "prev", isCurrent: () => boolean) => Promise<void>;
  animateWhilePreparing?: boolean;
  navigationKey?: string;
  /** true면 다음 페이지로의 스와이프 임계값 도달 시 애니메이션 없이 즉시 onNext 호출 */
  skipNextAnimation?: boolean;
  /** true면 이전 페이지로의 스와이프 임계값 도달 시 애니메이션 없이 즉시 onPrev 호출 */
  skipPrevAnimation?: boolean;
}

export function useSwipe({
  onNext,
  onPrev,
  readingDirection,
  swipeDirection,
  isZoomed,
  threshold = 10,
  containerRef,
  gap = 20,
  duration = 300,
  prepareTransition,
  animateWhilePreparing = false,
  navigationKey,
  skipNextAnimation = false,
  skipPrevAnimation = false,
}: UseSwipeParams) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const transitionTokenRef = useRef(0);
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transitionBusyRef = useRef(false);

  const cancelTransition = useCallback(() => {
    transitionTokenRef.current += 1;
    if (transitionTimerRef.current !== null) clearTimeout(transitionTimerRef.current);
    transitionTimerRef.current = null;
    transitionBusyRef.current = false;
    touchStartRef.current = null;
  }, []);

  const resetTransition = useCallback(() => {
    cancelTransition();
    setSwipeOffset(0);
    setIsAnimating(false);
    setIsSwiping(false);
  }, [cancelTransition]);

  useLayoutEffect(() => {
    // A chapter/page replacement must cancel and reset its DOM transform before paint.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    resetTransition();
    return cancelTransition;
  }, [navigationKey, resetTransition, cancelTransition]);

  const startTransition = useCallback((direction: "next" | "prev", targetOffset: number) => {
    if (transitionBusyRef.current) return;
    transitionBusyRef.current = true;
    const token = ++transitionTokenRef.current;
    let animationDone = false;
    let visualReady = !prepareTransition;
    const commit = () => {
      if (transitionTokenRef.current !== token || !animationDone || !visualReady) return;
      if (direction === "next") onNext();
      else onPrev();
      setSwipeOffset(0);
      setIsAnimating(false);
      transitionBusyRef.current = false;
    };
    const begin = () => {
      if (transitionTokenRef.current !== token) return;
      setIsAnimating(true);
      setSwipeOffset(targetOffset);
      transitionTimerRef.current = setTimeout(() => {
        if (transitionTokenRef.current !== token) return;
        transitionTimerRef.current = null;
        animationDone = true;
        commit();
      }, duration);
    };
    // Slide previews can snap immediately; only the final handoff waits for readiness.
    if (prepareTransition) {
      if (animateWhilePreparing) begin();
      void prepareTransition(direction, () => transitionTokenRef.current === token).then(() => {
        if (transitionTokenRef.current !== token) return;
        visualReady = true;
        if (animateWhilePreparing) commit();
        else begin();
      }, () => {
        if (transitionTokenRef.current === token) resetTransition();
      });
    } else begin();
  }, [prepareTransition, animateWhilePreparing, onNext, onPrev, duration, resetTransition]);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Ignore if zoomed, multi-touch, or currently animating
      if (isZoomed || e.touches.length !== 1 || isAnimating || transitionBusyRef.current) return;

      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
      };
      setSwipeOffset(0);
      setIsSwiping(false);
    },
    [isZoomed, isAnimating],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (!touchStartRef.current || isZoomed || isAnimating || transitionBusyRef.current) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - touchStartRef.current.x;
      const diffY = currentY - touchStartRef.current.y;

      // Lock direction: If moving mostly vertically, ignore (allow scroll)
      // Only start swiping if horizontal move is significantly larger
      if (!isSwiping) {
        if (Math.abs(diffY) > Math.abs(diffX)) {
          // It's a vertical scroll, ignore this touch session
          touchStartRef.current = null;
          return;
        }
        // Start swiping intent (only if moved a bit to avoid accidental clicks)
        if (Math.abs(diffX) > 10) {
          setIsSwiping(true);
        }
      }

      if (isSwiping) {
        setSwipeOffset(diffX);
      }
    },
    [isZoomed, isSwiping, isAnimating],
  );

  const onTouchEnd = useCallback(() => {
    if (!touchStartRef.current) return;

    const finalOffset = isSwiping ? swipeOffset : 0;
    // Use swipeDirection if provided, otherwise fallback to readingDirection
    const effectiveDirection = swipeDirection || readingDirection;
    const isRTL = effectiveDirection === "rtl";
    const containerWidth = containerRef?.current?.clientWidth || window.innerWidth;

    touchStartRef.current = null;
    setIsSwiping(false);

    // If threshold not met, bounce back
    if (Math.abs(finalOffset) <= threshold) {
      if (Math.abs(finalOffset) > 0) {
        setIsAnimating(true);
        transitionBusyRef.current = true;
        setSwipeOffset(0);
        transitionTimerRef.current = setTimeout(() => {
          transitionTimerRef.current = null;
          transitionBusyRef.current = false;
          setIsAnimating(false);
        }, duration);
      } else {
        setSwipeOffset(0);
      }
      return;
    }

    // Threshold met: Slide to snap
    let isNext = false;
    if (finalOffset < 0) {
      // Swipe Left (<---)
      // LTR: Next, RTL: Prev
      isNext = !isRTL;
    } else {
      // Swipe Right (--->)
      // LTR: Prev, RTL: Next
      isNext = isRTL;
    }

    // 방향별로 애니메이션 억제 여부 확인
    if (isNext && skipNextAnimation) {
      setSwipeOffset(0);
      onNext();
      return;
    }
    if (!isNext && skipPrevAnimation) {
      setSwipeOffset(0);
      onPrev();
      return;
    }

    const targetOffset = finalOffset < 0 ? -(containerWidth + gap) : containerWidth + gap;

    startTransition(isNext ? "next" : "prev", targetOffset);
  }, [
    isSwiping,
    swipeOffset,
    threshold,
    readingDirection,
    swipeDirection,
    onNext,
    onPrev,
    containerRef,
    gap,
    duration,
    skipNextAnimation,
    skipPrevAnimation,
    startTransition,
  ]);

  const animateTransition = useCallback(
    (direction: "next" | "prev") => {
      if (isAnimating || transitionBusyRef.current) return;

      // 방향별 애니메이션 억제
      if (direction === "next" && skipNextAnimation) {
        onNext();
        return;
      }
      if (direction === "prev" && skipPrevAnimation) {
        onPrev();
        return;
      }

      const containerWidth = containerRef?.current?.clientWidth || window.innerWidth;
      // 클릭/키보드 등 명시적 next/prev 전환은 읽기 방향 기준으로 애니메이션한다.
      const isRTL = readingDirection === "rtl";
      let targetOffset = 0;

      // Calculate target offset based on direction and RTL
      if (direction === "next") {
        // Next: LTR = Left (-), RTL = Right (+)
        targetOffset = isRTL ? containerWidth + gap : -(containerWidth + gap);
      } else {
        // Prev: LTR = Right (+), RTL = Left (-)
        targetOffset = isRTL ? -(containerWidth + gap) : containerWidth + gap;
      }

      startTransition(direction, targetOffset);
    },
    [isAnimating, containerRef, readingDirection, gap, onNext, onPrev, skipNextAnimation, skipPrevAnimation, startTransition],
  );

  const animateNext = useCallback(() => animateTransition("next"), [animateTransition]);
  const animatePrev = useCallback(() => animateTransition("prev"), [animateTransition]);

  return {
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    swipeOffset,
    isSwiping,
    isAnimating,
    animateNext,
    animatePrev,
  };
}
