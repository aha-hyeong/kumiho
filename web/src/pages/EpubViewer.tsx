import { useRef, useCallback, useState, useEffect, useMemo, useId, type MouseEvent } from "react";
import { isOldIOSSafari } from "../utils/browserDetect";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Settings,
  Maximize,
  Minimize,
  List,
  Shield,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Music,
  Sparkles,
  LayoutGrid,
} from "lucide-react";
import type {
  EpubFlow,
  EpubFontFamily,
  EpubRenderMode,
  EpubViewerSettings,
  EpubTheme,
} from "../stores/epubViewerStore";
import type { BGMInfo } from "../features/viewer/types";
import { useAtmosphereStore } from "../stores/atmosphereStore";
import { AtmospherePopover } from "../features/viewer/components/AtmospherePopover";
import { ChapterListModal } from "../features/viewer/components";
import {
  EpubChapterViewer,
  type EpubTOCItem,
  type EpubInitialOpenMode,
  type EpubRenderLayout,
} from "../features/epub-viewer/components/EpubChapterViewer";
import { EPUB_SCROLLED_PULL_THRESHOLD } from "../features/epub-viewer/components/EpubChapterViewer/constants";
import type { EpubChapterViewerHandles } from "../features/epub-viewer/components/EpubChapterViewer";
import { EpubSettingsPanel } from "../features/epub-viewer/components/EpubSettingsPanel";
import { EpubTOC } from "../features/epub-viewer/components/EpubTOC";
import { ChapterNavHint } from "../features/viewer/components/ChapterNavHint";
import { PullIndicator } from "../features/viewer/components/PullIndicator";
import styles from "./EpubViewer.module.css";

interface EpubViewerProps {
  chapterTitle: string;
  chapterId: string;
  epubUrl: string;
  initialCFI?: string | null;
  initialProgressRatio?: number | null;
  initialOpenMode?: EpubInitialOpenMode;
  currentPage: number;
  totalPages: number;
  visiblePage: number;
  visibleTotalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isTOCOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  globalProgress: number;
  isAtFirstPage: boolean;
  isAtLastPage: boolean;
  toc: EpubTOCItem[];
  settings: EpubViewerSettings;
  onBack: () => void;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onToggleTOC: () => void;
  onCloseTOC: () => void;
  onToggleFullscreen: () => void;
  onReady: (totalPages: number) => void;
  onTOCLoad: (toc: EpubTOCItem[]) => void;
  onLocationChange: (location: {
    cfi: string;
    chapterPage: number;
    chapterTotal: number;
    globalRatio: number;
    currentPosition: number;
    totalPositions: number;
    chapterHref: string;
    spineIndex: number;
    spineLength: number;
    atStart?: boolean;
    atEnd?: boolean;
  }) => void;
  onViewerClick: () => void; // iframe 내부 클릭 핸들러
  onFontSizeChange: (size: number) => void;
  onFontFamilyChange: (family: EpubFontFamily) => void;
  onLineHeightChange: (height: number) => void;
  onThemeChange: (theme: EpubTheme) => void;
  onRenderModeChange: (mode: EpubRenderMode) => void;
  onFlowChange: (flow: EpubFlow) => void;
  hideChapterPageInfo?: boolean;
  onWheelDirectionChange: (direction: "down" | "up") => void;
  onKeyboardDirectionChange: (direction: "right" | "left") => void;
  onClickDirectionChange: (direction: "right" | "left") => void;
  onSpreadChange: (spread: "auto" | "none") => void;
  onReachedEndNext?: () => void;
  isEndNavigationReady?: boolean;
  onReachedStartPrev?: () => void;
  isStartNavigationReady?: boolean;
  nextChapterTitle?: string | null;
  prevChapterTitle?: string | null;
  bgmInfo?: BGMInfo | null;
  isBgmPlaying?: boolean;
  onToggleBgm?: () => void;
  seriesId?: string;
  isChapterListOpen?: boolean;
  onOpenChapterList?: () => void;
  onCloseChapterList?: () => void;
  onChapterNavigate?: (chapterId: string) => void;
  onInitializationComplete?: () => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
}

const THEME_BG: Record<string, string> = {
  light: "#ffffff",
  dark: "#1a1a1a",
  sepia: "#f4ecd8",
};
const CHAPTER_NAV_HINT_DURATION_MS = 3000;

