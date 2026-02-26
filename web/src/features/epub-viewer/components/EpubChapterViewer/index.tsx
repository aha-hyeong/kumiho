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
  initialCFI?: string | null;
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
  }) => void;
  onViewerClick?: () => void;
  onInitializationComplete?: () => void;
}

const FONT_FAMILY_MAP: Record<string, string> = {
  default: "inherit",
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

const EPUB_LOCATION_STRIDE = 6144; // 6KB 단위로 가상 페이지(위치) 정의. backend/internal/util/epub.go의 EpubPositionStride와 일치해야 함.

const EpubChapterViewer = forwardRef<EpubChapterViewerHandles, EpubChapterViewerProps>(
  (
    { epubUrl, initialCFI, settings, onReady, onTOCLoad, onLocationChange, onViewerClick, onInitializationComplete },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const bookRef = useRef<Book | null>(null);
    const renditionRef = useRef<Rendition | null>(null);
    const locationsReadyRef = useRef(false);

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
      const fontFamily = FONT_FAMILY_MAP[s.fontFamily] || "inherit";
      rendition.themes.default({
        body: {
          background: `${theme.background} !important`,
          color: `${theme.color} !important`,
          "font-family": `${fontFamily} !important`,
          "font-size": `${s.fontSize}% !important`,
          "line-height": `${s.lineHeight} !important`,
          "column-fill": "auto",
        },
        "section, article, figure, table, div:has(> p), div[style*='background'], [class*='box']": {
          "break-inside": "avoid-column !important",
          "page-break-inside": "avoid !important",
          display: "flow-root !important",
          "background-clip": "padding-box !important",
        },
        "p, div, span": { color: `${theme.color} !important` },
        a: { color: s.theme === "dark" ? "#7eb8f7 !important" : "#1a6bb5 !important" },
      });
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

      // epub.js 내부 객체 타입 정의 (any 지양을 위해 상세 인터페이스 사용)
      interface EpubjsSpine {
        spineItems: Array<{ index: number; href: string }>;
      }
      interface EpubjsLocations {
        length: () => number;
      }

      const spine = book.spine as unknown as EpubjsSpine;
      const spineItems = spine.spineItems || [];
      const globalRatio = calculateGlobalProgress({
        percentage: start?.percentage,
        index: start?.index,
        spineLength: spineItems.length,
      });

      const currentPosition = start?.index || 0;
      const locations = book.locations as unknown as EpubjsLocations;
      const totalPositions = typeof locations?.length === "function" ? locations.length() : spineItems.length;

      onLocationChangeRef.current?.({
        cfi,
        chapterPage,
        chapterTotal,
        globalRatio,
        currentPosition,
        totalPositions,
      });
    }, []);

    useEffect(() => {
      if (!containerRef.current) return;

      const book = Epub(epubUrl, { openAs: "epub" });

      bookRef.current = book;
      locationsReadyRef.current = false;

      const rendition = book.renderTo(containerRef.current, {
        flow: settings.flow,
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

      book.ready
        .then(() => {
          console.log("[EpubChapterViewer] Book ready, displaying:", initialCFI || "beginning");
          return rendition.display(initialCFI ?? undefined);
        })
        .then(() => {
          console.log("[EpubChapterViewer] Initial display successful");
          // 폰트 및 스타일 다시 적용 (렌더링 이후 확실하게 하기 위함)
          applySettings(rendition, settings);

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

          book.locations.generate(EPUB_LOCATION_STRIDE).then(() => {
            locationsReadyRef.current = true;
            console.log("[EpubChapterViewer] Locations generated");

            // locations.generate()는 epub.js 0.3.x의 알려진 동작으로 인해
            // 렌디션 위치를 첫 페이지로 리셋할 수 있음.
            // initialCFI가 있는 경우 저장된 위치로 다시 이동한 후 초기화 완료 처리.
            const finalizeInit = () => {
              // 순서 중요: onReady → onInitializationComplete(isInitializingRef.current=false로 동기 갱신)
              // → handleRelocated (이 시점에 isInitializingRef.current가 false이므로 progress 업데이트 허용)
              onReadyRef.current?.(book.locations.length());
              onInitializationCompleteRef.current?.();
              const loc = rendition.currentLocation() as unknown as EpubjsLocation;
              if (loc) {
                console.log("[EpubChapterViewer] Finalizing initialization at:", loc.start.cfi);
                handleRelocated(loc);
              }
            };

            if (initialCFI) {
              console.log("[EpubChapterViewer] Restoring position after location generation:", initialCFI);
              rendition.display(initialCFI).then(finalizeInit).catch(finalizeInit);
            } else {
              finalizeInit();
            }
          });
        })
        .catch((err: Error) => {
          console.error("[EpubChapterViewer] Initialization failed:", err);
          // 실패하더라도 일단 로딩은 풀어줌 (Fallback)
          onInitializationCompleteRef.current?.();
        });

      return () => {
        rendition.off("click", handleRenditionClick);
        rendition.off("relocated", handleRelocated as unknown as (...args: unknown[]) => void);
        book.destroy();
        bookRef.current = null;
        renditionRef.current = null;
        locationsReadyRef.current = false;
      };
    }, [epubUrl, handleRelocated, settings, applySettings, initialCFI]);

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
