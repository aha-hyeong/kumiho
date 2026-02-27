import { useEffect, useRef, useCallback, forwardRef, useImperativeHandle } from "react";
import Epub from "epubjs";
import type { Book, Rendition } from "epubjs";
import type { EpubViewerSettings } from "../../../../stores/epubViewerStore";
import { calculateGlobalProgress } from "../../utils/epubUtils";
import styles from "./EpubChapterViewer.module.css";

export interface EpubChapterViewerHandles {
  next: () => void;
  prev: () => void;
  goToCFI: (cfi: string) => void;
}

export interface EpubTOCItem {
  id: string;
  label: string;
  href: string;
  subitems?: EpubTOCItem[];
}

interface EpubChapterViewerProps {
  epubUrl: string;
  chapterId: string;
  initialCFI?: string | null;
  initialProgressRatio?: number | null;
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
  }) => void;
  onViewerClick?: () => void;
  onInitializationComplete?: () => void;
}

const FONT_FAMILY_MAP: Record<string, string> = {
  serif: "Georgia, 'Times New Roman', serif",
  "sans-serif": "Arial, Helvetica, sans-serif",
};

const THEME_STYLES: Record<string, Record<string, string>> = {
  light: { background: "#ffffff", color: "#1a1a1a" },
  dark: { background: "#1a1a1a", color: "#e0e0e0" },
  sepia: { background: "#f4ecd8", color: "#3b2f2f" },
};

// epub.js 관련 내부 타입 정의
interface EpubjsLocation {
  start: {
    cfi: string;
    displayed: {
      page: number;
      total: number;
    };
    percentage: number;
    index: number;
  };
  end: {
    cfi: string;
  };
}

interface EpubjsNavigationItem {
  id: string;
  label: string;
  href: string;
  subitems?: EpubjsNavigationItem[];
}

interface EpubjsLocationsExtended {
  length: () => number;
  locationFromCfi?: (cfi: string) => number;
  save: () => string;
}

const EPUB_LOCATION_STRIDE = 6144; // 6KB 단위로 가상 페이지(위치) 정의. backend/internal/util/epub.go의 EpubPositionStride와 일치해야 함.

