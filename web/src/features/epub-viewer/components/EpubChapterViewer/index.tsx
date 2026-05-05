import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle, useState } from "react";
import Epub from "epubjs";
import type { Book, Contents, Rendition } from "epubjs";
import type { EpubViewerSettings } from "../../../../stores/epubViewerStore";
import { calculateGlobalProgress } from "../../utils/epubUtils";
import {
  detectLayoutFromDocument,
  detectLayoutFromPackageMetadata,
  detectLayoutFromSpine,
  resolveEffectiveLayout,
  type EpubRenderLayout,
} from "../../utils/layoutMode";
import { buildEpubInjectedStyle, getEpubThemeStyle } from "./styleBuilder";
import styles from "./EpubChapterViewer.module.css";
import { getSafeLocationFromCfi, isLikelyEpubCfi } from "./cfiGuards";
import { applyOldIOSSafariPointerEventFallback } from "./iosTouchFallback";
import { applyEpubLineHeightScale } from "./lineHeightScale";
import {
  asEpubRenditionSnapshot,
  type EpubContentSnapshot,
  type EpubjsLocation,
  type EpubjsLocationsExtended,
  type EpubjsNavigationItem,
  type EpubjsSection,
  type EpubjsSpine,
} from "./epubjsSnapshots";
import {
  EPUB_LOCATION_STRIDE,
  getSafeCfiFromLocation,
  getSafeCfiFromPercentage,
  getSafeLocationLength,
  safeDecodeFragment,
  safeDecodeURIComponent,
  toLocationRatio,
} from "./locationUtils";
import { getWheelNavigationAction } from "./wheelNavigation";
import { EPUB_SCROLLED_PULL_THRESHOLD } from "./constants";
import { getScrolledPullCompletionAction } from "./scrolledPull";

export type { EpubRenderLayout } from "../../utils/layoutMode";

export interface EpubChapterViewerHandles {
  next: () => Promise<boolean>;
  prev: () => Promise<boolean>;
  goToCFI: (cfi: string) => void;
  goToProgress: (ratio: number) => void;
  goToPage: (page: number) => void;
}

interface ScrolledPullState {
  pullOffset: number;
  isTouching: boolean;
}

export type EpubInitialOpenMode = "default" | "last";

export interface EpubTOCItem {
  id: string;
  label: string;
  href: string;
  navigationCfi?: string;
  progressRatio?: number;
  progressPrecision?: "estimated" | "precise";
  subitems?: EpubTOCItem[];
}

