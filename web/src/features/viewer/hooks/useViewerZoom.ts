import { useState, useRef, useCallback, useEffect } from "react";
import { type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { useViewerStore, type ReadingDirection } from "../../../stores/viewerStore";

interface UseViewerZoomParams {
  clickDirection: ReadingDirection;
  onNext: () => void;
  onPrev: () => void;
}

const DOUBLE_TAP_DELAY = 300;
const ZOOM_NAVIGATION_LOCK_SCALE = 1.01;

export function useViewerZoom({ clickDirection, onNext, onPrev }: UseViewerZoomParams) {
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  // Double Click / Zone Detection State
  const lastTapTimeRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartTimeRef = useRef<number>(0);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Cleanup handling for click timeout
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = false;
    dragStartTimeRef.current = Date.now();
    dragStartPosRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartTimeRef.current === 0 || !dragStartPosRef.current) return;
    const dx = e.clientX - dragStartPosRef.current.x;
    const dy = e.clientY - dragStartPosRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    // 5px 이상 이동 시 드래그로 인식 (빠른 텍스트 드래그도 감지)
    if (distance > 5) {
      isDraggingRef.current = true;
    }
  }, []);

  // window 레벨에서 mousemove/mouseup 감지:
  // - overflow:visible 환경(세로 모드)에서 컨테이너 밖 이동도 드래그로 감지
  // - 브라우저 포커스 이탈 등으로 click 이벤트가 발생하지 않을 때 드래그 상태 정리
  useEffect(() => {
    const onWindowMouseMove = (e: MouseEvent) => {
      if (dragStartTimeRef.current === 0 || !dragStartPosRef.current) return;
      const dx = e.clientX - dragStartPosRef.current.x;
      const dy = e.clientY - dragStartPosRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 5) {
        isDraggingRef.current = true;
      }
    };
    const onWindowMouseUp = () => {
      // dragStartPosRef만 null로 설정하여 mousemove 감지를 중단시킴.
      // dragStartTimeRef와 isDraggingRef는 건드리지 않음:
      // - 정상 클릭 시: 이어서 발생하는 click 이벤트(handleContentClick)에서 처리
      // - 포커스 이탈 등 click 미발생 시: 다음 mousedown에서 isDraggingRef=false로 리셋됨
      dragStartPosRef.current = null;
    };
    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
    return () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, []);

  const handleContentClick = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      zoomRef?: React.RefObject<ReactZoomPanPinchContentRef> | { current: null },
    ) => {
      // Check if this click is right after a drag (text selection) or a long press
      const now = Date.now();
      const timeSinceDragStart = now - dragStartTimeRef.current;
      if (isDraggingRef.current || timeSinceDragStart > 500) {
        // Just finished dragging, or it was a long press (>500ms delay before release).
        // In both cases, do not trigger page navigation/zoom. Treat as text selection or drag end.
        isDraggingRef.current = false;
        dragStartTimeRef.current = 0;
        dragStartPosRef.current = null;
        return;
      }
      dragStartTimeRef.current = 0;
      dragStartPosRef.current = null;

      // Use provided zoomRef (for vertical mode) or global one
      const refToUse = zoomRef || transformComponentRef;

      // Get clientX to determine zone
      let clientX = 0;
      if ("changedTouches" in e && e.changedTouches.length > 0) {
        clientX = e.changedTouches[0].clientX;
      } else if ("clientX" in e) {
        clientX = (e as React.MouseEvent).clientX;
      } else {
        return;
      }

      // Get relative X to determine zone based on viewport width
      const xRatio = clientX / window.innerWidth;
      const isRTL = clickDirection === "rtl";
      let zone: "left" | "center" | "right" = "center";

      if (xRatio < 0.3) zone = "left";
      else if (xRatio > 0.7) zone = "right";

      const nativeEvent = e.nativeEvent;
      const isMouseNativeEvent = nativeEvent instanceof MouseEvent;
      const isDoubleByDetail = isMouseNativeEvent && nativeEvent.detail >= 2;
      const isDoubleByTime = now - lastTapTimeRef.current < DOUBLE_TAP_DELAY;

      if (isDoubleByDetail || isDoubleByTime) {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
          clickTimeoutRef.current = null;
        }
        // Trigger Zoom logic
        if (refToUse.current) {
          const { zoomIn, resetTransform, instance } = refToUse.current;
          const currentScale = instance.transformState.scale;

          if (currentScale > 1.05) {
            resetTransform(200);
          } else {
            const exactStepTo200 = Math.log(2.0);
            zoomIn(exactStepTo200, 200);
          }
        }
      } else {
        // First Tap - Wait for potential second tap
        clickTimeoutRef.current = setTimeout(() => {
          clickTimeoutRef.current = null;

          // If text is selected (e.g. user just finished text drag), keep it and do nothing
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) {
            return;
          }

          if (zone === "center") {
            useViewerStore.getState().toggleUI();
          } else {
            // Prevent nav if zoomed
            let currentScale = 1;
            if (refToUse.current) {
              currentScale = refToUse.current.instance.transformState.scale;
            }

            if (currentScale > ZOOM_NAVIGATION_LOCK_SCALE) {
              return;
            }

            if (zone === "left") {
              if (isRTL) onNext();
              else onPrev();
            } else {
              if (isRTL) onPrev();
              else onNext();
            }
          }
        }, DOUBLE_TAP_DELAY);
      }
      lastTapTimeRef.current = now;
    },
    [clickDirection, onNext, onPrev],
  );

  return {
    transformComponentRef,
    isZoomed,
    setIsZoomed,
    handleContentClick,
    handleMouseDown,
    handleMouseMove,
  };
}