const EpubChapterViewer = forwardRef<EpubChapterViewerHandles, EpubChapterViewerProps>(
  (
    {
      epubUrl,
      chapterId,
      initialCFI,
      initialProgressRatio,
      settings,
      onReady,
      onTOCLoad,
      onLocationChange,
      onViewerClick,
      onInitializationComplete,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const locationsReadyRef = useRef(false);
    const generatedTotalRef = useRef(0);

    // 최신 콜백을 ref로 유지 (stale closure 방지)
    const onViewerClickRef = useRef(onViewerClick);
    const onLocationChangeRef = useRef(onLocationChange);
    const onReadyRef = useRef(onReady);
    const onTOCLoadRef = useRef(onTOCLoad);
    const onInitializationCompleteRef = useRef(onInitializationComplete);

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

    const applySettings = useCallback((rendition: Rendition, s: EpubViewerSettings) => {
      const theme = THEME_STYLES[s.theme] || THEME_STYLES.light;
      const isOriginal = s.fontFamily === "original";

      // 배경이 있는 요소의 컬럼 분할 방지 공통 스타일
      const containerBreakStyle = {
        "break-inside": "avoid",
        "page-break-inside": "avoid",
        overflow: "hidden",
        "background-clip": "padding-box",
      };

      if (isOriginal) {
        // 원본 모드: EPUB 내장 스타일 유지, 배경색/글자크기/줄간격만 사용자 설정 반영
        const originalStyles: Record<string, Record<string, string>> = {
          body: {
            background: `${theme.background} !important`,
            "font-size": `${s.fontSize}%`,
            "line-height": `${s.lineHeight} !important`,
            "column-fill": "auto",
            "padding-top": "0 !important",
            "padding-bottom": "0 !important",
          },
          "section, article, figure, table, div:has(> p), div[style*='background'], [class*='box']":
            containerBreakStyle,
        };

        // 모든 테마에서 색상을 명시적으로 설정 (이전 테마 스타일 잔류 방지)
        if (s.theme === "dark") {
          originalStyles.body.color = theme.color;
          originalStyles["p, div, span, a:not([href])"] = {
            color: theme.color,
            "line-height": `${s.lineHeight} !important`,
          };
          originalStyles["a[href]"] = { color: "#7eb8f7" };
        } else {
          originalStyles.body.color = "inherit";
          originalStyles["p, div, span, a:not([href])"] = {
            color: "inherit",
            "line-height": `${s.lineHeight} !important`,
          };
          originalStyles["a[href]"] = { color: "inherit" };
        }
        // 추가 텍스트 요소에도 line-height 적용
        originalStyles["li, dd, dt, blockquote, figcaption, th, td"] = { "line-height": `${s.lineHeight} !important` };

        rendition.themes.default(originalStyles);
      } else {
        // 커스텀 모드: 사용자 설정 반영
        const fontFamily = FONT_FAMILY_MAP[s.fontFamily] || "inherit";
        rendition.themes.default({
          body: {
            background: `${theme.background} !important`,
            color: theme.color,
            "font-family": fontFamily,
            "font-size": `${s.fontSize}%`,
            "line-height": `${s.lineHeight} !important`,
            "column-fill": "auto",
            "padding-top": "0 !important",
            "padding-bottom": "0 !important",
          },
          "section, article, figure, table, div:has(> p), div[style*='background'], [class*='box']":
            containerBreakStyle,
          "p, div, span, a:not([href])": { color: theme.color, "line-height": `${s.lineHeight} !important` },
          "a[href]": { color: s.theme === "dark" ? "#7eb8f7" : "#1a6bb5" },
          "li, dd, dt, blockquote, figcaption, th, td": { "line-height": `${s.lineHeight} !important` },
        });
      }
    }, []);

    const handleRelocated = useCallback((location: EpubjsLocation) => {
      const rendition = renditionRef.current;
      const book = bookRef.current;
      if (!rendition || !book || !location?.start?.cfi) return;

      const cfi = location.start.cfi;
      console.log("[EpubChapterViewer] relocated:", cfi);

      const currentLocation = rendition.currentLocation() as unknown as EpubjsLocation;
      const start = currentLocation?.start || location.start;
      const displayed = start?.displayed;

      const chapterPage = displayed?.page || 0;
      const chapterTotal = displayed?.total || 0;

      interface EpubjsSpine {
        spineItems: Array<{ index: number; href: string }>;
      }

      const spine = book.spine as unknown as EpubjsSpine;
      const spineItems = spine.spineItems || [];
      const globalRatio = calculateGlobalProgress({
        percentage: start?.percentage,
        index: start?.index,
        spineLength: spineItems.length,
      });

      let currentPosition = 0;
      const locations = book.locations as unknown as EpubjsLocationsExtended;
      const totalPositions =
        generatedTotalRef.current > 0
          ? generatedTotalRef.current
          : typeof locations?.length === "function"
            ? locations.length()
            : 0;
      if (locationsReadyRef.current && typeof locations?.locationFromCfi === "function") {
        const pos = locations.locationFromCfi(cfi);
        if (typeof pos === "number" && pos >= 0) {
          currentPosition = pos;
        }
      }

      const currentSpineItem = spineItems[start?.index ?? -1];
      const chapterHref = currentSpineItem?.href || "";

      onLocationChangeRef.current?.({
        cfi,
        chapterPage,
        chapterTotal,
        globalRatio,
        currentPosition,
        totalPositions,
        chapterHref,
      });
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;

      const book = Epub(epubUrl, { openAs: "epub" });

      bookRef.current = book;
      locationsReadyRef.current = false;

      const rendition = book.renderTo(containerRef.current, {
        flow: settings.flow,
        spread: settings.spread,
        width: "100%",
        height: "100%",
        allowScriptedContent: false,
      });
      renditionRef.current = rendition;

      applySettings(rendition, settings);

      const handleRenditionClick = () => {
        onViewerClickRef.current?.();
      };

      rendition.on("click", handleRenditionClick);
      rendition.on("relocated", handleRelocated as unknown as (...args: unknown[]) => void);

      // === 초기화 헬퍼: 위치 복원 후 초기화 완료 처리 ===
      const finalizeInit = () => {
        onReadyRef.current?.(generatedTotalRef.current);
        onInitializationCompleteRef.current?.();
        const loc = rendition.currentLocation() as unknown as EpubjsLocation;
        if (loc) handleRelocated(loc);
      };

      book.ready
        .then(() => {
          applySettings(rendition, settings);

          // TOC 로드
          if (book.navigation && book.navigation.toc) {
            const formattedTOC: EpubTOCItem[] = (book.navigation.toc as EpubjsNavigationItem[]).map(
              (item: EpubjsNavigationItem) => ({
                id: item.id,
                label: item.label ? item.label.trim() : "",
                href: item.href,
                subitems: item.subitems?.map((sub: EpubjsNavigationItem) => ({
                  id: sub.id,
                  label: sub.label ? sub.label.trim() : "",
                  href: sub.href,
                })),
              }),
            );
            onTOCLoadRef.current?.(formattedTOC);
          }

          // === locations 로드: 캐시 우선, 없으면 백그라운드 생성 ===
          const CACHE_KEY = `epub-locations-${chapterId}`;
          const cachedLocations = localStorage.getItem(CACHE_KEY);

          if (cachedLocations) {
            // 캐시 히트 → 즉시 로드 + 최적화된 초기 디스플레이
            console.log("[EpubChapterViewer] Loading cached locations");
            try {
              book.locations.load(cachedLocations);
              locationsReadyRef.current = true;
              generatedTotalRef.current = book.locations.length();

              const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;
              let targetCFI: string | undefined = initialCFI || undefined;

              // CFI가 없고 진행률만 있는 경우, locations 정보를 이용해 즉시 targetCFI 계산
              if (!targetCFI && expectedRatio > 0.01) {
                try {
                  targetCFI = book.locations.cfiFromPercentage(Math.max(0, Math.min(1, expectedRatio)));
                } catch (e) {
                  console.warn("[EpubChapterViewer] Initial cfiFromPercentage (cached) failed:", e);
                }
              }

              console.log("[EpubChapterViewer] Displaying final position (cached):", targetCFI || "beginning");
              rendition.display(targetCFI).then(finalizeInit).catch(finalizeInit);
              return;
            } catch (err) {
              console.warn("[EpubChapterViewer] Cached locations invalid, regenerating:", err);
              localStorage.removeItem(CACHE_KEY);
            }
          }

          // 캐시 미스 → 기본 디스플레이 시도 + 백그라운드 생성
          console.log("[EpubChapterViewer] No cached locations, initial display then background generate");
          rendition
            .display(initialCFI ?? undefined)
            .then(finalizeInit)
            .catch(finalizeInit);

          void book.locations
            .generate(EPUB_LOCATION_STRIDE)
            .then(() => {
              // 생성 결과 캐시
              const locationsObj = book.locations as unknown as EpubjsLocationsExtended;
              try {
                const serialized = locationsObj.save();
                localStorage.setItem(CACHE_KEY, serialized);
                console.log("[EpubChapterViewer] Locations generated and cached");
              } catch (err) {
                console.warn("[EpubChapterViewer] Failed to cache locations:", err);
              }

              locationsReadyRef.current = true;
              generatedTotalRef.current = book.locations.length();
              onReadyRef.current?.(generatedTotalRef.current);

              // locations.generate 완료 후 현재 위치 보정 (사용자에게 보일 수 있음 - 캐시 없는 첫 방문 시)
              const currentLoc = rendition.currentLocation() as unknown as EpubjsLocation;
              const currentPct = currentLoc?.start?.percentage ?? 0;
              const expectedRatio = typeof initialProgressRatio === "number" ? initialProgressRatio : 0;

              if (currentPct < 0.01 && expectedRatio > 0.01) {
                try {
                  const cfiFromRatio = book.locations.cfiFromPercentage(Math.max(0, Math.min(1, expectedRatio)));
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
        })
        .catch((err: Error) => {
          console.error("[EpubChapterViewer] Initialization failed:", err);
          onInitializationCompleteRef.current?.();
        });

      return () => {
        rendition.off("click", handleRenditionClick);
        rendition.off("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
        book.destroy();
        bookRef.current = null;
        renditionRef.current = null;
        locationsReadyRef.current = false;
        generatedTotalRef.current = 0;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      epubUrl,
      chapterId,
      handleRelocated,
      applySettings,
      initialCFI,
      initialProgressRatio,
      settings.flow,
      settings.spread,
    ]);

    // settings가 변경될 때 스타일 업데이트 (font-size, line-height 등)
    // flow나 spread가 변경되면 위 메인 useEffect가 다시 실행되어 rendition이 재초기화됩니다.

    useEffect(() => {
      if (!renditionRef.current) return;
      applySettings(renditionRef.current, settings);
    }, [settings, applySettings]);

    useImperativeHandle(ref, () => ({
      next: () => {
        renditionRef.current?.next();
      },
      prev: () => {
        renditionRef.current?.prev();
      },
      goToCFI: (cfi: string) => {
        if (!renditionRef.current) return;
        renditionRef.current.display(cfi).then(() => {
          const loc = renditionRef.current?.currentLocation() as unknown as EpubjsLocation;
          if (loc) handleRelocated(loc);
        });
      },
    }));

    return (
      <div
        className={styles.container}
        style={{ background: THEME_STYLES[settings.theme]?.background || "#fff" }}
      >
        <div
          ref={containerRef}
          className={styles.viewer}
        />
      </div>
    );
  },
);

EpubChapterViewer.displayName = "EpubChapterViewer";
export { EpubChapterViewer };