interface EpubChapterViewerProps {
  epubUrl: string;
  chapterId: string;
  chapterTitle: string;
  chapterPage: number;
  chapterTotal: number;
  globalProgressPercent?: number;
  isUIVisible: boolean;
  initialCFI?: string | null;
  initialProgressRatio?: number | null;
  initialOpenMode?: EpubInitialOpenMode;
  settings: EpubViewerSettings;
  onReady?: (totalLocations: number) => void;
  onTOCLoad?: (toc: EpubTOCItem[]) => void;
  onLocationChange?: (location: {
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
  onViewerClick?: () => void;
  onInitializationComplete?: () => void;
  onPageNext?: () => void;
  onPagePrev?: () => void;
  onRenderLayoutChange?: (layout: EpubRenderLayout) => void;
  hideChapterPageInfo?: boolean;
  canScrolledPullPrev?: boolean;
  canScrolledPullNext?: boolean;
  onScrolledPullStateChange?: (state: ScrolledPullState) => void;
}

const EPUB_VIEWER_STYLE_ID = "kumiho-epub-viewer-settings";
const SCROLLED_PULL_SENSITIVITY = 1.0;
const SCROLLED_PULL_MAX = 180;
const SCROLLED_PULL_WHEEL_COOLDOWN_MS = 150;
const SCROLLED_PULL_NAVIGATION_LOCK_MS = 450;

interface NavigationSnapshot {
  cfi: string | null;
  page: number;
  index: number;
  scrollLeft: number;
  scrollTop: number;
}

const EpubChapterViewer = forwardRef<EpubChapterViewerHandles, EpubChapterViewerProps>(
  (
    {
      epubUrl,
      chapterId,
      chapterTitle,
      chapterPage,
      chapterTotal,
      globalProgressPercent,
      isUIVisible,
      initialCFI,
      initialProgressRatio,
      initialOpenMode = "default",
      settings,
      onReady,
      onTOCLoad,
      onLocationChange,
      onViewerClick,
      onInitializationComplete,
      onPageNext,
      onPagePrev,
      onRenderLayoutChange,
      hideChapterPageInfo = false,
      canScrolledPullPrev = false,
      canScrolledPullNext = false,
      onScrolledPullStateChange,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const locationsReadyRef = useRef(false);
    const invalidPreciseHrefSetRef = useRef<Set<string>>(new Set());
    const generatedTotalRef = useRef(0);
    const [scrolledPullOffset, setScrolledPullOffsetState] = useState(0);
    const [isScrolledPullTouching, setIsScrolledPullTouchingState] = useState(false);

    // 최신 콜백을 ref로 유지 (stale closure 방지)
    const onViewerClickRef = useRef(onViewerClick);
    const onLocationChangeRef = useRef(onLocationChange);
    const onReadyRef = useRef(onReady);
    const onTOCLoadRef = useRef(onTOCLoad);
    const onInitializationCompleteRef = useRef(onInitializationComplete);
    const onPageNextRef = useRef(onPageNext);
    const onPagePrevRef = useRef(onPagePrev);
    const onRenderLayoutChangeRef = useRef(onRenderLayoutChange);
    const onScrolledPullStateChangeRef = useRef(onScrolledPullStateChange);
    const canScrolledPullPrevRef = useRef(canScrolledPullPrev);
    const canScrolledPullNextRef = useRef(canScrolledPullNext);
    const settingsRef = useRef(settings);
    const lastWheelNavigationAtRef = useRef(0);
    const lastScrolledPullWheelAtRef = useRef(0);
    const scrolledPullOffsetRef = useRef(0);
    const isScrolledPullTouchingRef = useRef(false);
    const scrolledPullFrameRef = useRef<number | null>(null);
    const scrolledPullLastYRef = useRef<number | null>(null);
    const scrolledPullNavigationLockRef = useRef(false);
    const scrolledPullNavigationLockTimerRef = useRef<number | null>(null);
    const detectedLayoutRef = useRef<EpubRenderLayout>("book");
    const effectiveLayoutRef = useRef<EpubRenderLayout>("book");
    const allowContentHeuristicRef = useRef(true);
    const autoLayoutLockedRef = useRef(false);
    const isNavigatingRef = useRef(false);
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const touchHandledRef = useRef(false);
    const lastAppliedSpreadRef = useRef<"auto" | "none" | null>(null);
    const contentDisposersRef = useRef<Map<Document, () => void>>(new Map());
    const tocRefreshSeqRef = useRef(0);
    const resizeFrameRef = useRef<number | null>(null);
    const lastContainerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
    const hasStableLocationRef = useRef(false);
    // 마지막으로 relocated 이벤트에서 받은 CFI — 리사이즈 시 epub.js가 내부 reflow로 위치를 잃기 전의 위치를 보존
    const lastStableCfiRef = useRef<string | null>(null);
    // 레이아웃 전환(spread/settings 변경) 직전에 캡처한 CFI — reflowRendition에서 currentLocation() 대신 사용
    const layoutTransitionAnchorRef = useRef<string | null>(null);
    // flow 변경으로 rendition 재생성 시 보존할 CFI — 새 rendition 초기화 시 initialCFI보다 우선 사용
    const flowTransitionAnchorRef = useRef<{ cfi: string; chapterId: string } | null>(null);
    // 초기 디스플레이(finalizeInit) 직후 highlight 표시할 CFI
    const pendingAnchorHighlightRef = useRef<string | null>(null);
    // highlight CSS 애니메이션 종료 후 클래스 제거를 위한 타이머
    const anchorHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // resize 안정화 후 앵커 하이라이트를 지연 표시하기 위한 debounce 타이머
    const resizeHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // stale closure 방지 — showAnchorHighlight 최신 참조
    const showAnchorHighlightRef = useRef<((cfi: string) => void) | null>(null);

    useEffect(() => {
      onViewerClickRef.current = onViewerClick;
    }, [onViewerClick]);
    useEffect(() => {
      onLocationChangeRef.current = onLocationChange;
    }, [onLocationChange]);
    useEffect(() => {
      onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
      onTOCLoadRef.current = onTOCLoad;
    }, [onTOCLoad]);
    useEffect(() => {
      onInitializationCompleteRef.current = onInitializationComplete;
    }, [onInitializationComplete]);
    useEffect(() => {
      onPageNextRef.current = onPageNext;
    }, [onPageNext]);
    useEffect(() => {
      onPagePrevRef.current = onPagePrev;
    }, [onPagePrev]);
    useEffect(() => {
      onRenderLayoutChangeRef.current = onRenderLayoutChange;
    }, [onRenderLayoutChange]);
    useEffect(() => {
      onScrolledPullStateChangeRef.current = onScrolledPullStateChange;
    }, [onScrolledPullStateChange]);
    useEffect(() => {
      canScrolledPullPrevRef.current = canScrolledPullPrev;
    }, [canScrolledPullPrev]);
    useEffect(() => {
      canScrolledPullNextRef.current = canScrolledPullNext;
    }, [canScrolledPullNext]);
    useEffect(() => {
      settingsRef.current = settings;
    }, [settings]);

    const publishScrolledPullState = useCallback((pullOffset: number, isTouching: boolean) => {
      onScrolledPullStateChangeRef.current?.({ pullOffset, isTouching });
    }, []);

    const setScrolledPullOffset = useCallback(
      (nextOffset: number) => {
        scrolledPullOffsetRef.current = nextOffset;
        setScrolledPullOffsetState(nextOffset);
        publishScrolledPullState(nextOffset, isScrolledPullTouchingRef.current);
      },
      [publishScrolledPullState],
    );

    const setScrolledPullTouching = useCallback(
      (nextTouching: boolean) => {
        isScrolledPullTouchingRef.current = nextTouching;
        setIsScrolledPullTouchingState(nextTouching);
        publishScrolledPullState(scrolledPullOffsetRef.current, nextTouching);
      },
      [publishScrolledPullState],
    );

    const resetScrolledPullOffset = useCallback(() => {
      if (scrolledPullFrameRef.current !== null) {
        cancelAnimationFrame(scrolledPullFrameRef.current);
        scrolledPullFrameRef.current = null;
      }
      setScrolledPullOffset(0);
    }, [setScrolledPullOffset]);

    const decayScrolledPullOffset = useCallback(() => {
      if (scrolledPullFrameRef.current !== null) {
        cancelAnimationFrame(scrolledPullFrameRef.current);
        scrolledPullFrameRef.current = null;
      }

      const decay = () => {
        const current = scrolledPullOffsetRef.current;
        if (current === 0) {
          scrolledPullFrameRef.current = null;
          return;
        }

        const next = current * 0.82;
        if (Math.abs(next) < 1) {
          setScrolledPullOffset(0);
          scrolledPullFrameRef.current = null;
          return;
        }

        setScrolledPullOffset(next);
        scrolledPullFrameRef.current = requestAnimationFrame(decay);
      };

      scrolledPullFrameRef.current = requestAnimationFrame(decay);
    }, [setScrolledPullOffset]);

    const triggerScrolledPullNavigation = useCallback((type: "prev" | "next") => {
      if (scrolledPullNavigationLockRef.current) return;

      scrolledPullNavigationLockRef.current = true;
      if (scrolledPullNavigationLockTimerRef.current !== null) {
        window.clearTimeout(scrolledPullNavigationLockTimerRef.current);
      }
      scrolledPullNavigationLockTimerRef.current = window.setTimeout(() => {
        scrolledPullNavigationLockRef.current = false;
        scrolledPullNavigationLockTimerRef.current = null;
      }, SCROLLED_PULL_NAVIGATION_LOCK_MS);

      if (type === "prev") onPagePrevRef.current?.();
      else onPageNextRef.current?.();
    }, []);

    const completeScrolledPull = useCallback(() => {
      const currentOffset = scrolledPullOffsetRef.current;
      scrolledPullLastYRef.current = null;
      setScrolledPullTouching(false);

      const action = getScrolledPullCompletionAction(
        currentOffset,
        canScrolledPullPrevRef.current,
        canScrolledPullNextRef.current,
      );

      if (action === "nav-prev" || action === "nav-next") {
        resetScrolledPullOffset();
        triggerScrolledPullNavigation(action === "nav-prev" ? "prev" : "next");
      } else if (action === "decay") {
        decayScrolledPullOffset();
      }
    }, [decayScrolledPullOffset, resetScrolledPullOffset, setScrolledPullTouching, triggerScrolledPullNavigation]);

    useEffect(() => {
      if (settings.flow === "scrolled") return;
      resetScrolledPullOffset();
      setScrolledPullTouching(false);
    }, [resetScrolledPullOffset, setScrolledPullTouching, settings.flow]);

    const showAnchorHighlight = useCallback((cfi: string) => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // 기존 타이머 정리
      if (anchorHighlightTimerRef.current !== null) {
        clearTimeout(anchorHighlightTimerRef.current);
        anchorHighlightTimerRef.current = null;
      }

      try {
        const range = (rendition as unknown as { getRange: (cfi: string) => Range | null }).getRange(cfi);
        if (!range) return;

        // 범위에서 블록 레벨 조상 요소로 이동
        let el: Element | null =
          range.commonAncestorContainer instanceof Element
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement;

        const BLOCK_TAGS = new Set([
          "P",
          "DIV",
          "SECTION",
          "ARTICLE",
          "BLOCKQUOTE",
          "H1",
          "H2",
          "H3",
          "H4",
          "H5",
          "H6",
          "LI",
          "TD",
          "TH",
          "PRE",
          "FIGURE",
        ]);
        while (el && !BLOCK_TAGS.has(el.tagName)) {
          el = el.parentElement;
        }
        if (!el) return;

        const doc = el.ownerDocument;

        // 기존 highlight 클래스 제거 후 재플로우 유도(애니메이션 재시작)
        const HIGHLIGHT_CLASS = "kumiho-anchor-highlight";
        const existing = doc.querySelector(`.${HIGHLIGHT_CLASS}`);
        if (existing) existing.classList.remove(HIGHLIGHT_CLASS);

        // iframe 문서에 CSS 주입 (중복 방지)
        const STYLE_ID = "kumiho-anchor-highlight-style";
        if (!doc.getElementById(STYLE_ID)) {
          const style = doc.createElement("style");
          style.id = STYLE_ID;
          style.textContent = [
            "@keyframes kumiho-anchor-pulse {",
            "  0%   { background-color: rgba(60,140,255,0.45); }",
            "  60%  { background-color: rgba(60,140,255,0.25); }",
            "  100% { background-color: rgba(60,140,255,0); }",
            "}",
            `.${HIGHLIGHT_CLASS} {`,
            "  animation: kumiho-anchor-pulse 2.8s ease-out forwards;",
            "  border-radius: 2px;",
            "}",
          ].join("\n");
          (doc.head ?? doc.documentElement).appendChild(style);
        }

        // 브라우저 reflow 강제 — 동일 요소에 클래스를 다시 추가할 때 애니메이션이 재시작되도록
        void el.getBoundingClientRect();
        el.classList.add(HIGHLIGHT_CLASS);

        const target = el;
        anchorHighlightTimerRef.current = setTimeout(() => {
          target.classList.remove(HIGHLIGHT_CLASS);
          anchorHighlightTimerRef.current = null;
        }, 3000);
      } catch (err) {
        console.warn("[EpubChapterViewer] anchor highlight failed:", err);
      }
    }, []);
    // ref를 통해 reflowRendition·finalizeInit 내부(stale closure)에서 최신 함수를 참조
    showAnchorHighlightRef.current = showAnchorHighlight;

    const reflowRendition = useCallback((forceRedisplay = false) => {
      const container = containerRef.current;
      const rendition = renditionRef.current;
      if (!container || !rendition) return;
      if (!hasStableLocationRef.current) return;

      const width = Math.round(container.clientWidth);
      const height = Math.round(container.clientHeight);
      if (width <= 0 || height <= 0) return;

      const previous = lastContainerSizeRef.current;
      if (!forceRedisplay && previous.width === width && previous.height === height) return;
      lastContainerSizeRef.current = { width, height };

      const anyRendition = asEpubRenditionSnapshot(rendition);

      // 레이아웃 전환(spread/settings 변경) 직전에 캡처한 anchor가 있으면 우선 사용.
      // 새 레이아웃 기준으로 오염된 currentLocation()의 CFI를 사용하면 보던 위치에서 벗어날 수 있어,
      // applySettings 호출 전에 미리 캡처한 CFI를 여기서 소비한다.
      let currentCfi: string | undefined;
      // layout transition 여부를 별도로 기록 — display 후 highlight 호출 여부 결정
      const wasLayoutTransition = !!layoutTransitionAnchorRef.current;
      if (layoutTransitionAnchorRef.current) {
        currentCfi = layoutTransitionAnchorRef.current;
        layoutTransitionAnchorRef.current = null;
      } else {
        // 리사이즈 시 epub.js가 내부적으로 먼저 reflow하여 currentLocation()이 1페이지를 반환할 수 있음.
        // relocated 이벤트에서 저장해 둔 lastStableCfiRef를 primary source로 사용한다.
        currentCfi = lastStableCfiRef.current ?? undefined;
        if (!currentCfi) {
          try {
            currentCfi = anyRendition.currentLocation?.()?.start?.cfi;
          } catch {
            return;
          }
        }
      }

      try {
        anyRendition.resize?.(width, height);
      } catch {
        return;
      }

      if (!currentCfi || isNavigatingRef.current) return;

      const displayCfi = currentCfi;
      void anyRendition
        .display(displayCfi)
        .then(() => {
          if (wasLayoutTransition) {
            // 레이아웃 전환(settings 변경)은 즉시 highlight 표시
            showAnchorHighlightRef.current?.(displayCfi);
          } else {
            // 리사이즈는 debounce로 안정화 후 highlight 표시
            // 드래그 중에는 타이머가 계속 리셋되어 깜빡임 방지
            if (resizeHighlightTimerRef.current !== null) {
              clearTimeout(resizeHighlightTimerRef.current);
            }
            resizeHighlightTimerRef.current = setTimeout(() => {
              resizeHighlightTimerRef.current = null;
              showAnchorHighlightRef.current?.(displayCfi);
            }, 300);
          }
        })
        .catch(() => {});
    }, []);

    const snapRenditionToVisualEnd = useCallback((rendition: Rendition): boolean => {
      try {
        const manager = asEpubRenditionSnapshot(rendition).manager;
        const container = manager?.container;
        if (!manager || !container) return false;

        if (manager.isPaginated === false) {
          container.scrollTop = Math.max(0, (container.scrollHeight ?? 0) - (container.clientHeight ?? 0));
          return true;
        }

        if (manager.isPaginated) {
          const direction = manager.settings?.direction;
          const scrollWidth = container.scrollWidth ?? 0;
          const clientWidth = container.clientWidth ?? 0;
          const delta = manager.layout?.delta || clientWidth;
          if (direction === "rtl") {
            container.scrollLeft = 0;
          } else {
            const maxScroll = Math.max(0, scrollWidth - clientWidth);
            container.scrollLeft = delta > 0 ? Math.floor(maxScroll / delta) * delta : maxScroll;
          }
          manager.updateOffset?.();
          return true;
        }
      } catch (err) {
        console.warn("[EpubChapterViewer] visual end snap failed:", err);
      }

      return false;
    }, []);

    const applyDocumentSettings = useCallback((doc: Document, s: EpubViewerSettings, layout: EpubRenderLayout) => {
      let styleEl = doc.getElementById(EPUB_VIEWER_STYLE_ID) as HTMLStyleElement | null;

      if (!styleEl) {
        const headFromTag = doc.getElementsByTagName("head")[0] as HTMLElement | undefined;
        const containerForStyle =
          (doc.head as HTMLElement | null) || headFromTag || (doc.documentElement as HTMLElement | null);

        if (!containerForStyle) {
          return;
        }

        styleEl = doc.createElement("style");
        styleEl.id = EPUB_VIEWER_STYLE_ID;
        containerForStyle.appendChild(styleEl);
      }

      styleEl.textContent = buildEpubInjectedStyle(s, layout);
      applyEpubLineHeightScale(doc, s.lineHeight);
    }, []);
    // epub.js themes API는 소형 뷰포트·리사이즈 시 스타일이 유실될 수 있으므로
    // CSS 스타일링은 applyDocumentSettings(<style> 직접 주입)에서 일원화한다.
    // 이 함수는 rendition 레벨 설정(spread)과 기존 themes 스타일 정리만 담당한다.
    const applySettings = useCallback(
      (rendition: Rendition, s: EpubViewerSettings, layout: EpubRenderLayout) => {
        const isComic = layout === "comic";

        // 기존 epub.js가 삽입한 기본 테마 스타일시트 제거
        const anyRendition = asEpubRenditionSnapshot(rendition);
        const contents = anyRendition.getContents?.() || [];
        contents.forEach((content) => {
          const doc = content.document;
          if (!doc) return;
          doc.getElementById("epubjs-inserted-css-default")?.remove();
        });

        // spread()는 내부적으로 updateLayout() → contents.columns()를 트리거하여 iframe을 재레이아웃함.
        // 값이 실제로 바뀔 때만 호출해야 blank screen 버그를 방지할 수 있음.
        const desiredSpread: "auto" | "none" = s.flow === "scrolled" || isComic ? "none" : s.spread;
        if (desiredSpread !== lastAppliedSpreadRef.current) {
          anyRendition.spread?.(desiredSpread);
          lastAppliedSpreadRef.current = desiredSpread;
        }

        // 모든 iframe에 직접 <style> 주입
        contents.forEach((content) => {
          if (content.document) {
            applyDocumentSettings(content.document, s, layout);
          }
        });
      },
      [applyDocumentSettings],
    );

    const handleRelocated = useCallback(
      (location: EpubjsLocation) => {
        if (isNavigatingRef.current) return;
        const rendition = renditionRef.current;
        const book = bookRef.current;
        if (!rendition || !book || !location?.start?.cfi) return;

        const cfi = location.start.cfi;
        lastStableCfiRef.current = cfi;
        const wasStable = hasStableLocationRef.current;
        hasStableLocationRef.current = true;
        if (!wasStable) {
          if (resizeFrameRef.current !== null) {
            cancelAnimationFrame(resizeFrameRef.current);
          }
          resizeFrameRef.current = requestAnimationFrame(() => {
            resizeFrameRef.current = null;
            reflowRendition(true);
          });
        }
        const currentLocation = rendition.currentLocation() as unknown as EpubjsLocation;
        const start = currentLocation?.start || location.start;
        const displayed = start?.displayed;

        let chapterPage = displayed?.page || 0;
        let chapterTotal = displayed?.total || 0;

        try {
          const manager = asEpubRenditionSnapshot(rendition).manager;
          if (manager && manager.isPaginated && manager.container) {
            const scrollWidth = manager.container.scrollWidth;
            const delta = manager.layout?.delta;
            if (typeof delta === "number" && delta > 0 && scrollWidth > 0) {
              const adjustedTotal = Math.ceil((scrollWidth - 3) / delta);
              const newTotal = adjustedTotal > 0 ? adjustedTotal : 1;
              if (newTotal < chapterTotal) {
                // 스프레드 모드에서 epub.js가 총 페이지를 과대계산할 경우 비례 축소한다
                // (단순 clamp 시 여러 스프레드가 같은 페이지 번호를 표시하는 버그 방지)
                const originalTotal = chapterTotal;
                chapterTotal = newTotal;
                chapterPage = Math.max(1, Math.min(Math.ceil((chapterPage * newTotal) / originalTotal), newTotal));
              } else {
                chapterPage = Math.max(1, Math.min(chapterPage, chapterTotal));
              }
            }
          }
        } catch (err) {
          console.warn("[EpubChapterViewer] manager spread correction failed:", err);
        }

        const spine = book.spine as unknown as EpubjsSpine;
        const spineItems = spine.spineItems || [];
        let globalRatio = calculateGlobalProgress({
          percentage: start?.percentage,
          index: start?.index,
          spineLength: spineItems.length,
        });

        let currentPosition = 0;
        const locations = book.locations as unknown as EpubjsLocationsExtended;
        const totalPositions =
          generatedTotalRef.current > 0 ? generatedTotalRef.current : getSafeLocationLength(locations);
        if (locationsReadyRef.current && typeof locations?.locationFromCfi === "function") {
          const pos = getSafeLocationFromCfi(locations, cfi);
          if (pos !== null) {
            currentPosition = pos;
            if (totalPositions > 0) {
              // 진행바 클릭(goToProgress: cfiFromPercentage)과 동일한 축으로 정규화해 시각 위치와 실제 이동을 일치시킴
              globalRatio = toLocationRatio(pos, totalPositions);
            }
          } else if (totalPositions > 0) {
            // 일부 TOC href 점프는 cfi->location 매핑이 실패할 수 있어 globalRatio로 보정한다.
            currentPosition = Math.max(0, Math.min(totalPositions - 1, Math.round(globalRatio * (totalPositions - 1))));
          }
        }

        const spineIndex = start?.index ?? -1;
        const currentSpineItem = spineItems[spineIndex];
        const chapterHref = currentSpineItem?.href || "";

        onLocationChangeRef.current?.({
          cfi,
          chapterPage,
          chapterTotal,
          globalRatio,
          currentPosition,
          totalPositions,
          chapterHref,
          spineIndex,
          spineLength: spineItems.length,
          atStart: location.atStart,
          atEnd: location.atEnd,
        });
      },
      [reflowRendition],
    );

    useEffect(() => {
      if (!containerRef.current) return;
      lastAppliedSpreadRef.current = null; // 새 rendition 생성 시 초기화
      const contentDisposers = contentDisposersRef.current;
      const invalidPreciseHrefSet = invalidPreciseHrefSetRef.current;

      let isDisposed = false;
      const book = Epub(epubUrl, { openAs: "epub" });

      bookRef.current = book;
      locationsReadyRef.current = false;
      invalidPreciseHrefSet.clear();
      allowContentHeuristicRef.current = true;
      autoLayoutLockedRef.current = false;
      hasStableLocationRef.current = false;
      lastStableCfiRef.current = null;

      const rendition = book.renderTo(containerRef.current, {
        flow: settings.flow === "scrolled" ? "scrolled-doc" : "paginated",
        spread: settings.renderMode === "comic" ? "none" : settings.spread,
        width: "100%",
        height: "100%",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;
      lastContainerSizeRef.current = { width: 0, height: 0 };

      applySettings(rendition, settings, effectiveLayoutRef.current);
      const wheelContainers = new Set<HTMLElement>();
      const touchContainers = new Set<HTMLElement>();

      const handleScrolledPullWheel = (event: WheelEvent, container: HTMLElement): boolean => {
        const isAtTop = container.scrollTop <= 0;
        const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
        const currentPull = scrolledPullOffsetRef.current;
        const isReverseRelease = (currentPull > 0 && event.deltaY > 0) || (currentPull < 0 && event.deltaY < 0);
        const isSnappedPull = Math.abs(currentPull) >= EPUB_SCROLLED_PULL_THRESHOLD;
        const now = Date.now();

        if (now - lastScrolledPullWheelAtRef.current < SCROLLED_PULL_WHEEL_COOLDOWN_MS && !isReverseRelease && !isSnappedPull) {
          if (isAtTop && event.deltaY < 0 && canScrolledPullPrevRef.current) {
            event.preventDefault();
            return true;
          }
          if (isAtBottom && event.deltaY > 0 && canScrolledPullNextRef.current) {
            event.preventDefault();
            return true;
          }
          return false;
        }

        if (isSnappedPull) {
          event.preventDefault();
          if (currentPull > 0) {
            if (event.deltaY < 0 && canScrolledPullPrevRef.current) {
              resetScrolledPullOffset();
              triggerScrolledPullNavigation("prev");
            } else if (event.deltaY > 0) {
              lastScrolledPullWheelAtRef.current = now;
              resetScrolledPullOffset();
            }
          } else if (currentPull < 0) {
            if (event.deltaY > 0 && canScrolledPullNextRef.current) {
              resetScrolledPullOffset();
              triggerScrolledPullNavigation("next");
            } else if (event.deltaY < 0) {
              lastScrolledPullWheelAtRef.current = now;
              resetScrolledPullOffset();
            }
          }
          return true;
        }

        const nextStep = EPUB_SCROLLED_PULL_THRESHOLD / 2;
        if (isAtTop && event.deltaY < 0 && canScrolledPullPrevRef.current) {
          event.preventDefault();
          lastScrolledPullWheelAtRef.current = now;
          setScrolledPullOffset(Math.min(EPUB_SCROLLED_PULL_THRESHOLD, currentPull + nextStep));
          return true;
        }
        if (isAtBottom && event.deltaY > 0 && canScrolledPullNextRef.current) {
          event.preventDefault();
          lastScrolledPullWheelAtRef.current = now;
          setScrolledPullOffset(Math.max(-EPUB_SCROLLED_PULL_THRESHOLD, currentPull - nextStep));
          return true;
        }
        if (currentPull !== 0 && isReverseRelease) {
          event.preventDefault();
          lastScrolledPullWheelAtRef.current = now;
          resetScrolledPullOffset();
          return true;
        }

        return false;
      };

      const wheelHandler = (event: WheelEvent) => {
        const currentSettings = settingsRef.current;
        const currentRendition = renditionRef.current;
        const manager = currentRendition ? asEpubRenditionSnapshot(currentRendition).manager : undefined;
        if (currentSettings.flow === "scrolled" && manager?.isPaginated === false && manager.container) {
          if (handleScrolledPullWheel(event, manager.container)) return;
        }
        const action = getWheelNavigationAction({
          deltaY: event.deltaY,
          flow: currentSettings.flow,
          wheelDirection: currentSettings.wheelDirection,
          manager,
        });
        if (!action) return;

        const now = Date.now();
        if (now - lastWheelNavigationAtRef.current < 200) return;
        lastWheelNavigationAtRef.current = now;

        event.preventDefault();
        if (action === "next") onPageNextRef.current?.();
        else onPagePrevRef.current?.();
      };

      const keydownHandler = (event: KeyboardEvent) => {
        const currentSettings = settingsRef.current;
        const target = event.target as HTMLElement | null;
        const tagName = target?.tagName?.toLowerCase();
        if (tagName === "input" || tagName === "textarea" || tagName === "select" || Boolean(target?.isContentEditable))
          return;
        if (currentSettings.flow === "scrolled") return;

        const nextArrowKey = currentSettings.keyboardDirection === "right" ? "ArrowRight" : "ArrowLeft";
        const prevArrowKey = currentSettings.keyboardDirection === "right" ? "ArrowLeft" : "ArrowRight";

        if (event.key === nextArrowKey || event.key === "PageDown") {
          event.preventDefault();
          onPageNextRef.current?.();
        } else if (event.key === prevArrowKey || event.key === "PageUp") {
          event.preventDefault();
          onPagePrevRef.current?.();
        }
      };

      const resolveZone = (clientX: number): "left" | "center" | "right" => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        const ratio =
          containerRect && containerRect.width > 0
            ? (clientX - containerRect.left) / containerRect.width
            : clientX / Math.max(window.innerWidth, 1);
        const clampedRatio = Math.max(0, Math.min(1, ratio));
        if (clampedRatio < 0.3) return "left";
        if (clampedRatio > 0.7) return "right";
        return "center";
      };

      const executeZoneAction = (zone: "left" | "center" | "right") => {
        const currentSettings = settingsRef.current;
        if (zone === "center") {
          onViewerClickRef.current?.();
          return;
        }
        if (currentSettings.flow === "scrolled") return;
        const isRTL = currentSettings.clickDirection === "left";
        if (zone === "left") {
          if (isRTL) onPageNextRef.current?.();
          else onPagePrevRef.current?.();
        } else {
          if (isRTL) onPagePrevRef.current?.();
          else onPageNextRef.current?.();
        }
      };

      const mouseDownHandler = (event: MouseEvent) => {
        pointerDownPosRef.current = { x: event.clientX, y: event.clientY };
        isDraggingRef.current = false;
      };

      const mouseMoveHandler = (event: MouseEvent) => {
        if (!pointerDownPosRef.current) return;
        const dx = event.clientX - pointerDownPosRef.current.x;
        const dy = event.clientY - pointerDownPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 5) isDraggingRef.current = true;
      };

      const touchStartHandler = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        if (scrolledPullFrameRef.current !== null) {
          cancelAnimationFrame(scrolledPullFrameRef.current);
          scrolledPullFrameRef.current = null;
        }
        pointerDownPosRef.current = { x: touch.clientX, y: touch.clientY };
        scrolledPullLastYRef.current = touch.clientY;
        isDraggingRef.current = false;
        touchHandledRef.current = false;
        if (settingsRef.current.flow === "scrolled") setScrolledPullTouching(true);
      };

      const touchMoveHandler = (event: TouchEvent) => {
        if (!pointerDownPosRef.current) return;
        const touch = event.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - pointerDownPosRef.current.x;
        const dy = touch.clientY - pointerDownPosRef.current.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) isDraggingRef.current = true;

        if (settingsRef.current.flow !== "scrolled" || Math.abs(dx) > Math.abs(dy)) return;
        const currentRendition = renditionRef.current;
        const manager = currentRendition ? asEpubRenditionSnapshot(currentRendition).manager : undefined;
        const container = manager?.container;
        if (!container || manager?.isPaginated === true || scrolledPullLastYRef.current === null) return;

        const diff = touch.clientY - scrolledPullLastYRef.current;
        scrolledPullLastYRef.current = touch.clientY;
        const isAtTop = container.scrollTop <= 0;
        const isAtBottom = container.scrollTop + container.clientHeight >= container.scrollHeight - 1;
        const currentPull = scrolledPullOffsetRef.current;

        if ((isAtTop && diff > 0 && canScrolledPullPrevRef.current) || currentPull > 0) {
          const resistance = SCROLLED_PULL_SENSITIVITY * (1 - Math.abs(currentPull) / (SCROLLED_PULL_MAX * 2));
          const nextOffset = Math.max(0, Math.min(currentPull + diff * resistance, SCROLLED_PULL_MAX));
          setScrolledPullOffset(nextOffset);
          if (event.cancelable && container.scrollTop <= 0 && nextOffset > 0) event.preventDefault();
        } else if ((isAtBottom && diff < 0 && canScrolledPullNextRef.current) || currentPull < 0) {
          const resistance = SCROLLED_PULL_SENSITIVITY * (1 - Math.abs(currentPull) / (SCROLLED_PULL_MAX * 2));
          const nextOffset = Math.min(0, Math.max(currentPull + diff * resistance, -SCROLLED_PULL_MAX));
          setScrolledPullOffset(nextOffset);
          if (event.cancelable && isAtBottom && nextOffset < 0) event.preventDefault();
        } else if (currentPull !== 0) {
          setScrolledPullOffset(0);
        }
      };

      const containerTouchEndHandler = () => {
        pointerDownPosRef.current = null;
        if (settingsRef.current.flow === "scrolled") completeScrolledPull();
      };

      const handleContentInput = (content: Contents) => {
        const contentWithDocument = content as unknown as { document?: Document };
        const doc = contentWithDocument.document;
        if (!doc || contentDisposersRef.current.has(doc)) return;

        applyOldIOSSafariPointerEventFallback(doc);
        applyDocumentSettings(doc, settingsRef.current, effectiveLayoutRef.current);

        const currentSettings = settingsRef.current;
        if (currentSettings.renderMode === "auto") {
          if (!autoLayoutLockedRef.current && allowContentHeuristicRef.current) {
            const docLayout = detectLayoutFromDocument(doc) || "book";
            if (docLayout !== effectiveLayoutRef.current) {
              detectedLayoutRef.current = docLayout;
              effectiveLayoutRef.current = docLayout;
              onRenderLayoutChangeRef.current?.(docLayout);
              applySettings(rendition, currentSettings, docLayout);
            }
            autoLayoutLockedRef.current = true;
          } else if (!allowContentHeuristicRef.current) {
            autoLayoutLockedRef.current = true;
          }
        } else {
          autoLayoutLockedRef.current = true;
        }

        const clickHandler = (event: MouseEvent) => {
          if (touchHandledRef.current) {
            touchHandledRef.current = false;
            return;
          }
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            pointerDownPosRef.current = null;
            return;
          }
          pointerDownPosRef.current = null;
          const selection = doc.defaultView?.getSelection();
          if (selection && !selection.isCollapsed) return;

          const target = event.target as HTMLElement | null;
          const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
          if (anchor) {
            const href = anchor.getAttribute("href") || "";
            if (href && /^https?:\/\//i.test(href)) {
              event.preventDefault();
              event.stopPropagation();
              window.open(href, "_blank", "noopener,noreferrer");
            }
            return;
          }
          if (target?.closest("button, input, select, textarea, [contenteditable='true']")) return;

          const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
          const iframeRect = iframe?.getBoundingClientRect();
          executeZoneAction(resolveZone((iframeRect?.left ?? 0) + event.clientX));
        };

        const touchEndHandler = (event: TouchEvent) => {
          touchHandledRef.current = true;
          if (isDraggingRef.current) {
            isDraggingRef.current = false;
            const startPos = pointerDownPosRef.current;
            pointerDownPosRef.current = null;
            if (settingsRef.current.flow === "scrolled") {
              completeScrolledPull();
              return;
            }
            if (startPos) {
              const touch = event.changedTouches[0];
              if (touch) {
                const dx = touch.clientX - startPos.x;
                const dy = touch.clientY - startPos.y;
                if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
                  const isRTL = settingsRef.current.clickDirection === "left";
                  if (dx < 0) {
                    if (isRTL) onPagePrevRef.current?.();
                    else onPageNextRef.current?.();
                  } else {
                    if (isRTL) onPageNextRef.current?.();
                    else onPagePrevRef.current?.();
                  }
                }
              }
            }
            return;
          }
          const touch = event.changedTouches[0];
          const clientX = touch?.clientX ?? pointerDownPosRef.current?.x ?? 0;
          const iframe = doc.defaultView?.frameElement as HTMLIFrameElement | null;
          const iframeRect = iframe?.getBoundingClientRect();
          pointerDownPosRef.current = null;
          if (settingsRef.current.flow === "scrolled") completeScrolledPull();
          executeZoneAction(resolveZone((iframeRect?.left ?? 0) + clientX));
        };

        doc.addEventListener("wheel", wheelHandler, { passive: false });
        doc.addEventListener("keydown", keydownHandler);
        doc.addEventListener("mousedown", mouseDownHandler);
        doc.addEventListener("mousemove", mouseMoveHandler);
        doc.addEventListener("click", clickHandler);
        doc.addEventListener("touchstart", touchStartHandler, { passive: true });
        doc.addEventListener("touchmove", touchMoveHandler, { passive: settings.flow !== "scrolled" });
        doc.addEventListener("touchend", touchEndHandler);

        contentDisposersRef.current.set(doc, () => {
          doc.removeEventListener("wheel", wheelHandler);
          doc.removeEventListener("keydown", keydownHandler);
          doc.removeEventListener("mousedown", mouseDownHandler);
          doc.removeEventListener("mousemove", mouseMoveHandler);
          doc.removeEventListener("click", clickHandler);
          doc.removeEventListener("touchstart", touchStartHandler);
          doc.removeEventListener("touchmove", touchMoveHandler);
          doc.removeEventListener("touchend", touchEndHandler);
        });
      };

      const enforceContainerListeners = () => {
        const currentRendition = renditionRef.current;
        if (!currentRendition) return;
        const manager = asEpubRenditionSnapshot(currentRendition).manager;
        if (manager?.container) {
          manager.container.removeEventListener("wheel", wheelHandler);
          manager.container.addEventListener("wheel", wheelHandler, { passive: false });
          wheelContainers.add(manager.container);

          manager.container.removeEventListener("touchstart", touchStartHandler);
          manager.container.removeEventListener("touchmove", touchMoveHandler);
          manager.container.removeEventListener("touchend", containerTouchEndHandler);
          manager.container.addEventListener("touchstart", touchStartHandler, { passive: true });
          manager.container.addEventListener("touchmove", touchMoveHandler, { passive: settings.flow !== "scrolled" });
          manager.container.addEventListener("touchend", containerTouchEndHandler);
          touchContainers.add(manager.container);
        }
        asEpubRenditionSnapshot(currentRendition)
          .getContents?.()
          .forEach((content) => {
            if (content.document) {
              content.document.removeEventListener("wheel", wheelHandler);
              content.document.addEventListener("wheel", wheelHandler, { passive: false });
            }
          });
      };

      const contentHookHandler = (content: EpubContentSnapshot) => {
        handleContentInput(content as Contents);
        enforceContainerListeners();
      };

      const renderHandler = () => {
        enforceContainerListeners();
      };

      const displayedHandler = () => {
        enforceContainerListeners();
      };

      rendition.on("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
      rendition.on("render", renderHandler);
      rendition.on("displayed", displayedHandler);
      rendition.hooks.content.register(contentHookHandler as unknown as (...args: unknown[]) => void);

      enforceContainerListeners();

      const waitForLayoutFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const finalizeInit = async (snapToEnd = initialOpenMode === "last") => {
        if (isDisposed) return;
        if (snapToEnd) {
          await waitForLayoutFrame();
          if (isDisposed) return;
          snapRenditionToVisualEnd(rendition);
          await waitForLayoutFrame();
          if (isDisposed) return;
          snapRenditionToVisualEnd(rendition);
        }
        onReadyRef.current?.(generatedTotalRef.current);
        onInitializationCompleteRef.current?.();
        const loc = rendition.currentLocation() as unknown as EpubjsLocation;
        if (loc) handleRelocated(loc);
        if (pendingAnchorHighlightRef.current) {
          const h = pendingAnchorHighlightRef.current;
          pendingAnchorHighlightRef.current = null;
          showAnchorHighlightRef.current?.(h);
        }
      };

      const displayWithFallback = (targetCFI?: string, ratioFallback?: number) => {
        const fallbackCFI =
          typeof ratioFallback === "number" && ratioFallback > 0.01
            ? getSafeCfiFromPercentage(book.locations, ratioFallback)
            : undefined;
        const displayBeginning = () =>
          rendition
            .display(undefined)
            .then(() => finalizeInit())
            .catch((err: unknown) => {
              console.warn("[EpubChapterViewer] Initial display fallback failed:", err);
              return finalizeInit();
            });
        const displayRatioFallback = () =>
          !fallbackCFI || fallbackCFI === targetCFI
            ? displayBeginning()
            : rendition
                .display(fallbackCFI)
                .then(() => finalizeInit())
                .catch(displayBeginning);

        return rendition
          .display(targetCFI)
          .then(() => finalizeInit())
          .catch((err: unknown) => {
            console.warn("[EpubChapterViewer] Initial display failed, falling back:", err);
            return displayRatioFallback();
          });
      };

      book.ready
        .then(() => {
          const detectedFromMetadata = detectLayoutFromPackageMetadata(book);
          const detectedFromSpine = detectLayoutFromSpine(book);
          allowContentHeuristicRef.current = !(detectedFromMetadata || detectedFromSpine);
          detectedLayoutRef.current = detectedFromMetadata || detectedFromSpine || "book";
          effectiveLayoutRef.current = resolveEffectiveLayout(settings.renderMode, detectedLayoutRef.current);
          onRenderLayoutChangeRef.current?.(effectiveLayoutRef.current);

          applySettings(rendition, settings, effectiveLayoutRef.current);

          // TOC 로드 헬퍼 함수들 (book.ready 스코프 내에서 한 번만 정의)
          const normalizeHref = (href: string) => {
            const base = href.split("#")[0] || "";
            const decoded = safeDecodeURIComponent(base).replace(/^\.\//, "");
            return decoded;
          };

          const spine = book.spine as unknown as EpubjsSpine;
          const spineItems = spine.spineItems || [];
          const lastSpineHref = spineItems[spineItems.length - 1]?.href;
          const spineHrefMap = new Map<string, number>();
          spineItems.forEach((item, idx) => {
            spineHrefMap.set(normalizeHref(item.href), idx);
          });

          const resolveSpineIndex = (href: string): number | null => {
            const normalized = normalizeHref(href);
            if (spineHrefMap.has(normalized)) {
              return spineHrefMap.get(normalized) ?? null;
            }
            const found = spineItems.findIndex((item) => {
              const itemHref = normalizeHref(item.href);
              return itemHref.endsWith(normalized) || normalized.endsWith(itemHref);
            });
            return found >= 0 ? found : null;
          };

          const ratioFromSpineIndex = (spineIndex: number | null): number | undefined => {
            if (spineIndex === null) return undefined;
            if (spineItems.length <= 0) return 0;
            // calculateGlobalProgress와 일관성을 위해 spineItems.length로 나눔 (N-1 아님)
            return Math.max(0, Math.min(1, spineIndex / spineItems.length));
          };

          const mapTOCItem = (item: EpubjsNavigationItem): EpubTOCItem => {
            const spineIndex = resolveSpineIndex(item.href);
            return {
              id: item.id,
              label: item.label ? item.label.trim() : "",
              href: item.href,
              progressRatio: ratioFromSpineIndex(spineIndex),
              progressPrecision: "estimated",
              subitems: item.subitems?.map(mapTOCItem),
            };
          };

          const assignEstimatedRatios = (items: EpubTOCItem[]): EpubTOCItem[] => {
            const flatIds: string[] = [];
            const collect = (nodes: EpubTOCItem[]) => {
              nodes.forEach((node) => {
                flatIds.push(node.id);
                if (node.subitems?.length) collect(node.subitems);
              });
            };
            collect(items);

            const total = flatIds.length;
            if (total === 0) return items;
            const ratioMap = new Map<string, number>();
            flatIds.forEach((id, index) => {
              ratioMap.set(id, (index + 1) / (total + 1));
            });

            const update = (nodes: EpubTOCItem[]): EpubTOCItem[] =>
              nodes.map((node) => ({
                ...node,
                progressRatio: ratioMap.get(node.id) ?? node.progressRatio,
                progressPrecision: "estimated",
                subitems: node.subitems ? update(node.subitems) : undefined,
              }));

            return update(items);
          };

          // === 정밀 위치 정보 업데이트 헬퍼 ===
          // locations가 준비된 후 TOC 항목들을 다시 훑어 CFI 기반 정밀 위치를 계산함
          const resolveAnchorElement = (doc: Document, fragment: string): Element | null => {
            const decoded = safeDecodeFragment(fragment);
            const candidates = Array.from(
              new Set(
                [
                  fragment,
                  fragment.replace(/^#/, ""),
                  decoded ?? undefined,
                  decoded ? decoded.replace(/^#/, "") : undefined,
                ]
                  .map((value) => (value ?? "").trim())
                  .filter((value) => Boolean(value)),
              ),
            );

            for (const key of candidates) {
              const byId = doc.getElementById(key);
              if (byId) return byId;
            }

            for (const key of candidates) {
              const byName = doc.getElementsByName(key)[0];
              if (byName) return byName;
            }

            return null;
          };

          const resolveCfiFromHref = async (href: string): Promise<string | null> => {
            const hashIndex = href.indexOf("#");
            const baseHref = (hashIndex >= 0 ? href.slice(0, hashIndex) : href).trim();
            const section = book.spine.get(baseHref) as unknown as EpubjsSection;
            if (!section?.cfiBase) return null;

            const fragment = hashIndex >= 0 ? href.slice(hashIndex + 1).trim() : "";
            if (!fragment) {
              return section.cfiBase;
            }

            try {
              await section.load?.();
              const doc = section.document;
              if (!doc) return section.cfiBase;

              const anchorElement = resolveAnchorElement(doc, fragment);
              if (!anchorElement) return section.cfiBase;

              return section.cfiFromElement?.(anchorElement) || section.cfiBase;
            } catch {
              return section.cfiBase;
            } finally {
              section.unload?.();
            }
          };

          const refreshTOCWithPreciseRatios = () => {
            if (!locationsReadyRef.current || !book.locations || !book.navigation?.toc) return;
            const currentSeq = ++tocRefreshSeqRef.current;

            const updateWithPreciseRatio = async (items: EpubTOCItem[]): Promise<EpubTOCItem[]> => {
              const result: EpubTOCItem[] = [];
              for (const item of items) {
                let resolvedCfi: string | null = null;
                let validNavigationCfi: string | undefined;
                let preciseRatio = item.progressRatio;
                try {
                  // href의 앵커까지 반영한 CFI를 계산해 같은 파일 내 여러 TOC 항목이 합쳐지는 문제를 줄임
                  if (!invalidPreciseHrefSet.has(item.href)) {
                    resolvedCfi = await resolveCfiFromHref(item.href);
                  }

                  if (resolvedCfi && isLikelyEpubCfi(resolvedCfi)) {
                    const locations = book.locations as unknown as EpubjsLocationsExtended;
                    const pos = getSafeLocationFromCfi(locations, resolvedCfi);
                    const total = getSafeLocationLength(locations);
                    if (pos !== null && total > 0) {
                      preciseRatio = toLocationRatio(pos, total);
                      validNavigationCfi = resolvedCfi;
                    } else {
                      invalidPreciseHrefSet.add(item.href);
                    }
                  } else if (resolvedCfi) {
                    invalidPreciseHrefSet.add(item.href);
                  }
                } catch {
                  // 실패 시 기존 비율 유지
                  invalidPreciseHrefSet.add(item.href);
                }

                result.push({
                  ...item,
                  // 유효성(위치 인덱스) 검증이 된 CFI만 이동 타겟으로 사용한다.
                  navigationCfi: validNavigationCfi,
                  progressRatio: preciseRatio,
                  progressPrecision: validNavigationCfi ? "precise" : (item.progressPrecision ?? "estimated"),
                  subitems: item.subitems ? await updateWithPreciseRatio(item.subitems) : undefined,
                });
              }
              return result;
            };

            const preciseTOC: EpubTOCItem[] = (book.navigation.toc as EpubjsNavigationItem[]).map(mapTOCItem);
            void updateWithPreciseRatio(preciseTOC).then((updated) => {
              if (tocRefreshSeqRef.current !== currentSeq) return;
              onTOCLoadRef.current?.(updated);
            });
          };

          // 초기 TOC 로드 (대략적인 위치)
          if (book.navigation && book.navigation.toc) {
            const formattedTOC: EpubTOCItem[] = (book.navigation.toc as EpubjsNavigationItem[]).map(mapTOCItem);
            onTOCLoadRef.current?.(assignEstimatedRatios(formattedTOC));
          }

          // === locations 로드: 캐시 우선, 없으면 백그라운드 생성 ===
          const CACHE_KEY = `epub-locations-${chapterId}`;
          const cachedLocations = localStorage.getItem(CACHE_KEY);

          if (cachedLocations) {
            // 캐시 히트 → 즉시 로드 + 최적화된 초기 디스플레이
            try {
              book.locations.load(cachedLocations);
              locationsReadyRef.current = true;
              generatedTotalRef.current = getSafeLocationLength(book.locations);
              if (generatedTotalRef.current <= 0) {
                throw new Error("cached locations are empty or unreadable");
              }

              // 캐시 로드 후 정밀 TOC 업데이트
              refreshTOCWithPreciseRatios();

              const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;

              // flow 변경으로 rendition을 재생성한 경우, 모드 전환 직전 위치를 우선 복원한다.
              // chapterId가 일치하는 경우에만 사용하여, 챕터 이동 시 anchor가 오염되는 것을 방지한다.
              const flowAnchor =
                flowTransitionAnchorRef.current?.chapterId === chapterId ? flowTransitionAnchorRef.current.cfi : null;
              flowTransitionAnchorRef.current = null;

              let targetCFI: string | undefined = flowAnchor || initialCFI || undefined;

              // CFI가 없고 진행률만 있는 경우, locations 정보를 이용해 즉시 targetCFI 계산
              if (!targetCFI && expectedRatio > 0.01) {
                targetCFI =
                  initialOpenMode === "last" && lastSpineHref
                    ? lastSpineHref
                    : getSafeCfiFromPercentage(book.locations, expectedRatio);
              }

              // flow 변경 또는 이어보기 위치가 있으면 finalizeInit에서 highlight 표시
              pendingAnchorHighlightRef.current = flowAnchor ?? initialCFI ?? null;
              void displayWithFallback(targetCFI, expectedRatio);
              return;
            } catch (err) {
              console.warn("[EpubChapterViewer] Cached locations invalid, regenerating:", err);
              localStorage.removeItem(CACHE_KEY);
              locationsReadyRef.current = false;
              generatedTotalRef.current = 0;
            }
          }

          // 캐시 미스 → 기본 디스플레이 시도 + 백그라운드 생성
          const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;

          // flow 변경으로 rendition을 재생성한 경우, 모드 전환 직전 위치를 우선 복원한다.
          const flowAnchor =
            flowTransitionAnchorRef.current?.chapterId === chapterId ? flowTransitionAnchorRef.current.cfi : null;
          flowTransitionAnchorRef.current = null;

          const initialDisplayTarget =
            initialOpenMode === "last" && lastSpineHref ? lastSpineHref : (flowAnchor ?? initialCFI ?? undefined);

          // flow 변경 또는 이어보기 위치가 있으면 finalizeInit에서 highlight 표시
          pendingAnchorHighlightRef.current = flowAnchor ?? initialCFI ?? null;
          void displayWithFallback(initialDisplayTarget, expectedRatio).then(() => {
            if (isDisposed) return;
            void book.locations
              .generate(EPUB_LOCATION_STRIDE)
              .then(() => {
                if (isDisposed) return;
                // 생성 결과 캐시
                const locationsObj = book.locations as unknown as EpubjsLocationsExtended;
                try {
                  const serialized = locationsObj.save();
                  localStorage.setItem(CACHE_KEY, serialized);
                } catch (err) {
                  console.warn("[EpubChapterViewer] Failed to cache locations:", err);
                }

                locationsReadyRef.current = true;
                generatedTotalRef.current = getSafeLocationLength(book.locations);
                onReadyRef.current?.(generatedTotalRef.current);

                // locations.generate 완료 후 정밀 TOC 업데이트
                refreshTOCWithPreciseRatios();

                // locations.generate 완료 후 현재 위치 보정 (사용자에게 보일 수 있음 - 캐시 없는 첫 방문 시)
                const currentLoc = rendition.currentLocation() as unknown as EpubjsLocation;
                const currentPct = currentLoc?.start?.percentage ?? 0;
                const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;
                // flowAnchor 또는 initialCFI로 이미 위치를 복원한 경우 보정하지 않는다
                const shouldCorrectFromProgress =
                  initialOpenMode !== "last" && !initialCFI && !flowAnchor && expectedRatio > 0.01;

                if (currentPct < 0.01 && shouldCorrectFromProgress) {
                  try {
                    const cfiFromRatio = getSafeCfiFromPercentage(book.locations, expectedRatio);
                    if (cfiFromRatio) {
                      rendition.display(cfiFromRatio).then(() => {
                        const correctedLoc = rendition.currentLocation() as unknown as EpubjsLocation;
                        if (correctedLoc) handleRelocated(correctedLoc);
                      });
                    }
                  } catch (err) {
                    console.warn("[EpubChapterViewer] Background position correction failed:", err);
                  }
                }
              })
              .catch((err) => {
                console.warn("[EpubChapterViewer] Locations generation failed:", err);
              });
          });
        })
        .catch((err: Error) => {
          console.error("[EpubChapterViewer] Initialization failed:", err);
          onInitializationCompleteRef.current?.();
        });

      return () => {
        isDisposed = true;
        // 미처리 anchor highlight 예약 및 진행 중 타이머 취소
        pendingAnchorHighlightRef.current = null;
        if (anchorHighlightTimerRef.current !== null) {
          clearTimeout(anchorHighlightTimerRef.current);
          anchorHighlightTimerRef.current = null;
        }
        if (resizeHighlightTimerRef.current !== null) {
          clearTimeout(resizeHighlightTimerRef.current);
          resizeHighlightTimerRef.current = null;
        }
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        if (scrolledPullFrameRef.current !== null) {
          cancelAnimationFrame(scrolledPullFrameRef.current);
          scrolledPullFrameRef.current = null;
        }
        if (scrolledPullNavigationLockTimerRef.current !== null) {
          window.clearTimeout(scrolledPullNavigationLockTimerRef.current);
          scrolledPullNavigationLockTimerRef.current = null;
        }
        scrolledPullNavigationLockRef.current = false;
        scrolledPullOffsetRef.current = 0;
        isScrolledPullTouchingRef.current = false;
        onScrolledPullStateChangeRef.current?.({ pullOffset: 0, isTouching: false });
        rendition.off("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
        rendition.off("render", renderHandler);
        rendition.off("displayed", displayedHandler);
        const contentHook = rendition.hooks.content as unknown as {
          deregister?: (fn: (...args: unknown[]) => void) => void;
        };
        contentHook.deregister?.(contentHookHandler as unknown as (...args: unknown[]) => void);
        wheelContainers.forEach((container) => {
          container.removeEventListener("wheel", wheelHandler);
        });
        wheelContainers.clear();
        touchContainers.forEach((container) => {
          container.removeEventListener("touchstart", touchStartHandler);
          container.removeEventListener("touchmove", touchMoveHandler);
          container.removeEventListener("touchend", containerTouchEndHandler);
        });
        touchContainers.clear();
        contentDisposers.forEach((dispose) => {
          try {
            dispose();
          } catch (err) {
            console.warn("[EpubChapterViewer] content disposer failed:", err);
          }
        });
        contentDisposers.clear();

        // flow 변경으로 rendition을 재생성하기 직전, 현재 텍스트 위치를 보존한다.
        // 새 rendition이 initialCFI 대신 이 anchor를 우선 사용하여 모드 전환 위치를 복원한다.
        // chapterId를 함께 저장하여, 다른 챕터로 이동할 때는 anchor가 무시되도록 한다.
        // lastStableCfiRef를 primary source로 사용 — cleanup 시점에 epub.js가 이미
        // 내부 reflow를 수행하여 currentLocation()이 오염되었을 수 있으므로.
        if (hasStableLocationRef.current) {
          const stableCfi = lastStableCfiRef.current;
          if (stableCfi) {
            flowTransitionAnchorRef.current = { cfi: stableCfi, chapterId };
          } else {
            try {
              const loc = rendition.currentLocation() as unknown as EpubjsLocation;
              if (loc?.start?.cfi) {
                flowTransitionAnchorRef.current = { cfi: loc.start.cfi, chapterId };
              }
            } catch {
              // ignore — anchor 없이 진행
            }
          }
        }

        try {
          book.destroy();
        } catch (err) {
          console.warn("[EpubChapterViewer] book destroy failed:", err);
        }
        bookRef.current = null;
        renditionRef.current = null;
        locationsReadyRef.current = false;
        invalidPreciseHrefSet.clear();
        generatedTotalRef.current = 0;
        hasStableLocationRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      epubUrl,
      chapterId,
      handleRelocated,
      applySettings,
      initialCFI,
      initialOpenMode,
      initialProgressRatio,
      snapRenditionToVisualEnd,
      settings.renderMode,
      settings.flow,
    ]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scheduleReflow = () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
        }
        resizeFrameRef.current = requestAnimationFrame(() => {
          resizeFrameRef.current = null;
          reflowRendition();
        });
      };

      scheduleReflow();

      let observer: ResizeObserver | null = null;
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => {
          scheduleReflow();
        });
        observer.observe(container);
      }

      window.addEventListener("resize", scheduleReflow);

      return () => {
        if (resizeFrameRef.current !== null) {
          cancelAnimationFrame(resizeFrameRef.current);
          resizeFrameRef.current = null;
        }
        if (resizeHighlightTimerRef.current !== null) {
          clearTimeout(resizeHighlightTimerRef.current);
          resizeHighlightTimerRef.current = null;
        }
        observer?.disconnect();
        window.removeEventListener("resize", scheduleReflow);
      };
    }, [reflowRendition]);

