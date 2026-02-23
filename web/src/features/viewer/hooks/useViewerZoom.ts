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

  // Cleanup handling for click timeout
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
    };
  }, []);

  const handleMouseDown = useCallback(() => {
    isDraggingRef.current = false;
    dragStartTimeRef.current = Date.now();
  }, []);

  const handleMouseMove = useCallback(() => {
    if (dragStartTimeRef.current > 0 && Date.now() - dragStartTimeRef.current > 100) {
      isDraggingRef.current = true;
    }
  }, []);

  const handleContentClick = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      zoomRef?: React.RefObject<ReactZoomPanPinchContentRef> | { current: null },
    ) => {
      // Check if this click is right after a drag (text selection)
      const now = Date.now();
      const timeSinceDragStart = now - dragStartTimeRef.current;
      if (isDraggingRef.current || timeSinceDragStart > 500) {
        // Just finished dragging or clicked after long time, handle as selection end
        isDraggingRef.current = false;
        dragStartTimeRef.current = 0;
        return;
      }
      dragStartTimeRef.current = 0;

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

          // Clear text selection when clicking on any area (including text layers)
          const selection = window.getSelection();
          if (selection && !selection.isCollapsed) {
            selection.removeAllRanges();
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