export function EpubViewer({
  chapterTitle,
  chapterId,
  epubUrl,
  initialCFI,
  initialProgressRatio,
  initialOpenMode = "default",
  currentPage,
  totalPages,
  visiblePage,
  visibleTotalPages,
  isUIVisible,
  isSettingsOpen,
  isTOCOpen,
  isFullscreen,
  isIncognito,
  globalProgress,
  toc,
  settings,
  onBack,
  onToggleSettings,
  onCloseSettings,
  onToggleTOC,
  onCloseTOC,
  onToggleFullscreen,
  onReady,
  onTOCLoad,
  onLocationChange,
  onViewerClick,
  onFontSizeChange,
  onFontFamilyChange,
  onLineHeightChange,
  onThemeChange,
  onRenderModeChange,
  onFlowChange,
  hideChapterPageInfo = false,
  onWheelDirectionChange,
  onKeyboardDirectionChange,
  onClickDirectionChange,
  onSpreadChange,
  onReachedEndNext,
  isEndNavigationReady = true,
  onReachedStartPrev,
  isStartNavigationReady = true,
  nextChapterTitle,
  prevChapterTitle,
  bgmInfo,
  isBgmPlaying = true,
  onToggleBgm,
  seriesId,
  isChapterListOpen = false,
  onOpenChapterList,
  onCloseChapterList,
  onChapterNavigate,
  onInitializationComplete,
  onInteractionStart,
  onInteractionEnd,
}: EpubViewerProps) {
  const { t } = useTranslation();
  const viewerRef = useRef<EpubChapterViewerHandles>(null);
  const mainRef = useRef<HTMLElement>(null);
  const lastTouchTimeRef = useRef(0);
  const bgColor = THEME_BG[settings.theme] || "#ffffff";
  const [currentChapterHref, setCurrentChapterHref] = useState("");
  const [effectiveLayout, setEffectiveLayout] = useState<EpubRenderLayout>("book");
  const [hoveredProgressRatio, setHoveredProgressRatio] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<{ ratio: number; label: string } | null>(null);
  const [pendingProgressRatio, setPendingProgressRatio] = useState<number | null>(null);
  const [chapterPageDisplay, setChapterPageDisplay] = useState(visiblePage);
  const [chapterTotalDisplay, setChapterTotalDisplay] = useState(visibleTotalPages);
  const [scrolledPullOffset, setScrolledPullOffset] = useState(0);
  const [spinePosition, setSpinePosition] = useState({
    spineIndex: 0,
    spineLength: 0,
    atStart: undefined as boolean | undefined,
    atEnd: undefined as boolean | undefined,
  });
  const [nextHintTriggeredChapterId, setNextHintTriggeredChapterId] = useState<string | null>(null);
  const [prevHintTriggeredChapterId, setPrevHintTriggeredChapterId] = useState<string | null>(null);
  const hintTimeoutRef = useRef<number | null>(null);
  const showNextHint = nextHintTriggeredChapterId === chapterId;
  const showPrevHint = prevHintTriggeredChapterId === chapterId;

  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current !== null) {
        window.clearTimeout(hintTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setChapterPageDisplay(Math.max(1, visiblePage));
  }, [visiblePage]);

  useEffect(() => {
    setChapterTotalDisplay(Math.max(1, visibleTotalPages));
  }, [visibleTotalPages]);

  // Atmosphere
  const isAtmosphereEnabled = useAtmosphereStore((state) => state.isEnabled);
  const setAtmosphereEnabled = useAtmosphereStore((state) => state.setEnabled);
  const atmosphereButtonRef = useRef<HTMLButtonElement>(null);
  const atmospherePopoverId = useId();
  const [isAtmospherePopoverOpen, setIsAtmospherePopoverOpen] = useState(false);
  const handleCloseAtmospherePopover = useCallback(() => {
    setIsAtmospherePopoverOpen(false);
  }, []);
  const handleAtmosphereClick = useCallback(() => {
    if (isAtmosphereEnabled) {
      setAtmosphereEnabled(false);
      setIsAtmospherePopoverOpen(false);
    } else {
      setIsAtmospherePopoverOpen((prev) => !prev);
    }
  }, [isAtmosphereEnabled, setAtmosphereEnabled]);
  const showsAtmosphereDialogState = isAtmospherePopoverOpen || !isAtmosphereEnabled;
  const atmosphereButtonLabel = isAtmosphereEnabled
    ? t("viewer.header.atmosphere_off")
    : isAtmospherePopoverOpen
      ? t("viewer.header.atmosphere_settings_close")
      : t("viewer.header.atmosphere_settings_open");

  const getZoneRatio = useCallback((clientX: number, element: HTMLElement | null): number => {
    const rect = element?.getBoundingClientRect();
    if (rect && rect.width > 0) {
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    }
    return Math.max(0, Math.min(1, clientX / Math.max(window.innerWidth, 1)));
  }, []);

  const currentTocLabel = useMemo(() => {
    const currentBase = currentChapterHref.split("#")[0];
    if (!currentBase) return chapterTitle;

    const findLabel = (items: EpubTOCItem[]): string | null => {
      for (const item of items) {
        const itemBase = item.href.split("#")[0];
        if (itemBase === currentBase) {
          return item.label || null;
        }
        if (item.subitems?.length) {
          const sub = findLabel(item.subitems);
          if (sub) return sub;
        }
      }
      return null;
    };

    return findLabel(toc) || chapterTitle;
  }, [currentChapterHref, toc, chapterTitle]);

  const clearPendingProgress = useCallback(() => {
    setPendingProgressRatio(null);
  }, []);

  const wrappedLocationChange = useCallback(
    (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
      chapterHref: string;
      spineIndex: number;
      spineLength: number;
      atStart?: boolean;
      atEnd?: boolean;
    }) => {
      setCurrentChapterHref(location.chapterHref);
      if (location.chapterPage > 0) {
        setChapterPageDisplay(location.chapterPage);
      }
      if (location.chapterTotal > 0) {
        setChapterTotalDisplay(location.chapterTotal);
      }
      setSpinePosition({
        spineIndex: location.spineIndex,
        spineLength: location.spineLength,
        atStart: location.atStart,
        atEnd: location.atEnd,
      });
      onLocationChange(location);
    },
    [onLocationChange],
  );

  const clearHintTimeout = useCallback(() => {
    if (hintTimeoutRef.current !== null) {
      window.clearTimeout(hintTimeoutRef.current);
      hintTimeoutRef.current = null;
    }
  }, []);

  const handleNext = useCallback(() => {
    const attemptNext = async () => {
      if (!viewerRef.current?.next) return;
      const moved = await viewerRef.current.next();
      if (moved) {
        if (showNextHint || showPrevHint) {
          clearHintTimeout();
          setNextHintTriggeredChapterId(null);
          setPrevHintTriggeredChapterId(null);
        }
        clearPendingProgress();
        return;
      }

      if (!isEndNavigationReady) return;
      if (showNextHint && onReachedEndNext) {
        clearHintTimeout();
        setNextHintTriggeredChapterId(null);
        onReachedEndNext();
        return;
      }
      if (onReachedEndNext && nextChapterTitle) {
        // 첫 번째 클릭: 힌트 표시
        clearHintTimeout();
        setPrevHintTriggeredChapterId(null);
        setNextHintTriggeredChapterId(chapterId);
        hintTimeoutRef.current = window.setTimeout(() => {
          setNextHintTriggeredChapterId(null);
          hintTimeoutRef.current = null;
        }, CHAPTER_NAV_HINT_DURATION_MS);
        return;
      }
      // nextChapterTitle이 없으면 힌트 문구를 구성할 수 없어 즉시 종료 플로우로 위임한다.
      onReachedEndNext?.();
    };

    void attemptNext();
  }, [
    onReachedEndNext,
    isEndNavigationReady,
    showNextHint,
    showPrevHint,
    nextChapterTitle,
    chapterId,
    clearPendingProgress,
    clearHintTimeout,
  ]);

  const isVisibleAtStart = chapterPageDisplay <= 1;
  const isVisibleAtEnd = chapterTotalDisplay > 0 && chapterPageDisplay >= chapterTotalDisplay;
  const hasInternalPrevPart = spinePosition.spineIndex > 0 || spinePosition.atStart === false;
  const hasInternalNextPart =
    (spinePosition.spineLength > 0 && spinePosition.spineIndex < spinePosition.spineLength - 1) ||
    spinePosition.atEnd === false;
  const canScrolledPullPrev = hasInternalPrevPart || Boolean(onReachedStartPrev);
  const canScrolledPullNext = hasInternalNextPart || Boolean(onReachedEndNext);
  const prevPullTitle = hasInternalPrevPart
    ? t("epub_viewer.scroll_pull.prev_part", { defaultValue: "이전 part" })
    : (prevChapterTitle ?? null);
  const nextPullTitle = hasInternalNextPart
    ? t("epub_viewer.scroll_pull.next_part", { defaultValue: "다음 part" })
    : (nextChapterTitle ?? null);
  const prevPullLabel = hasInternalPrevPart
    ? t("epub_viewer.scroll_pull.prev_part_label", { defaultValue: "▲ 이전 part" })
    : undefined;
  const nextPullLabel = hasInternalNextPart
    ? t("epub_viewer.scroll_pull.next_part_label", { defaultValue: "▼ 다음 part" })
    : undefined;
  const prevPullHint = hasInternalPrevPart
    ? t("epub_viewer.scroll_pull.prev_part_hint", { defaultValue: "계속 위로 스크롤하면 이전 part로 이동" })
    : undefined;
  const nextPullHint = hasInternalNextPart
    ? t("epub_viewer.scroll_pull.next_part_hint", { defaultValue: "계속 아래로 스크롤하면 다음 part로 이동" })
    : undefined;
  const prevPullAria = hasInternalPrevPart
    ? t("epub_viewer.scroll_pull.aria_prev_part", { defaultValue: "이전 part로 이동" })
    : undefined;
  const nextPullAria = hasInternalNextPart
    ? t("epub_viewer.scroll_pull.aria_next_part", { defaultValue: "다음 part로 이동" })
    : undefined;
  const noopSaveProgress = useCallback(() => Promise.resolve(), []);

  const handlePrev = useCallback(() => {
    const attemptPrev = async () => {
      if (!viewerRef.current?.prev) return;
      const moved = await viewerRef.current.prev();
      if (moved) {
        if (showNextHint || showPrevHint) {
          clearHintTimeout();
          setNextHintTriggeredChapterId(null);
          setPrevHintTriggeredChapterId(null);
        }
        clearPendingProgress();
        return;
      }

      if (!isStartNavigationReady) return;
      if (showPrevHint && onReachedStartPrev) {
        // 두 번째 클릭: 실제 이동
        clearHintTimeout();
        setPrevHintTriggeredChapterId(null);
        onReachedStartPrev();
        return;
      }
      if (onReachedStartPrev && prevChapterTitle) {
        // 첫 번째 클릭: 힌트 표시
        clearHintTimeout();
        setNextHintTriggeredChapterId(null);
        setPrevHintTriggeredChapterId(chapterId);
        hintTimeoutRef.current = window.setTimeout(() => {
          setPrevHintTriggeredChapterId(null);
          hintTimeoutRef.current = null;
        }, CHAPTER_NAV_HINT_DURATION_MS);
        return;
      }
      // prevChapterTitle이 없으면 힌트 문구를 구성할 수 없어 즉시 이동 플로우로 위임한다.
      onReachedStartPrev?.();
    };

    void attemptPrev();
  }, [
    isStartNavigationReady,
    onReachedStartPrev,
    showPrevHint,
    showNextHint,
    prevChapterTitle,
    chapterId,
    clearPendingProgress,
    clearHintTimeout,
  ]);

  const handleTOCJump = useCallback(
    (href: string) => {
      clearPendingProgress();
      viewerRef.current?.goToCFI(href);
    },
    [clearPendingProgress],
  );

  const handleSpreadToggle = useCallback(() => {
    onSpreadChange(settings.spread === "auto" ? "none" : "auto");
  }, [settings.spread, onSpreadChange]);

  const chapterMarkers = useMemo(() => {
    const flat: Array<{ id: string; href: string; target: string; ratio: number; label: string }> = [];
    const walk = (items: EpubTOCItem[]) => {
      items.forEach((item) => {
        if (typeof item.progressRatio === "number" && Number.isFinite(item.progressRatio)) {
          flat.push({
            id: item.id,
            href: item.href,
            target: item.navigationCfi || item.href,
            ratio: Math.max(0, Math.min(1, item.progressRatio)),
            label: item.label || "",
          });
        }
        if (item.subitems?.length) {
          walk(item.subitems);
        }
      });
    };
    walk(toc);
    const unique = new Map<string, { id: string; href: string; target: string; ratio: number; label: string }>();
    flat
      .sort((a, b) => a.ratio - b.ratio)
      .forEach((marker) => {
        const key = `${marker.ratio.toFixed(4)}-${marker.id}-${marker.target}`;
        if (!unique.has(key)) unique.set(key, marker);
      });
    return Array.from(unique.values());
  }, [toc]);

  const currentProgressRatio = useMemo(() => {
    if (pendingProgressRatio !== null) {
      return Math.max(0, Math.min(1, pendingProgressRatio));
    }
    if (totalPages > 1 && currentPage > 0) {
      return Math.max(0, Math.min(1, (currentPage - 1) / (totalPages - 1)));
    }
    return Math.max(0, Math.min(1, globalProgress / 100));
  }, [pendingProgressRatio, currentPage, totalPages, globalProgress]);

  const currentProgressPercent = useMemo(() => Math.round(currentProgressRatio * 100), [currentProgressRatio]);

  const ratioToPage = useCallback(
    (ratio: number) => {
      const total = Math.max(1, totalPages || 1);
      if (total <= 1) return 1;
      return Math.max(1, Math.min(total, Math.round(ratio * (total - 1)) + 1));
    },
    [totalPages],
  );

  const hoveredPage = useMemo(() => {
    if (hoveredMarker) {
      return ratioToPage(hoveredMarker.ratio);
    }
    if (hoveredProgressRatio === null) return null;
    return ratioToPage(hoveredProgressRatio);
  }, [hoveredMarker, hoveredProgressRatio, ratioToPage]);

  const hoveredChapterLabel = useMemo(() => {
    if (hoveredMarker) return hoveredMarker.label;
    if (hoveredProgressRatio === null || chapterMarkers.length === 0) return null;

    let current = chapterMarkers[0];
    for (let i = 1; i < chapterMarkers.length; i += 1) {
      if (chapterMarkers[i].ratio <= hoveredProgressRatio + 0.0001) {
        current = chapterMarkers[i];
      } else {
        break;
      }
    }
    return current.label;
  }, [hoveredMarker, hoveredProgressRatio, chapterMarkers]);

  const hoveredTooltipRatio = useMemo(() => {
    if (hoveredMarker) return hoveredMarker.ratio;
    return hoveredProgressRatio;
  }, [hoveredMarker, hoveredProgressRatio]);

  const getRatioFromEvent = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / Math.max(rect.width, 1);
    return Math.max(0, Math.min(1, ratio));
  }, []);

  const handleProgressHover = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      setHoveredProgressRatio(getRatioFromEvent(event));
    },
    [getRatioFromEvent],
  );

  const handleProgressLeave = useCallback(() => {
    setHoveredProgressRatio(null);
    setHoveredMarker(null);
  }, []);

  const handleProgressSeek = useCallback(
    (ratio: number) => {
      const clamped = Math.max(0, Math.min(1, ratio));
      setPendingProgressRatio(clamped);
      if (viewerRef.current?.goToProgress) {
        viewerRef.current.goToProgress(clamped);
        return;
      }
      if (totalPages > 0 && viewerRef.current?.goToPage) {
        const targetPage = Math.min(totalPages, Math.max(1, Math.round(clamped * (totalPages - 1)) + 1));
        viewerRef.current.goToPage(targetPage);
      }
    },
    [totalPages],
  );

  const handleMainClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      // 터치 직후 발생하는 Synthetic Click 무시 (500ms 이내)
      if (Date.now() - lastTouchTimeRef.current < 500) return;

      const target = event.target as HTMLElement | null;
      if (!target) return;

      const interactive = target.closest("button, input, select, textarea, a[href], [contenteditable='true']");
      if (interactive) return;

      // main 영역 기준 zone 판별 (좌 0~30% / 중앙 30~70% / 우 70~100%)
      const xRatio = getZoneRatio(event.clientX, event.currentTarget);

      if (xRatio >= 0.3 && xRatio <= 0.7) {
        // 중앙 클릭 → UI 토글
        onViewerClick();
        return;
      }
      if (settings.flow === "scrolled") return;

      // 좌/우 클릭 → 페이지 이동
      const isRTL = settings.clickDirection === "left";
      if (xRatio < 0.3) {
        if (isRTL) handleNext();
        else handlePrev();
      } else {
        if (isRTL) handlePrev();
        else handleNext();
      }
    },
    [getZoneRatio, handleNext, handlePrev, onViewerClick, settings.clickDirection, settings.flow],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName?.toLowerCase();
      const isEditable =
        tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable);
      if (isEditable) return;
      if (settings.flow === "scrolled") return;

      const nextArrowKey = settings.keyboardDirection === "right" ? "ArrowRight" : "ArrowLeft";
      const prevArrowKey = settings.keyboardDirection === "right" ? "ArrowLeft" : "ArrowRight";

      if (event.key === nextArrowKey || event.key === "PageDown") {
        event.preventDefault();
        handleNext();
      } else if (event.key === prevArrowKey || event.key === "PageUp") {
        event.preventDefault();
        handlePrev();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [settings.flow, settings.keyboardDirection, handleNext, handlePrev]);

  // === 구형 iOS Safari: <main>에 터치 이벤트 핸들러 등록 ===
  // iframe pointer-events:none으로 터치가 관통하므로 부모에서 처리한다.
  useEffect(() => {
    if (!isOldIOSSafari()) return;
    const mainEl = mainRef.current;
    if (!mainEl) return;

    let startPos: { x: number; y: number } | null = null;
    let dragging = false;

    const onTouchStart = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      // UI 요소(헤더/푸터/설정/TOC) 위의 터치는 무시
      const target = e.target as HTMLElement | null;
      if (target?.closest("header, footer, [data-epub-settings], [data-epub-toc]")) return;
      startPos = { x: touch.clientX, y: touch.clientY };
      dragging = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!startPos) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startPos.x;
      const dy = touch.clientY - startPos.y;
      if (Math.sqrt(dx * dx + dy * dy) > 8) dragging = true;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!startPos) return;

      // 터치 완료 기록 (Synthetic click 무시용)
      lastTouchTimeRef.current = Date.now();

      if (dragging) {
        if (settings.flow === "scrolled") {
          startPos = null;
          dragging = false;
          return;
        }
        // 스와이프 감지
        const touch = e.changedTouches[0];
        if (touch) {
          const dx = touch.clientX - startPos.x;
          const dy = touch.clientY - startPos.y;
          const SWIPE_THRESHOLD = 50;
          if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            const isRTL = settings.clickDirection === "left";
            if (dx < 0) {
              if (isRTL) handlePrev();
              else handleNext();
            } else {
              if (isRTL) handleNext();
              else handlePrev();
            }
          }
        }
        startPos = null;
        dragging = false;
        return;
      }

      // 탭: zone 기반 판별
      const clientX = e.changedTouches[0]?.clientX ?? startPos.x;
      const ratio = getZoneRatio(clientX, mainEl);
      startPos = null;

      if (ratio >= 0.3 && ratio <= 0.7) {
        onViewerClick();
      } else if (settings.flow === "scrolled") {
        return;
      } else {
        const isRTL = settings.clickDirection === "left";
        if (ratio < 0.3) {
          if (isRTL) handleNext();
          else handlePrev();
        } else {
          if (isRTL) handlePrev();
          else handleNext();
        }
      }
    };

    mainEl.addEventListener("touchstart", onTouchStart, { passive: true });
    mainEl.addEventListener("touchmove", onTouchMove, { passive: true });
    mainEl.addEventListener("touchend", onTouchEnd);

    return () => {
      mainEl.removeEventListener("touchstart", onTouchStart);
      mainEl.removeEventListener("touchmove", onTouchMove);
      mainEl.removeEventListener("touchend", onTouchEnd);
    };
  }, [getZoneRatio, settings.clickDirection, settings.flow, handleNext, handlePrev, onViewerClick]);

  return (
    <div
      className={styles.root}
      style={{ background: bgColor }}
      data-incognito={isIncognito}
    >
      {/* 헤더 */}
      <header
        className={`${styles.header} ${isUIVisible ? styles.visible : styles.hidden}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onInteractionStart}
        onMouseLeave={onInteractionEnd}
      >
        <button
          className={styles.iconBtn}
          onClick={onBack}
          title={t("epub_viewer.header.back")}
          aria-label={t("epub_viewer.header.back")}
        >
          <ArrowLeft size={24} />
        </button>

        <div className={styles.headerTitle}>
          {isIncognito && (
            <div
              className={styles.headerIcon}
              aria-label={t("epub_viewer.header.incognito")}
            >
              <Shield size={20} />
            </div>
          )}
          <span className={styles.chapterTitle}>{chapterTitle}</span>
        </div>

        <div className={styles.headerActions}>
          <button
            className={styles.iconBtn}
            onClick={onToggleFullscreen}
            title={isFullscreen ? t("epub_viewer.header.exit_fullscreen") : t("epub_viewer.header.fullscreen")}
            aria-label={isFullscreen ? t("epub_viewer.header.exit_fullscreen") : t("epub_viewer.header.fullscreen")}
          >
            {isFullscreen ? <Minimize size={24} /> : <Maximize size={24} />}
          </button>
          <button
            className={`${styles.iconBtn} ${isTOCOpen ? styles.active : ""}`}
            onClick={onToggleTOC}
            title={t("epub_viewer.header.toc")}
            aria-label={t("epub_viewer.header.toc")}
          >
            <List size={24} />
          </button>

          {/* 앰비언트 사운드 */}
          <button
            ref={atmosphereButtonRef}
            className={`${styles.iconBtn} ${!isAtmosphereEnabled ? styles.muted : ""}`}
            onClick={handleAtmosphereClick}
            title={atmosphereButtonLabel}
            aria-label={atmosphereButtonLabel}
            aria-haspopup={showsAtmosphereDialogState ? "dialog" : undefined}
            aria-expanded={showsAtmosphereDialogState ? isAtmospherePopoverOpen : undefined}
            aria-controls={isAtmospherePopoverOpen ? atmospherePopoverId : undefined}
          >
            <Sparkles
              size={24}
              fill={isAtmosphereEnabled ? "currentColor" : "none"}
            />
          </button>
          {isAtmospherePopoverOpen && (
            <AtmospherePopover
              onClose={handleCloseAtmospherePopover}
              triggerRef={atmosphereButtonRef}
              id={atmospherePopoverId}
            />
          )}

          <button
            className={`${styles.iconBtn} ${isSettingsOpen ? styles.active : ""}`}
            onClick={onToggleSettings}
            title={t("epub_viewer.header.settings")}
            aria-label={t("epub_viewer.header.settings")}
          >
            <Settings size={24} />
          </button>

          {/* BGM */}
          {bgmInfo?.exists && (
            <button
              className={`${styles.iconBtn} ${!isBgmPlaying ? styles.muted : ""}`}
              onClick={onToggleBgm}
              title={isBgmPlaying ? t("viewer.header.bgm_off") : t("viewer.header.bgm_on")}
              aria-label={isBgmPlaying ? t("viewer.header.bgm_off") : t("viewer.header.bgm_on")}
              aria-pressed={isBgmPlaying}
            >
              <Music size={24} />
            </button>
          )}
        </div>
      </header>

      {/* 설정 패널 + 백드롭 */}
      {isSettingsOpen && (
        <>
          <div
            className={styles.backdrop}
            onClick={onCloseSettings}
            onMouseEnter={onInteractionStart}
            onMouseLeave={onInteractionEnd}
          />
          <div
            data-epub-settings
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={onInteractionStart}
            onMouseLeave={onInteractionEnd}
          >
            <EpubSettingsPanel
              settings={settings}
              onFontSizeChange={onFontSizeChange}
              onFontFamilyChange={onFontFamilyChange}
              onLineHeightChange={onLineHeightChange}
              onThemeChange={onThemeChange}
              onRenderModeChange={onRenderModeChange}
              onFlowChange={onFlowChange}
              onSpreadChange={onSpreadChange}
              onWheelDirectionChange={onWheelDirectionChange}
              onKeyboardDirectionChange={onKeyboardDirectionChange}
              onClickDirectionChange={onClickDirectionChange}
              onClose={onCloseSettings}
              isTypographyControlLimited={effectiveLayout === "comic"}
            />
          </div>
        </>
      )}

      {/* 목차 패널 + 백드롭 */}
      {isTOCOpen && (
        <>
          <div
            className={styles.backdrop}
            onClick={onToggleTOC}
            onMouseEnter={onInteractionStart}
            onMouseLeave={onInteractionEnd}
          />
          <div
            data-epub-toc
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={onInteractionStart}
            onMouseLeave={onInteractionEnd}
          >
            <EpubTOC
              toc={toc}
              onItemClick={handleTOCJump}
              currentChapterHref={currentChapterHref}
              onClose={onCloseTOC}
            />
          </div>
        </>
      )}

      {/* EPUB 뷰어 영역 */}
      <main
        ref={mainRef}
        className={`${styles.main} ${settings.flow === "scrolled" ? styles.mainScrolled : ""}`}
        onClick={handleMainClick}
      >
        <EpubChapterViewer
          key={chapterId}
          ref={viewerRef}
          epubUrl={epubUrl}
          chapterId={chapterId}
          chapterTitle={currentTocLabel}
          chapterPage={chapterPageDisplay}
          chapterTotal={chapterTotalDisplay}
          globalProgressPercent={currentProgressPercent >= 0 ? currentProgressPercent : undefined}
          isUIVisible={isUIVisible}
          initialCFI={initialCFI}
          initialProgressRatio={initialProgressRatio}
          initialOpenMode={initialOpenMode}
          settings={settings}
          onReady={onReady}
          onTOCLoad={onTOCLoad}
          onLocationChange={wrappedLocationChange}
          onViewerClick={onViewerClick}
          onInitializationComplete={onInitializationComplete}
          onPageNext={handleNext}
          onPagePrev={handlePrev}
          onRenderLayoutChange={setEffectiveLayout}
          hideChapterPageInfo={hideChapterPageInfo}
          canScrolledPullPrev={canScrolledPullPrev}
          canScrolledPullNext={canScrolledPullNext}
          onScrolledPullStateChange={(s) => setScrolledPullOffset(s.pullOffset)}
        />
      </main>

      {/* 세로 스크롤 모드 당김 인디케이터 */}
      {settings.flow === "scrolled" && (
        <>
          <PullIndicator
            type="prev"
            pullOffset={scrolledPullOffset}
            pullThreshold={EPUB_SCROLLED_PULL_THRESHOLD}
            chapterId={null}
            chapterTitle={prevPullTitle}
            saveProgress={noopSaveProgress}
            onActivate={canScrolledPullPrev ? handlePrev : undefined}
            labelText={prevPullLabel}
            hintText={prevPullHint}
            ariaActionLabel={prevPullAria}
          />
          <PullIndicator
            type="next"
            pullOffset={scrolledPullOffset}
            pullThreshold={EPUB_SCROLLED_PULL_THRESHOLD}
            chapterId={null}
            chapterTitle={nextPullTitle}
            saveProgress={noopSaveProgress}
            onActivate={canScrolledPullNext ? handleNext : undefined}
            labelText={nextPullLabel}
            hintText={nextPullHint}
            ariaActionLabel={nextPullAria}
          />
        </>
      )}

      {/* 챕터 이동 힌트 */}
      <ChapterNavHint
        type="next"
        title={nextChapterTitle || ""}
        show={showNextHint && !!nextChapterTitle}
      />
      <ChapterNavHint
        type="prev"
        title={prevChapterTitle || ""}
        show={showPrevHint && !!prevChapterTitle}
      />

      {/* 시리즈 목록 모달 */}
      {seriesId && (
        <ChapterListModal
          seriesId={seriesId}
          currentChapterId={chapterId}
          isOpen={isChapterListOpen}
          onClose={onCloseChapterList ?? (() => {})}
          onNavigate={onChapterNavigate ?? (() => {})}
        />
      )}

      {/* 푸터 */}
      <footer
        className={`${styles.footer} ${!isUIVisible ? styles.hidden : ""}`}
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={onInteractionStart}
        onMouseLeave={onInteractionEnd}
      >
        <div className={styles.footerControls}>
          <button
            className={styles.navBtn}
            onClick={() => viewerRef.current?.goToProgress?.(0)}
            disabled={isVisibleAtStart}
            aria-label={t("epub_viewer.footer.first_page")}
          >
            <ChevronsLeft size={20} />
          </button>
          <button
            className={styles.navBtn}
            onClick={handlePrev}
            disabled={isVisibleAtStart && (!onReachedStartPrev || !isStartNavigationReady)}
            aria-label={t("epub_viewer.footer.prev_page")}
          >
            <ChevronLeft size={20} />
          </button>

          <div className={styles.pageSliderContainer}>
            <div className={styles.progressBarWrap}>
              <div
                className={styles.progressBarInteractive}
                onMouseMove={handleProgressHover}
                onMouseLeave={handleProgressLeave}
                onClick={(event) => handleProgressSeek(getRatioFromEvent(event))}
                role="slider"
                tabIndex={0}
                aria-label={t("epub_viewer.footer.progress")}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={
                  currentProgressPercent >= 0 ? currentProgressPercent : Math.round(currentProgressRatio * 100)
                }
                onKeyDown={(event) => {
                  let nextRatio = currentProgressRatio;
                  const step = 0.05;
                  if (event.key === "ArrowRight") {
                    event.preventDefault();
                    nextRatio = Math.min(1, currentProgressRatio + step);
                  } else if (event.key === "ArrowLeft") {
                    event.preventDefault();
                    nextRatio = Math.max(0, currentProgressRatio - step);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    nextRatio = 0;
                  } else if (event.key === "End") {
                    event.preventDefault();
                    nextRatio = 1;
                  } else {
                    return;
                  }
                  handleProgressSeek(nextRatio);
                }}
              >
                <div className={styles.progressBarTrack}>
                  <div
                    className={styles.progressBarFill}
                    style={{ width: `${currentProgressRatio * 100}%` }}
                  />
                  <div
                    className={styles.progressBarThumb}
                    style={{ left: `${currentProgressRatio * 100}%` }}
                  />
                  {chapterMarkers.map((marker) => (
                    <button
                      key={`${marker.id}-${marker.href}-${marker.ratio}`}
                      type="button"
                      className={styles.progressMarker}
                      style={{ left: `${marker.ratio * 100}%` }}
                      title={marker.label || marker.href}
                      aria-label={t("epub_viewer.progress_marker.navigate", {
                        label: marker.label || marker.href,
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        setPendingProgressRatio(marker.ratio);
                        viewerRef.current?.goToCFI(marker.target);
                        (event.currentTarget as HTMLButtonElement).blur();
                      }}
                      onMouseEnter={() => setHoveredMarker({ ratio: marker.ratio, label: marker.label })}
                      onMouseLeave={() => setHoveredMarker(null)}
                    />
                  ))}
                </div>
                {hoveredTooltipRatio !== null && hoveredPage !== null && (
                  <div
                    className={styles.progressTooltip}
                    style={{ left: `${hoveredTooltipRatio * 100}%` }}
                  >
                    {hoveredChapterLabel && <span className={styles.progressTooltipLabel}>{hoveredChapterLabel}</span>}
                    <span>{hoveredPage} P</span>
                  </div>
                )}
              </div>
            </div>
            <div className={styles.pageInfo}>
              {currentPage >= 0 && (
                <span className={styles.pageInfoClickable}>
                  {chapterPageDisplay > 0 && chapterTotalDisplay > 0 ? (
                    <>
                      {chapterPageDisplay} / {chapterTotalDisplay} P
                      {currentProgressPercent >= 0 && (
                        <span style={{ fontSize: "0.85em", opacity: 0.8, marginLeft: "8px" }}>
                          | {currentProgressPercent}%
                        </span>
                      )}
                    </>
                  ) : (
                    <>{currentProgressPercent >= 0 ? `${currentProgressPercent}%` : ""}</>
                  )}
                </span>
              )}
            </div>
          </div>

          <button
            className={styles.navBtn}
            onClick={handleNext}
            disabled={isVisibleAtEnd && (!onReachedEndNext || !isEndNavigationReady)}
            aria-label={t("epub_viewer.footer.next_page")}
          >
            <ChevronRight size={20} />
          </button>
          <button
            className={styles.navBtn}
            onClick={() => viewerRef.current?.goToProgress?.(1)}
            disabled={isVisibleAtEnd}
            aria-label={t("epub_viewer.footer.last_page")}
          >
            <ChevronsRight size={20} />
          </button>

          {/* 토글 버튼 (태블릿/데스크탑) */}
          {settings.flow === "paginated" && (
            <div className={styles.footerToggles}>
              <button
                className={`${styles.toggleBtn} ${settings.spread === "auto" ? styles.active : ""}`}
                onClick={handleSpreadToggle}
              >
                {settings.spread === "auto" ? t("epub_viewer.footer.pages_2") : t("epub_viewer.footer.pages_1")}
              </button>
            </div>
          )}

          {/* 시리즈 목록 */}
          {seriesId && onOpenChapterList && (
            <button
              className={styles.navBtn}
              onClick={onOpenChapterList}
              title={t("viewer.footer.chapter_list")}
              aria-label={t("viewer.footer.chapter_list")}
            >
              <LayoutGrid size={20} />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
