import { useState, useRef, useCallback } from "react";
import { type ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { useViewerStore } from "../../../stores/viewerStore";

interface UseViewerZoomParams {
  clickDirection: string;
  onNext: () => void;
  onPrev: () => void;
}

export function useViewerZoom({ clickDirection, onNext, onPrev }: UseViewerZoomParams) {
  const transformComponentRef = useRef<ReactZoomPanPinchContentRef>(null);
  const [isZoomed, setIsZoomed] = useState(false);

  // Double Click / Zone Detection State
  const lastTapTimeRef = useRef<number>(0);
  const clickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentClick = useCallback(
    (e: React.MouseEvent | React.TouchEvent, zoomRef?: React.RefObject<ReactZoomPanPinchContentRef>) => {
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

      const screenWidth = window.innerWidth;
      const xRatio = clientX / screenWidth;

      const isRTL = clickDirection === "rtl";
      let zone: "left" | "center" | "right" = "center";

      if (xRatio < 0.3) zone = "left";
      else if (xRatio > 0.7) zone = "right";

      // If Center Zone -> Handle Double Tap Logic
      if (zone === "center") {
        const now = Date.now();
        const DOUBLE_TAP_DELAY = 300;

        if (now - lastTapTimeRef.current < DOUBLE_TAP_DELAY) {
          // DOUBLE TAP DETECTED
          if (clickTimeoutRef.current) {
            clearTimeout(clickTimeoutRef.current);
            clickTimeoutRef.current = null;
          }
          // Trigger Zoom logic
          if (refToUse.current) {
            const { zoomIn, resetTransform, instance } = refToUse.current;
            if (instance.transformState.scale > 1) {
              resetTransform();
            } else {
              // Zoom to center (or maybe standard 2x)
              zoomIn(0.5);
            }
          }
        } else {
          // First Tap - Wait
          clickTimeoutRef.current = setTimeout(() => {
            useViewerStore.getState().toggleUI();
            clickTimeoutRef.current = null;
          }, DOUBLE_TAP_DELAY);
        }
        lastTapTimeRef.current = now;
      } else {
        // Prevent nav if zoomed
        // We rely on isZoomed state. For vertical mode (multiple zoom instances),
        // checking the specfic instance scale is better?
        // But simply checking global 'isZoomed' might be tricky if we have multiple instances.
        // For vertical, we might just allow nav? Or check the ref.

        let currentScale = 1;
        if (refToUse.current) {
          currentScale = refToUse.current.instance.transformState.scale;
        }

        if (currentScale > 1.01) {
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
    },
    [clickDirection, onNext, onPrev], // removed isZoomed dependency, check ref directly
  );

  return {
    transformComponentRef,
    isZoomed,
    setIsZoomed,
    handleContentClick,
  };
}
