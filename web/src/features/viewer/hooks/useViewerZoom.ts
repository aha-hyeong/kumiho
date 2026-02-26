import { useState, useRef, useCallback, useEffect } from "react";
import { type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { useViewerStore, type ReadingDirection } from "../../../stores/viewerStore";

interface UseViewerZoomParams {
  clickDirection: ReadingDirection;
  onNext: () => void;
  onPrev: () => void;
  isVerticalMode?: boolean;
  onVerticalZoomToggle?: (
    isZoomingIn: boolean,
    anchor?: { clientX: number; clientY: number; pageNum?: number; pageYRatio?: number },
  ) => void;
  deferSingleTapForDoubleTap?: boolean;
  doubleTapZoomZone?: "any" | "center";
}

const DOUBLE_TAP_DELAY = 300;
const ZOOM_NAVIGATION_LOCK_SCALE = 1.01;
const BASE_DRAG_THRESHOLD_PX = 5;

export function useViewerZoom({
  clickDirection,
  onNext,
  onPrev,
  isVerticalMode,
  onVerticalZoomToggle,
  deferSingleTapForDoubleTap = true,
  doubleTapZoomZone = "any",
}: UseViewerZoomParams) {
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  // Double Click / Zone Detection State
  const lastTapTimeRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDraggingRef = useRef<boolean>(false);
  const dragStartTimeRef = useRef<number>(0);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const removeWindowDragListenersRef = useRef<(() => void) | null>(null);

  const clearDragState = useCallback(() => {
    dragStartPosRef.current = null;
    dragStartTimeRef.current = 0;
    isDraggingRef.current = false;
  }, []);

  // Cleanup handling for click timeout
  useEffect(() => {
    return () => {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
      }
      if (removeWindowDragListenersRef.current) {
        removeWindowDragListenersRef.current();
        removeWindowDragListenersRef.current = null;
      }
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragStartTimeRef.current === 0 || !dragStartPosRef.current) return;
    const dx = e.clientX - dragStartPosRef.current.x;
    const dy = e.clientY - dragStartPosRef.current.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const dragThreshold = Math.max(4, BASE_DRAG_THRESHOLD_PX / (window.devicePixelRatio || 1));
    // 고해상도 화면에서도 물리적 체감이 비슷하도록 devicePixelRatio 보정
    if (distance > dragThreshold) {
      isDraggingRef.current = true;
    }
  }, []);

  const bindWindowDragListeners = useCallback(() => {
    if (removeWindowDragListenersRef.current) return;

    const onWindowMouseMove = (e: MouseEvent) => {
      if (dragStartTimeRef.current === 0 || !dragStartPosRef.current) return;
      const dx = e.clientX - dragStartPosRef.current.x;
      const dy = e.clientY - dragStartPosRef.current.y;
      const dragThreshold = Math.max(4, BASE_DRAG_THRESHOLD_PX / (window.devicePixelRatio || 1));
      if (Math.sqrt(dx * dx + dy * dy) > dragThreshold) {
        isDraggingRef.current = true;
      }
    };
    const onWindowMouseUp = () => {
      clearDragState();
      if (removeWindowDragListenersRef.current) {
        removeWindowDragListenersRef.current();
        removeWindowDragListenersRef.current = null;
      }
    };

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);

    removeWindowDragListenersRef.current = () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
    };
  }, [clearDragState]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDraggingRef.current = false;
      dragStartTimeRef.current = Date.now();
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
      bindWindowDragListeners();
    },
    [bindWindowDragListeners],
  );

  const handleContentClick = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent,
      zoomRef?: React.RefObject<ReactZoomPanPinchContentRef> | { current: null },
    ) => {
      // Check if this click is right after a drag (text selection) or a long press
      const now = Date.now();
      const dragStartAt = dragStartTimeRef.current;
      const timeSinceDragStart = dragStartAt > 0 ? now - dragStartAt : 0;
      if (isDraggingRef.current || (dragStartAt > 0 && timeSinceDragStart > 500)) {
        clearDragState();
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
      const isDoubleByDetail = isMouseNativeEvent && nativeEvent.detail === 2;
      const isDoubleByTime = deferSingleTapForDoubleTap && now - lastTapTimeRef.current < DOUBLE_TAP_DELAY;
      const isDoubleTapZoomAllowed = doubleTapZoomZone === "any" || zone === "center";

      if ((isDoubleByDetail || isDoubleByTime) && isDoubleTapZoomAllowed) {
        if (clickTimeoutRef.current) {
          clearTimeout(clickTimeoutRef.current);
          clickTimeoutRef.current = null;
        }

        if (isVerticalMode && onVerticalZoomToggle) {
          const clientY = "changedTouches" in e ? e.changedTouches[0].clientY : (e as React.MouseEvent).clientY;
          const targetEl = e.target instanceof HTMLElement ? e.target : null;
          const pageEl = targetEl?.closest("[data-page]") as HTMLElement | null;
          const pageNum = pageEl ? Number(pageEl.dataset.page) : undefined;
          let pageYRatio: number | undefined;
          if (pageEl) {
            const rect = pageEl.getBoundingClientRect();
            if (rect.height > 0) {
              pageYRatio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
            }
          }
          const anchor = { clientX, clientY, pageNum, pageYRatio };
          setIsZoomed((prev) => {
            const nextZoom = !prev;
            onVerticalZoomToggle(nextZoom, anchor);
            return nextZoom;
          });
          return;
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
      } else if (deferSingleTapForDoubleTap) {
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
      } else {
        // Image viewer path: handle single tap immediately without waiting for double-tap window
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          return;
        }

        if (zone === "center") {
          useViewerStore.getState().toggleUI();
        } else {
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
      }
      lastTapTimeRef.current = now;
    },
    [
      clickDirection,
      onNext,
      onPrev,
      isVerticalMode,
      onVerticalZoomToggle,
      deferSingleTapForDoubleTap,
      doubleTapZoomZone,
      clearDragState,
    ],
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