    // settings 변경 시 재생성 없이 현재 rendition에 스타일만 다시 적용한다.

    useEffect(() => {
      if (!renditionRef.current) return;

      // applySettings(spread 변경 등)가 epub.js 내부 레이아웃을 재계산하기 전에
      // 현재 텍스트 위치를 CFI로 캡처해 둔다.
      // reflowRendition이 이 anchor를 소비하여 새 레이아웃 기준으로 오염된
      // currentLocation() 대신 올바른 위치로 복원한다.
      if (hasStableLocationRef.current) {
        try {
          const loc = (
            renditionRef.current as unknown as { currentLocation?: () => EpubjsLocation }
          ).currentLocation?.();
          if (loc?.start?.cfi) {
            layoutTransitionAnchorRef.current = loc.start.cfi;
          }
        } catch {
          // ignore — anchor 없이 진행 (currentLocation() 사용)
        }
      }

      const effectiveLayout = resolveEffectiveLayout(settings.renderMode, detectedLayoutRef.current);
      effectiveLayoutRef.current = effectiveLayout;
      onRenderLayoutChangeRef.current?.(effectiveLayout);
      applySettings(renditionRef.current, settings, effectiveLayout);
      if (resizeFrameRef.current !== null) {
        cancelAnimationFrame(resizeFrameRef.current);
      }
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        reflowRendition(true);
      });
    }, [settings, applySettings, reflowRendition]);

    useImperativeHandle(ref, () => {
      const getNavigationSnapshot = (): NavigationSnapshot => {
        const rendition = renditionRef.current;
        const currentLocation = rendition?.currentLocation() as EpubjsLocation | undefined;
        const manager = rendition ? asEpubRenditionSnapshot(rendition).manager : undefined;

        return {
          cfi: currentLocation?.start?.cfi ?? null,
          page: currentLocation?.start?.displayed?.page ?? 0,
          index: currentLocation?.start?.index ?? -1,
          scrollLeft: manager?.container?.scrollLeft ?? 0,
          scrollTop: manager?.container?.scrollTop ?? 0,
        };
      };

      const didNavigationMove = (before: NavigationSnapshot, after: NavigationSnapshot): boolean => {
        return (
          before.cfi !== after.cfi ||
          before.page !== after.page ||
          before.index !== after.index ||
          Math.abs(before.scrollLeft - after.scrollLeft) > 2 ||
          Math.abs(before.scrollTop - after.scrollTop) > 2
        );
      };

      const isScrolledManagerAtEnd = (): boolean => {
        const currentRendition = renditionRef.current;
        const manager = currentRendition ? asEpubRenditionSnapshot(currentRendition).manager : undefined;
        if (!manager || manager.isPaginated === true || !manager.container) return false;
        const scrollTop = manager.container.scrollTop ?? 0;
        const scrollHeight = manager.container.scrollHeight ?? 0;
        const clientHeight = manager.container.clientHeight ?? 0;
        if (scrollHeight <= clientHeight + 5) return true;
        return scrollTop + clientHeight >= scrollHeight - 2;
      };

      const isScrolledManagerAtStart = (): boolean => {
        const currentRendition = renditionRef.current;
        const manager = currentRendition ? asEpubRenditionSnapshot(currentRendition).manager : undefined;
        if (!manager || manager.isPaginated === true || !manager.container) return false;
        return (manager.container.scrollTop ?? 0) <= 2;
      };

      const withNavigation = async (action: () => Promise<boolean | void> | boolean | void): Promise<boolean> => {
        if (isNavigatingRef.current) return false;
        const before = getNavigationSnapshot();
        isNavigatingRef.current = true;
        if (containerRef.current) containerRef.current.style.opacity = "0";
        let explicitMovement: boolean | undefined;
        try {
          const result = await action();
          if (typeof result === "boolean") {
            explicitMovement = result;
          }
        } catch (err) {
          console.error("[EpubChapterViewer] Navigation error:", err);
        } finally {
          isNavigatingRef.current = false;
          if (containerRef.current) containerRef.current.style.opacity = "1";
          const loc = renditionRef.current?.currentLocation() as unknown as EpubjsLocation;
          if (loc) handleRelocated(loc);
        }

        if (explicitMovement !== undefined) {
          return explicitMovement;
        }

        const after = getNavigationSnapshot();
        return didNavigationMove(before, after);
      };

      return {
        next: async () => {
          if (!renditionRef.current) return false;
          try {
            const manager = asEpubRenditionSnapshot(renditionRef.current).manager;
            if (manager && manager.isPaginated && manager.container) {
              const container = manager.container;
              const dir = manager.settings?.direction;
              const scrollLeft = container.scrollLeft;
              const scrollWidth = container.scrollWidth;
              const clientWidth = container.clientWidth;
              const delta = manager.layout?.delta || clientWidth;

              if (dir === "ltr") {
                if (scrollLeft + clientWidth < scrollWidth) {
                  const nextLeft = scrollLeft + delta;
                  if (nextLeft + clientWidth > scrollWidth) {
                    const targetLeft = Math.max(0, scrollWidth - clientWidth);
                    if (targetLeft - scrollLeft > 2) {
                      return withNavigation(() => {
                        container.scrollLeft = targetLeft;
                        manager.updateOffset?.();
                        return true;
                      });
                    }
                  }
                }
              } else {
                if (scrollLeft > 0) {
                  const nextLeft = scrollLeft - delta;
                  if (nextLeft < 0) {
                    const targetLeft = 0;
                    if (scrollLeft - targetLeft > 2) {
                      return withNavigation(() => {
                        container.scrollLeft = targetLeft;
                        manager.updateOffset?.();
                        return true;
                      });
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager next correction failed:", err);
          }
          const beforeLocation = renditionRef.current.currentLocation() as unknown as EpubjsLocation;
          const beforeIndex = beforeLocation?.start?.index ?? -1;
          const scrolledAtEndBeforeMove = isScrolledManagerAtEnd();
          const moved = await withNavigation(() => renditionRef.current!.next());
          if (moved || !scrolledAtEndBeforeMove) return moved;

          const book = bookRef.current;
          const spine = book?.spine as unknown as EpubjsSpine | undefined;
          const nextSpineItem = beforeIndex >= 0 ? spine?.spineItems?.[beforeIndex + 1] : undefined;
          if (!nextSpineItem?.href) return false;

          return withNavigation(() => renditionRef.current!.display(nextSpineItem.href));
        },
        prev: async () => {
          if (!renditionRef.current) return false;
          try {
            const manager = asEpubRenditionSnapshot(renditionRef.current).manager;
            if (manager && manager.isPaginated && manager.container) {
              const container = manager.container;
              const dir = manager.settings?.direction;
              const scrollLeft = container.scrollLeft;
              const scrollWidth = container.scrollWidth;
              const clientWidth = container.clientWidth;
              const delta = manager.layout?.delta || clientWidth;

              if (dir === "ltr") {
                if (scrollLeft > 0) {
                  const prevLeft = scrollLeft - delta;
                  if (prevLeft < 0) {
                    const targetLeft = 0;
                    if (scrollLeft - targetLeft > 2) {
                      return withNavigation(() => {
                        container.scrollLeft = targetLeft;
                        manager.updateOffset?.();
                        return true;
                      });
                    }
                  }
                }
              } else {
                if (scrollLeft + clientWidth < scrollWidth) {
                  const prevLeft = scrollLeft + delta;
                  if (prevLeft + clientWidth > scrollWidth) {
                    const targetLeft = Math.max(0, scrollWidth - clientWidth);
                    if (targetLeft - scrollLeft > 2) {
                      return withNavigation(() => {
                        container.scrollLeft = targetLeft;
                        manager.updateOffset?.();
                        return true;
                      });
                    }
                  }
                }
              }
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager prev correction failed:", err);
          }
          // 섹션 경계를 넘는 prev()는 이전 섹션의 끝이 아닌 중간 위치로 이동하는
          // epub.js 버그가 있어, 섹션 변경 감지 후 마지막 페이지로 스크롤을 보정한다.
          const beforeLocation = renditionRef.current.currentLocation() as unknown as EpubjsLocation;
          const beforeIndex = beforeLocation?.start?.index ?? -1;
          const scrolledAtStartBeforeMove = isScrolledManagerAtStart();
          const moved = await withNavigation(async () => {
            await renditionRef.current!.prev();

            const afterLoc = renditionRef.current!.currentLocation() as unknown as EpubjsLocation;
            const afterIndex = afterLoc?.start?.index;
            if (beforeIndex !== undefined && afterIndex !== undefined && beforeIndex !== afterIndex) {
              try {
                const currentRendition = renditionRef.current;
                if (!currentRendition) return;
                const mgr = asEpubRenditionSnapshot(currentRendition).manager;
                if (mgr?.isPaginated && mgr.container) {
                  const d = mgr.settings?.direction;
                  const sw = mgr.container.scrollWidth;
                  const cw = mgr.container.clientWidth;
                  const dt = mgr.layout?.delta || cw;
                  if (d === "rtl") {
                    mgr.container.scrollLeft = 0;
                  } else {
                    const maxScroll = Math.max(0, sw - cw);
                    mgr.container.scrollLeft = Math.floor(maxScroll / dt) * dt;
                  }
                  mgr.updateOffset?.();
                }
              } catch (err) {
                console.warn("[EpubChapterViewer] manager prev-section correction failed:", err);
              }
            }
          });
          if (moved || !scrolledAtStartBeforeMove) return moved;

          const book = bookRef.current;
          const spine = book?.spine as unknown as EpubjsSpine | undefined;
          const prevSpineItem = beforeIndex > 0 ? spine?.spineItems?.[beforeIndex - 1] : undefined;
          if (!prevSpineItem?.href) return false;

          const movedToPrev = await withNavigation(() => renditionRef.current!.display(prevSpineItem.href));
          try {
            const currentRendition = renditionRef.current;
            const manager = currentRendition ? asEpubRenditionSnapshot(currentRendition).manager : undefined;
            const container = manager?.container;
            if (manager?.isPaginated === false && container) {
              container.scrollTop = Math.max(0, (container.scrollHeight ?? 0) - (container.clientHeight ?? 0));
              const loc = renditionRef.current?.currentLocation() as unknown as EpubjsLocation;
              if (loc) handleRelocated(loc);
            }
          } catch (err) {
            console.warn("[EpubChapterViewer] manager prev-scrolled fallback failed:", err);
          }
          return movedToPrev;
        },
        goToCFI: (cfi: string) => {
          if (!renditionRef.current) return;
          withNavigation(() => renditionRef.current!.display(cfi));
        },
        goToProgress: (ratio: number) => {
          const rendition = renditionRef.current;
          const book = bookRef.current;
          if (!rendition || !book) return;

          const clamped = Math.max(0, Math.min(1, ratio));
          const locations = book.locations as unknown as EpubjsLocationsExtended;
          const total = getSafeLocationLength(locations);
          let cfi: string | undefined = undefined;
          if (total > 0) {
            const targetIndex = Math.max(0, Math.min(total - 1, Math.round(clamped * (total - 1))));
            cfi = getSafeCfiFromLocation(locations, targetIndex);
          }
          if (!cfi) {
            cfi = getSafeCfiFromPercentage(locations, clamped);
          }
          if (!cfi) return;

          withNavigation(() => rendition.display(cfi));
        },
        goToPage: (page: number) => {
          const rendition = renditionRef.current;
          const book = bookRef.current;
          if (!rendition || !book) return;

          const total = getSafeLocationLength(book.locations);
          if (total <= 0) return;

          const clampedPage = Math.max(1, Math.min(total, page));
          const cfi = getSafeCfiFromLocation(book.locations, clampedPage - 1);
          if (!cfi) return;

          withNavigation(() => rendition.display(cfi));
        },
      };
    });

    return (
      <div
        className={`${styles.container} ${settings.flow === "scrolled" ? styles.scrolled : ""}`}
        style={{ background: getEpubThemeStyle(settings.theme).background }}
      >
        <div
          ref={containerRef}
          className={styles.viewer}
          style={{
            transform: settings.flow === "scrolled" ? `translateY(${scrolledPullOffset * 0.3}px)` : "none",
            transition:
              settings.flow === "scrolled" && !isScrolledPullTouching && scrolledPullOffset === 0
                ? "opacity 0.15s ease-out, transform 0.4s cubic-bezier(0.2, 0, 0.2, 1)"
                : "opacity 0.15s ease-out",
            willChange: settings.flow === "scrolled" ? "transform, opacity" : "opacity",
          }}
        />
        {!hideChapterPageInfo && (
          <div className={`${styles.chapterPageInfo} ${isUIVisible ? styles.hidden : ""}`}>
            {chapterTitle} - {Math.max(1, chapterPage || 1)}/{Math.max(1, chapterTotal || 1)}
            {globalProgressPercent != null && ` | ${globalProgressPercent}%`}
          </div>
        )}
      </div>
    );
  },
);

EpubChapterViewer.displayName = "EpubChapterViewer";
export { EpubChapterViewer };
