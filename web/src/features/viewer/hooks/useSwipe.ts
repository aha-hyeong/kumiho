import { useRef, useCallback, useState } from "react";
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
}: UseSwipeParams) {
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Ignore if zoomed, multi-touch, or currently animating
      if (isZoomed || e.touches.length !== 1 || isAnimating) return;

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
      if (!touchStartRef.current || isZoomed || isAnimating) return;

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
        setSwipeOffset(0);
        setTimeout(() => {
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

    const targetOffset = finalOffset < 0 ? -(containerWidth + gap) : containerWidth + gap;

    setIsAnimating(true);
    setSwipeOffset(targetOffset);

    // After animation, trigger state change and reset
    setTimeout(() => {
      if (isNext) {
        onNext();
      } else {
        onPrev();
      }
      // Reset logic: new page will appear
      // We need to reset offset to 0 instantly so the new page sits in the center
      setSwipeOffset(0);
      setIsAnimating(false);
    }, duration);
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
  ]);

  const animateTransition = useCallback(
    (direction: "next" | "prev") => {
      if (isAnimating) return;

      const containerWidth = containerRef?.current?.clientWidth || window.innerWidth;
      const effectiveDirection = swipeDirection || readingDirection;
      const isRTL = effectiveDirection === "rtl";
      let targetOffset = 0;

      // Calculate target offset based on direction and RTL
      if (direction === "next") {
        // Next: LTR = Left (-), RTL = Right (+)
        targetOffset = isRTL ? containerWidth + gap : -(containerWidth + gap);
      } else {
        // Prev: LTR = Right (+), RTL = Left (-)
        targetOffset = isRTL ? -(containerWidth + gap) : containerWidth + gap;
      }

      setIsAnimating(true);
      setSwipeOffset(targetOffset);

      setTimeout(() => {
        if (direction === "next") {
          onNext();
        } else {
          onPrev();
        }
        setSwipeOffset(0);
        setIsAnimating(false);
      }, duration);
    },
    [isAnimating, containerRef, readingDirection, swipeDirection, gap, duration, onNext, onPrev],
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
