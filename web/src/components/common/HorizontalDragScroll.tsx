import { useEffect, useRef, useState, type ReactNode } from "react";

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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;

    setIsDragging(true);
    startXRef.current = e.pageX;
    startYRef.current = e.pageY;
    scrollLeftRef.current = el.scrollLeft;
    targetScrollLeftRef.current = el.scrollLeft;
    draggedRef.current = false;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
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

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
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

  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() <= suppressClickUntilRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
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
    >
      {children}
    </div>
  );
}
