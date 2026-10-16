import { useCallback, useEffect, useRef } from "react";
import { useViewerStore } from "../../../stores/viewerStore";
import { UI_HIDE_DELAY } from "../utils/constants";

type ViewerAutoHideInput = {
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  currentPage: number;
};

export function useViewerAutoHide({ isUIVisible, isSettingsOpen, currentPage }: ViewerAutoHideInput) {
  const uiTimerRef = useRef<number | null>(null);
  const uiShownTimeRef = useRef(0);
  const isInteractingRef = useRef(false);

  useEffect(() => {
    if (isUIVisible) uiShownTimeRef.current = Date.now();
  }, [isUIVisible]);

  const resetUITimer = useCallback(() => {
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    if (!isSettingsOpen && !isInteractingRef.current) {
      uiTimerRef.current = window.setTimeout(() => {
        useViewerStore.getState().hideUI();
      }, UI_HIDE_DELAY);
    }
  }, [isSettingsOpen]);

  const handleInteractionStart = useCallback(() => {
    isInteractingRef.current = true;
    if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    isInteractingRef.current = false;
    if (!isUIVisible) return;
    const elapsed = Date.now() - uiShownTimeRef.current;
    if (elapsed >= UI_HIDE_DELAY) {
      useViewerStore.getState().hideUI();
      return;
    }
    resetUITimer();
  }, [isUIVisible, resetUITimer]);

  useEffect(() => {
    if (isUIVisible) {
      resetUITimer();
    } else if (uiTimerRef.current) {
      window.clearTimeout(uiTimerRef.current);
      uiTimerRef.current = null;
    }
    return () => {
      if (uiTimerRef.current) window.clearTimeout(uiTimerRef.current);
    };
  }, [isUIVisible, resetUITimer, currentPage]);

  return { handleInteractionStart, handleInteractionEnd };
}
