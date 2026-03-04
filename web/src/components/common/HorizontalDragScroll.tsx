import { useEffect, useRef, useState, type MouseEvent, type ReactNode, type WheelEvent, type UIEvent } from "react";

interface HorizontalDragScrollProps {
  className?: string;
  children: ReactNode;
}

export function HorizontalDragScroll({ className = "", children }: HorizontalDragScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const scrollLeftRef = useRef(0);
  const targetScrollLeftRef = useRef(0);
  const draggedRef = useRef(false);
  const suppressClickUntilRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const DRAG_THRESHOLD = 8;
  const CLICK_SUPPRESS_MS = 160;

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  const updateMaskEdges = (el: HTMLDivElement) => {
    // 0~20px 스크롤에 걸쳐 투명도가 1 -> 0으로 변함
    const FADE_RANGE = 20;

    // isAtLeft: scrollLeft가 0에 가까울수록 1(불투명, 페이드 없음), 커지면 0(투명, 페이드 있음)
    const leftEdgeOpacity = Math.max(0, 1 - el.scrollLeft / FADE_RANGE);

    // isAtRight: 끝에 도달할수록 1(불투명), 떨어질수록 0(투명)
    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    // content가 짧아서 스크롤 자체가 불가능한 경우, 양쪽 모두 페이드 없어야 함
    if (maxScrollLeft <= 0) {
      el.style.setProperty("--mask-left-edge", "1");
      el.style.setProperty("--mask-right-edge", "1");
      return;
    }

    const distanceFromRight = maxScrollLeft - el.scrollLeft;
    const rightEdgeOpacity = Math.max(0, 1 - distanceFromRight / FADE_RANGE);

    el.style.setProperty("--mask-left-edge", leftEdgeOpacity.toString());
    el.style.setProperty("--mask-right-edge", rightEdgeOpacity.toString());
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 초기 마스크 설정
    updateMaskEdges(el);

    // 요소 크기 변동 시 (예: 화면 리사이즈나 자식 요소 동적 추가/삭제로 인해 스크롤 폭이 달라질 때) 대응
    const resizeObserver = new ResizeObserver(() => {
      updateMaskEdges(el);
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, [children]);

  const applyScrollOnNextFrame = () => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) {
        el.scrollLeft = targetScrollLeftRef.current;
      }
      rafRef.current = null;
    });
  };

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    setIsDragging(true);
    startXRef.current = e.pageX;
    startYRef.current = e.pageY;
    scrollLeftRef.current = el.scrollLeft;
    targetScrollLeftRef.current = el.scrollLeft;
    draggedRef.current = false;
  };

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const el = containerRef.current;
    if (!el) return;

    const deltaX = e.pageX - startXRef.current;
    const deltaY = e.pageY - startYRef.current;

    if (!draggedRef.current && (Math.abs(deltaX) >= DRAG_THRESHOLD || Math.abs(deltaY) >= DRAG_THRESHOLD)) {
      draggedRef.current = true;
    }

    if (!draggedRef.current) return;

    e.preventDefault();
    targetScrollLeftRef.current = scrollLeftRef.current - deltaX;
    applyScrollOnNextFrame();
  };

  const stopDragging = () => {
    if (draggedRef.current) {
      suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
    }
    setIsDragging(false);
  };

  const handleWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    const canScrollHorizontally = el.scrollWidth > el.clientWidth;
    if (!canScrollHorizontally) return;

    // 세로 휠 입력은 페이지 스크롤에 맡기고,
    // 실제 가로 제스처(트랙패드/가로 휠)일 때만 가로 스크롤 처리.
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    const deltaX = e.deltaX;
    if (deltaX === 0) return;

    e.preventDefault();
    e.stopPropagation();
    targetScrollLeftRef.current = el.scrollLeft + deltaX;
    applyScrollOnNextFrame();
    suppressClickUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
  };

  const handleClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    if (Date.now() <= suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const handleScroll = (e: UIEvent<HTMLDivElement>) => {
    updateMaskEdges(e.currentTarget);
  };

  return (
    <div
      ref={containerRef}
      className={`${className} ${isDragging ? "dragging" : ""}`.trim()}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={stopDragging}
      onMouseUp={stopDragging}
      onWheel={handleWheel}
      onClickCapture={handleClickCapture}
      onScroll={handleScroll}
    >
      {children}
    </div>
  );
}
