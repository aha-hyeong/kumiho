import React, { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";

// Polyfill: Uint8Array.prototype.toHex (Chrome 137+)
// pdfjs-dist v5 uses this internally; Samsung Internet (Chrome 136) lacks it.
// 네이티브 지원 여부를 폴리필 적용 전에 저장해야 워커 비활성화 판단에 사용할 수 있다.
declare global {
  interface Uint8Array {
    toHex?(this: Uint8Array): string;
  }
}
const NEEDS_TOHEX_POLYFILL = typeof Uint8Array.prototype.toHex !== "function";
// 메인 스레드와 워커 래퍼 양쪽에서 동일한 구현을 사용한다.
// 단일 함수에서 .toString()으로 워커 문자열을 생성하여 드리프트를 방지한다.
const TOHEX_POLYFILL_IMPL = function (this: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < this.length; i++) {
    hex += this[i].toString(16).padStart(2, "0");
  }
  return hex;
};
const TOHEX_POLYFILL_CODE = `if(typeof Uint8Array.prototype.toHex!=="function"){Object.defineProperty(Uint8Array.prototype,"toHex",{value:${TOHEX_POLYFILL_IMPL.toString()},writable:true,configurable:true,enumerable:false});}`;
if (NEEDS_TOHEX_POLYFILL) {
  Object.defineProperty(Uint8Array.prototype, "toHex", {
    value: TOHEX_POLYFILL_IMPL,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { LoadingSpinner } from "../../../../components/common/LoadingSpinner";
import { refreshAccessTokenForNonAxiosFlow } from "../../../../api/client";
import {
  type ReadingMode,
  type ReadingDirection,
  type PageTransitionType,
  useViewerStore,
} from "../../../../stores/viewerStore";
import { PageTransition } from "../PageTransition";
import { useSwipe } from "../../hooks/useSwipe";
import { useViewerZoom } from "../../hooks/useViewerZoom";
import type { ViewerAnimationHandles } from "../../types";
import styles from "./index.module.css";

// Define a flexible type for outline items returned by pdf.js
export interface PDFOutlineItem {
  title: string;
  pageNumber?: number;
  destination?: string | unknown[] | null;
  items: PDFOutlineItem[];
}

interface PDFJSOutline {
  title: string;
  dest?: string | unknown[] | null;
  items?: PDFJSOutline[] | null;
}

type PdfGetDocumentOptions = {
  url: string;
  withCredentials: boolean;
  disableWorker: boolean;
  httpHeaders?: Record<string, string>;
};

type PdfLoadPhase =
  | "worker-on/main-url"
  | "worker-on/query-token"
  | "worker-off/main-url"
  | "worker-off/query-token";

const resolveOutline = async (
  pdfDoc: pdfjsLib.PDFDocumentProxy,
  outline: PDFJSOutline[],
): Promise<PDFOutlineItem[]> => {
  const result: PDFOutlineItem[] = [];
  for (const item of outline) {
    let pageNumber: number | undefined;
    try {
      let dest = item.dest;
      if (typeof dest === "string") {
        dest = await pdfDoc.getDestination(dest);
      }
      if (Array.isArray(dest) && dest.length > 0) {
        // cast dest[0] since pdf.js returns multiple types
        const ref = dest[0] as Parameters<typeof pdfDoc.getPageIndex>[0];
        const pageIndex = await pdfDoc.getPageIndex(ref);
        pageNumber = pageIndex + 1;
      }
    } catch {
      console.warn("Failed to resolve outline dest:", item.title);
    }

    let children: PDFOutlineItem[] = [];
    if (item.items && item.items.length > 0) {
      children = await resolveOutline(pdfDoc, item.items);
    }
    result.push({ title: item.title, pageNumber, destination: item.dest ?? null, items: children });
  }
  return result;
};

if (NEEDS_TOHEX_POLYFILL) {
  // 워커도 별도 스레드이므로 동일 폴리필이 필요하다.
  // 폴리필 코드를 앞에 붙인 래퍼 모듈을 blob URL로 만들어 workerSrc로 사용한다.
  const canUseBlobWorker =
    typeof window !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function";

  if (canUseBlobWorker) {
    // location.origin이 "null"인 환경(file://, sandbox iframe 등)에서는
    // new URL()이 실패할 수 있으므로 try/catch로 방어한다.
    let absoluteWorkerUrl: string | null = null;
    try {
      const base = (typeof document !== "undefined" && document.baseURI) || globalThis.location?.href;
      if (base) absoluteWorkerUrl = new URL(pdfWorker, base).href;
    } catch {
      // URL 구성 실패 시 blob 워커를 건너뛴다.
    }

    if (absoluteWorkerUrl) {
      // static import는 blob URL 모듈에서 cross-origin 제약으로 실패할 수 있다.
      // dynamic import()를 사용하여 폴리필 적용 후 실제 워커를 로드한다.
      // top-level await로 워커 모듈 로드 완료까지 블로킹하여 메시지 유실을 방지한다.
      const wrapperCode = `${TOHEX_POLYFILL_CODE}\nawait import("${absoluteWorkerUrl}");`;
      const blob = new Blob([wrapperCode], { type: "text/javascript" });
      const blobUrl = URL.createObjectURL(blob);
      pdfjsLib.GlobalWorkerOptions.workerSrc = blobUrl;
      // pdf.js가 워커를 생성할 때마다 workerSrc를 참조하므로 앱 수명 동안 유지해야 한다.
      // 모바일/bfcache 환경에서는 unload가 호출되지 않을 수 있으므로 pagehide를 사용한다.
      if (typeof window !== "undefined") {
        const handlePageHide = (event: PageTransitionEvent) => {
          // bfcache로 페이지가 보존된 경우(event.persisted === true)에는
          // 복원 후에도 workerSrc가 유효해야 하므로 revoke를 건너뛴다.
          if (event.persisted) return;
          URL.revokeObjectURL(blobUrl);
          window.removeEventListener("pagehide", handlePageHide);
        };
        window.addEventListener("pagehide", handlePageHide);
      }
    } else {
      pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
    }
  } else {
    // 테스트/비브라우저 환경(JSDOM 등)에서는 blob 기반 워커 구성이 불가능하므로
    // 기본 workerSrc로 폴백하여 크래시를 방지한다.
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
  }
} else {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;
}

declare global {
  interface Window {
    __KUMIHO_PDF_VIEWER_CONFIG__?: {
      zoomRerenderDebounceMs?: number;
      zoomRerenderScaleDelta?: number;
      maxZoomScale?: number;
      headerZoomStep?: number;
    };
  }
}

const DEFAULT_ZOOM_RERENDER_DEBOUNCE_MS = 150;
const DEFAULT_ZOOM_RERENDER_SCALE_DELTA = 0.05;
const DEFAULT_MAX_ZOOM_SCALE = 2.5;
const DEFAULT_HEADER_ZOOM_STEP = 0.1;

const ZOOM_RERENDER_DEBOUNCE_MS =
  (typeof window !== "undefined" ? window.__KUMIHO_PDF_VIEWER_CONFIG__?.zoomRerenderDebounceMs : undefined) ??
  DEFAULT_ZOOM_RERENDER_DEBOUNCE_MS;
const ZOOM_RERENDER_SCALE_DELTA =
  (typeof window !== "undefined" ? window.__KUMIHO_PDF_VIEWER_CONFIG__?.zoomRerenderScaleDelta : undefined) ??
  DEFAULT_ZOOM_RERENDER_SCALE_DELTA;
const MAX_ZOOM_SCALE =
  (typeof window !== "undefined" ? window.__KUMIHO_PDF_VIEWER_CONFIG__?.maxZoomScale : undefined) ??
  DEFAULT_MAX_ZOOM_SCALE;
const HEADER_ZOOM_STEP =
  (typeof window !== "undefined" ? window.__KUMIHO_PDF_VIEWER_CONFIG__?.headerZoomStep : undefined) ??
  DEFAULT_HEADER_ZOOM_STEP;

interface PdfChapterViewerProps {
  chapterId: string | undefined;
  currentPage: number;
  fitMode: string;
  readingMode?: ReadingMode;
  readingDirection?: ReadingDirection;
  pageOffset?: number;
  wheelDirection?: "down" | "up";
  preloadCount?: number;
  onDocumentLoad: (numPages: number) => void;
  onNext: (delta?: number | React.MouseEvent) => void;
  onPrev: (delta?: number | React.MouseEvent) => void;
  onOutlineLoad?: (outline: PDFOutlineItem[]) => void;
  transitionType: PageTransitionType;
  /** 마지막 페이지에서 다음 챕터 이동 가능 여부 (PDF 슬라이드 애니메이션 억제용) */
  canGoNextChapter?: boolean;
  /** 첫 페이지에서 이전 챕터 이동 가능 여부 (PDF 슬라이드 애니메이션 억제용) */
  canGoPrevChapter?: boolean;
  onZoomChange?: (scale: number) => void;
  onPageChange?: (page: number) => void;
}

export const PdfChapterViewer = forwardRef<ViewerAnimationHandles, PdfChapterViewerProps>(
  (
    {
      chapterId,
      currentPage,
      fitMode,
      readingMode = "single",
      readingDirection = "ltr",
      pageOffset = 0,
      wheelDirection = "down",
      preloadCount = 2,
      onDocumentLoad,
      onNext,
      onPrev,
      onOutlineLoad,
      transitionType,
      canGoNextChapter = false,
      canGoPrevChapter = false,
      onZoomChange,
      onPageChange,
    },
    ref,
  ) => {
    const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
    const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
    const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set());
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
    const textLayersRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
    const observerRef = useRef<IntersectionObserver | null>(null);
    const zoomRerenderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastZoomRerenderScaleRef = useRef(1);
    const initialPageSyncDoneRef = useRef(false);
    const suppressPageChangeRef = useRef(false);
    const suppressReleaseTokenRef = useRef(0);
    const lastObservedPageRef = useRef<number | null>(null);
    const loading = chapterId ? loadedChapterId !== chapterId : false;
    const activePdfDoc = chapterId && loadedChapterId === chapterId ? pdfDoc : null;
    const [verticalZoomScale, setVerticalZoomScale] = useState(1);
    const verticalZoomScaleRef = useRef(1);
    const verticalAnchorAlignTimerRef = useRef<number | null>(null);
    const lastWheelNavAtRef = useRef(0);
    const resizePagesRef = useRef<number[]>([]);
    const renderPageRef = useRef<
      ((pageNum: number, canvas: HTMLCanvasElement, textLayerContainer: HTMLDivElement | null, renderQualityScale?: number) => Promise<void>) | null
    >(null);
    const onDocumentLoadRef = useRef(onDocumentLoad);
    const onOutlineLoadRef = useRef(onOutlineLoad);
    const successfulLoadChapterIdRef = useRef<string | null>(null);

    // Zoom and Navigation handlers
    const animateNextRef = useRef<(() => void) | null>(null);
    const animatePrevRef = useRef<(() => void) | null>(null);

    const handleAnimatedNext = useCallback(() => {
      if (canGoNextChapter) {
        onNext(readingMode === "double" ? 2 : 1);
      } else if (animateNextRef.current) {
        animateNextRef.current();
      } else {
        onNext(readingMode === "double" ? 2 : 1);
      }
    }, [canGoNextChapter, onNext, readingMode]);

    const handleAnimatedPrev = useCallback(() => {
      if (canGoPrevChapter) {
        onPrev(readingMode === "double" ? 2 : 1);
      } else if (animatePrevRef.current) {
        animatePrevRef.current();
      } else {
        onPrev(readingMode === "double" ? 2 : 1);
      }
    }, [canGoPrevChapter, onPrev, readingMode]);
    const getVerticalScrollContainer = () => {
      const parent = containerRef.current?.parentElement;
      return parent instanceof HTMLElement ? parent : null;
    };
    const beginSuppressPageChange = useCallback((durationMs: number) => {
      suppressPageChangeRef.current = true;
      const token = ++suppressReleaseTokenRef.current;
      return window.setTimeout(() => {
        if (suppressReleaseTokenRef.current === token) {
          suppressPageChangeRef.current = false;
        }
      }, durationMs);
    }, []);

    const clickDirection = useViewerStore.getState().settings.clickDirection;
    const { transformComponentRef, isZoomed, setIsZoomed, handleContentClick, handleMouseDown, handleMouseMove } =
      useViewerZoom({
        clickDirection,
        onNext: handleAnimatedNext,
        onPrev: handleAnimatedPrev,
        isVerticalMode: readingMode === "vertical",
        deferSingleTapForDoubleTap: true,
        doubleTapZoomZone: "center",
        onVerticalZoomToggle: (isZoomingIn: boolean, anchor) => {
          const content = getVerticalScrollContainer();
          const nextScale = isZoomingIn ? 2 : 1;
          const anchorPage = anchor?.pageNum;
          const anchorPageYRatio = anchor?.pageYRatio ?? 0.5;

          setVerticalZoomScale(nextScale);
          verticalZoomScaleRef.current = nextScale;
          onZoomChange?.(nextScale);

          if (content && anchorPage) {
            const alignToAnchorPage = () => {
              const pageEl = containerRef.current?.querySelector<HTMLElement>(`[data-page="${anchorPage}"]`);
              if (!pageEl) return;

              const contentRect = content.getBoundingClientRect();
              const pageRect = pageEl.getBoundingClientRect();
              const pageAnchorY = pageRect.top + pageRect.height * anchorPageYRatio;
              const desiredAnchorY = contentRect.top + content.clientHeight * anchorPageYRatio;
              const delta = pageAnchorY - desiredAnchorY;
              const target = content.scrollTop + delta;
              const maxScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
              content.scrollTop = Math.max(0, Math.min(target, maxScrollTop));
            };

            if (verticalAnchorAlignTimerRef.current) {
              clearTimeout(verticalAnchorAlignTimerRef.current);
              verticalAnchorAlignTimerRef.current = null;
            }
            requestAnimationFrame(alignToAnchorPage);
            verticalAnchorAlignTimerRef.current = window.setTimeout(() => {
              alignToAnchorPage();
              verticalAnchorAlignTimerRef.current = null;
            }, 120);
          }
        },
      });

    useEffect(() => {
      return () => {
        if (verticalAnchorAlignTimerRef.current) {
          clearTimeout(verticalAnchorAlignTimerRef.current);
          verticalAnchorAlignTimerRef.current = null;
        }
      };
    }, []);

    // 현재 표시할 페이지 계산 (Double 모드 대응)
    const getDisplayPages = useCallback(() => {
      if (readingMode === "single") return [currentPage];
      if (readingMode === "vertical") {
        if (!activePdfDoc) return [];
        return Array.from({ length: activePdfDoc.numPages }, (_, i) => i + 1);
      }

      // Double 모드
      if (pageOffset === 1 && currentPage === 1) return [1];

      let startPage = currentPage;
      if (pageOffset === 0) {
        if (startPage % 2 === 0) startPage--;
      } else {
        if (startPage % 2 !== 0) startPage--;
      }
      if (startPage < 1) startPage = 1;

      const pages = [startPage];
      if (activePdfDoc && startPage + 1 <= activePdfDoc.numPages) {
        pages.push(startPage + 1);
      }
      return pages;
    }, [activePdfDoc, currentPage, readingMode, pageOffset]);

    const displayPages = getDisplayPages();

    useEffect(() => {
      onDocumentLoadRef.current = onDocumentLoad;
    }, [onDocumentLoad]);

    useEffect(() => {
      onOutlineLoadRef.current = onOutlineLoad;
    }, [onOutlineLoad]);

    useEffect(() => {
      successfulLoadChapterIdRef.current = null;
    }, [chapterId]);

    useEffect(() => {
      initialPageSyncDoneRef.current = false;
      suppressPageChangeRef.current = false;
      suppressReleaseTokenRef.current += 1;
    }, [chapterId, readingMode]);

    useEffect(() => {
      return () => {
        suppressReleaseTokenRef.current += 1;
        suppressPageChangeRef.current = false;
      };
    }, []);

    // 이전/다음 페이지 계산 (애니메이션용)
    const getAdjacentPages = useCallback(
      (page: number, delta: number) => {
        if (readingMode === "vertical" || !activePdfDoc) return [];
        if (readingMode === "single") {
          const target = page + delta;
          if (target >= 1 && target <= activePdfDoc.numPages) return [target];
          return [];
        }
        // Double mode
        let targetStart = page + delta;
        if (pageOffset === 0) {
          if (targetStart % 2 === 0) targetStart--;
        } else {
          if (targetStart % 2 !== 0) targetStart--;
        }
        if (targetStart < 1 || targetStart > activePdfDoc.numPages) return [];
        const pages = [targetStart];
        if (targetStart + 1 <= activePdfDoc.numPages) {
          pages.push(targetStart + 1);
        }
        return pages;
      },
      [activePdfDoc, readingMode, pageOffset],
    );

    const prevDisplayPages = getAdjacentPages(currentPage, readingMode === "double" ? -2 : -1);
    const nextDisplayPages = getAdjacentPages(currentPage, readingMode === "double" ? 2 : 1);

    // Load Document
    useEffect(() => {
      let isMounted = true;
      const renderTasks = renderTasksRef.current;
      let activeLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

      if (!chapterId) {
        onDocumentLoadRef.current(0);
        return;
      }

      const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
      const basePdfUrl = `${API_BASE_URL}/chapters/${chapterId}/pdf`;
      const requestedChapterId = chapterId;
      let hasRetriedAfterRefresh = false;

      const buildGetDocumentOptions = (disableWorker: boolean, preferQueryToken: boolean): PdfGetDocumentOptions => {
        // Pass Bearer token only when a valid-looking access token exists.
        // Legacy `token` key can contain stale/non-JWT values and break PDF-only requests.
        let options: PdfGetDocumentOptions = {
          url: basePdfUrl,
          withCredentials: true,
          disableWorker,
        };
        try {
          if (typeof window !== "undefined" && window.localStorage) {
            const token = window.localStorage.getItem("access_token");
            const isLikelyJwt = typeof token === "string" && token.split(".").length === 3;
            if (isLikelyJwt) {
              const queryUrl = `${basePdfUrl}?token=${encodeURIComponent(token)}`;
              options = {
                ...options,
                url: preferQueryToken ? queryUrl : basePdfUrl,
                httpHeaders: {
                  Authorization: `Bearer ${token}`,
                },
              };
            }
          }
        } catch {
          // Ignore localStorage errors (e.g. private mode)
        }
        return options;
      };

      const loadPdf = async (
        disableWorker: boolean,
        preferQueryToken: boolean,
      ): Promise<pdfjsLib.PDFDocumentProxy> => {
        const loadingTask = pdfjsLib.getDocument(
          buildGetDocumentOptions(disableWorker, preferQueryToken) as Parameters<typeof pdfjsLib.getDocument>[0],
        );
        activeLoadingTask = loadingTask;
        return loadingTask.promise;
      };

      const getPhase = (disableWorker: boolean, preferQueryToken: boolean): PdfLoadPhase => {
        if (!disableWorker && !preferQueryToken) return "worker-on/main-url";
        if (!disableWorker && preferQueryToken) return "worker-on/query-token";
        if (disableWorker && !preferQueryToken) return "worker-off/main-url";
        return "worker-off/query-token";
      };

      const loadWithPhase = async (
        disableWorker: boolean,
        preferQueryToken: boolean,
      ): Promise<pdfjsLib.PDFDocumentProxy> => {
        const phase = getPhase(disableWorker, preferQueryToken);
        try {
          return await loadPdf(disableWorker, preferQueryToken);
        } catch (err) {
          activeLoadingTask?.destroy();
          const wrappedError = err instanceof Error ? err : new Error(String(err));
          (wrappedError as Error & { phase?: PdfLoadPhase }).phase = phase;
          throw wrappedError;
        }
      };

      const runLoadSequence = async (disableWorker: boolean): Promise<pdfjsLib.PDFDocumentProxy> => {
        try {
          return await loadWithPhase(disableWorker, false);
        } catch {
          if (!hasRetriedAfterRefresh) {
            hasRetriedAfterRefresh = true;
            try {
              await refreshAccessTokenForNonAxiosFlow();
              return await loadWithPhase(disableWorker, false);
            } catch (refreshOrRetryErr) {
              console.warn("PDF refresh/retry failed, trying query token fallback", refreshOrRetryErr);
            }
          }
          return loadWithPhase(disableWorker, true);
        }
      };

      const startLoad = async () => {
        try {
          let pdf: pdfjsLib.PDFDocumentProxy;
          try {
            // blob 래퍼로 워커에 폴리필을 주입하므로 기본적으로 워커를 사용한다.
            pdf = await runLoadSequence(false);
          } catch (firstErr) {
            // 언마운트(또는 chapterId 변경) 이후에는 재시도를 수행하지 않는다.
            if (!isMounted) return;
            console.warn("PDF load failed, retrying with worker disabled", firstErr);
            pdf = await runLoadSequence(true);
          }

          if (!isMounted) return;
          setPdfDoc(pdf);
          setLoadedChapterId(requestedChapterId);
          successfulLoadChapterIdRef.current = requestedChapterId;
          onDocumentLoadRef.current(pdf.numPages);
          pdf
            .getOutline()
            .then(async (outline) => {
              if (isMounted && onOutlineLoadRef.current && outline) {
                const resolved = await resolveOutline(pdf, outline);
                if (isMounted) onOutlineLoadRef.current?.(resolved);
              }
            })
            .catch((err) => console.error("PDF outline load error:", err));
        } catch (err) {
          // 최종 실패한 loadingTask의 리소스(워커/네트워크)를 정리한다.
          activeLoadingTask?.destroy();
          const errObj = err as {
            name?: string;
            message?: string;
            status?: number;
            code?: string;
            phase?: PdfLoadPhase;
          };
          console.error("PDF load error:", {
            chapterId: requestedChapterId,
            phase: errObj?.phase ?? "worker-off/query-token",
            name: errObj?.name,
            message: errObj?.message,
            status: errObj?.status,
            code: errObj?.code,
            raw: err,
          });
          if (!isMounted) return;

          // 모바일 환경에서 후속 네트워크 실패가 간헐적으로 발생해도
          // 이미 성공적으로 로드된 챕터의 전체 페이지 수를 0으로 덮어쓰지 않도록 보호.
          if (successfulLoadChapterIdRef.current === requestedChapterId) {
            console.warn("Ignoring late PDF load failure after successful load:", requestedChapterId);
            return;
          }

          setPdfDoc(null);
          setLoadedChapterId(requestedChapterId);
          onDocumentLoadRef.current(0);
        }
      };

      void startLoad();

      return () => {
        isMounted = false;
        activeLoadingTask?.destroy();
        renderTasks.forEach((task) => task.cancel());
        renderTasks.clear();
      };
    }, [chapterId]);

    const renderPages = (pages: number[]) =>
      pages.map((pageNum) => (
        <div
          key={pageNum}
          className={styles.pageWrapper}
          data-page={pageNum}
          ref={(el) => {
            if (el) observerRef.current?.observe(el);
          }}
          style={{
            flexShrink: 0,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            position: "relative",
          }}
        >
          <canvas
            ref={(el) => {
              if (el) canvasesRef.current.set(pageNum, el);
              else canvasesRef.current.delete(pageNum);
            }}
          />
          <div
            ref={(el) => {
              if (el) textLayersRef.current.set(pageNum, el);
              else textLayersRef.current.delete(pageNum);
            }}
            className={styles.textLayer}
            data-text-layer="true"
          />
        </div>
      ));

    // 페이지 렌더링 함수
    const renderPage = useCallback(
      async (
        pageNum: number,
        canvas: HTMLCanvasElement,
        textLayerContainer: HTMLDivElement | null,
        renderQualityScale = 1,
      ) => {
        if (!activePdfDoc) return;

        try {
          // 기존 렌더링 작업 취소는 모든 경로에서 먼저 보장
          const existingTask = renderTasksRef.current.get(pageNum);
          if (existingTask) {
            existingTask.cancel();
            renderTasksRef.current.delete(pageNum);
          }

          const containerWidth = containerRef.current?.clientWidth ?? window.innerWidth;
          const containerHeight =
            readingMode === "vertical"
              ? containerRef.current?.parentElement?.clientHeight ?? window.innerHeight
              : containerRef.current?.clientHeight ?? window.innerHeight;

          // 모바일에서 레이아웃이 아직 확정되지 않아 크기가 0인 경우 렌더링 건너뜀
          // ResizeObserver가 크기 확정 시 재렌더링을 트리거함
          if (containerWidth <= 1 || containerHeight <= 1) {
            renderTasksRef.current.delete(pageNum);
            return;
          }

          const page = await activePdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });

          const availableWidth =
            readingMode === "double" && displayPages.length > 1 ? containerWidth / 2 : containerWidth;
          const availableHeight = containerHeight;

          let targetScale = 1;

          if (fitMode === "width") {
            targetScale = availableWidth / viewport.width;
          } else if (fitMode === "height") {
            targetScale = availableHeight / viewport.height;
          } else if (fitMode === "screen") {
            const scaleW = availableWidth / viewport.width;
            const scaleH = availableHeight / viewport.height;
            targetScale = Math.min(scaleW, scaleH);
          } else if (fitMode === "original") {
            targetScale = 1.0;
          } else {
            // Default: width fit for vertical, screen fit for others
            if (readingMode === "vertical") {
              targetScale = availableWidth / viewport.width;
            } else {
              const scaleW = availableWidth / viewport.width;
              const scaleH = availableHeight / viewport.height;
              targetScale = Math.min(scaleW, scaleH);
            }
          }

          if (readingMode === "vertical") {
            targetScale *= verticalZoomScale;
          }

          const outputScale = (window.devicePixelRatio || 1) * renderQualityScale;
          const scaledViewport = page.getViewport({ scale: targetScale * outputScale });
          const context = canvas.getContext("2d");

          if (context) {
            canvas.width = Math.floor(scaledViewport.width);
            canvas.height = Math.floor(scaledViewport.height);
            canvas.style.width = `${Math.floor(scaledViewport.width / outputScale)}px`;
            canvas.style.height = `${Math.floor(scaledViewport.height / outputScale)}px`;

            const renderContext = {
              canvas,
              canvasContext: context,
              viewport: scaledViewport,
            };

            const task = page.render(renderContext);
            renderTasksRef.current.set(pageNum, task);
            await task.promise;
            renderTasksRef.current.delete(pageNum);

            // 텍스트 레이어 렌더링
            if (textLayerContainer) {
              textLayerContainer.innerHTML = "";

              // 텍스트 레이어는 원본 크기(scale: 1)로 렌더링하고 CSS transform으로 축소/확대하여
              // 브라우저의 텍스트 선택(hit-testing) 정확도를 높임
              const textViewport = page.getViewport({ scale: 1 });
              const textContentSource = await page.getTextContent();

              textLayerContainer.style.width = `${Math.floor(textViewport.width)}px`;
              textLayerContainer.style.height = `${Math.floor(textViewport.height)}px`;

              // 부모(pageWrapper) 크기에 맞게 CSS transform 적용
              textLayerContainer.style.transform = `scale(${targetScale})`;
              textLayerContainer.style.transformOrigin = "top left";

              // PDF.js에서 내부적으로 사용하는 스케일 변수 설정
              textLayerContainer.style.setProperty("--scale-factor", targetScale.toString());

              const textLayerCtor = (pdfjsLib as unknown as {
                TextLayer?: new (params: {
                  textContentSource: unknown;
                  container: HTMLDivElement;
                  viewport: unknown;
                }) => { render: () => Promise<void> };
              }).TextLayer;

              if (textLayerCtor) {
                const textLayer = new textLayerCtor({
                  textContentSource,
                  container: textLayerContainer,
                  viewport: textViewport,
                });
                await textLayer.render();
              }
            }
          }
        } catch (err: unknown) {
          if (!isRenderingCancelledError(err)) {
            console.error(`Page ${pageNum} render error:`, err);
          }
        }
      },
      [activePdfDoc, fitMode, readingMode, displayPages.length, verticalZoomScale],
    );

    useEffect(() => {
      renderPageRef.current = renderPage;
    }, [renderPage]);

    const rerenderCurrentPages = useCallback(() => {
      const pagesToRender = resizePagesRef.current;
      const renderPageFn = renderPageRef.current;
      if (!renderPageFn) return;

      pagesToRender.forEach((pageNum) => {
        const canvas = canvasesRef.current.get(pageNum);
        const textLayer = textLayersRef.current.get(pageNum);
        if (canvas) renderPageFn(pageNum, canvas, textLayer || null, lastZoomRerenderScaleRef.current);
      });
    }, []);

    useEffect(
      () => () => {
        if (zoomRerenderTimerRef.current) {
          clearTimeout(zoomRerenderTimerRef.current);
        }
      },
      [],
    );

    const handleZoomStop = useCallback(
      (scale: number) => {
        if (readingMode === "vertical" || loading) return;

        const renderQualityScale = Math.min(Math.max(scale, 1), MAX_ZOOM_SCALE);
        if (Math.abs(renderQualityScale - lastZoomRerenderScaleRef.current) < ZOOM_RERENDER_SCALE_DELTA) return;

        if (zoomRerenderTimerRef.current) {
          clearTimeout(zoomRerenderTimerRef.current);
        }

        zoomRerenderTimerRef.current = setTimeout(() => {
          displayPages.forEach((pageNum) => {
            const canvas = canvasesRef.current.get(pageNum);
            const textLayer = textLayersRef.current.get(pageNum);
            if (canvas) {
              renderPage(pageNum, canvas, textLayer || null, renderQualityScale);
            }
          });
          lastZoomRerenderScaleRef.current = renderQualityScale;
          zoomRerenderTimerRef.current = null;
        }, ZOOM_RERENDER_DEBOUNCE_MS);
      },
      [displayPages, loading, readingMode, renderPage],
    );

    // IntersectionObserver 초기화 (세로 모드 지연 로딩용)
    useEffect(() => {
      if (readingMode !== "vertical") {
        return;
      }

      const observer = new IntersectionObserver(
        (entries) => {
          setVisiblePages((prev) => {
            const next = new Set(prev);
            entries.forEach((entry) => {
              const pageNum = Number((entry.target as HTMLElement).dataset.page);
              if (entry.isIntersecting) {
                next.add(pageNum);
              } else {
                next.delete(pageNum);
              }
            });
            return next;
          });

          // 현재 보여지는 가장 적절한 페이지 계산 및 상위 보고
          if (onPageChange) {
            if (!initialPageSyncDoneRef.current || suppressPageChangeRef.current) {
              return;
            }
            // 가시성이 가장 높은 엔트리 찾기
            const visibleEntries = entries.filter((e) => e.isIntersecting);
            if (visibleEntries.length > 0) {
              // 여러 페이지가 보일 때, 가장 위에 있거나 가장 많이 보이는 페이지 선택
              // IntersectionObserverEntry의 intersectionRatio나 boundingClientRect를 활용할 수 있음
              const topEntry = visibleEntries.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
              const pageNum = Number((topEntry.target as HTMLElement).dataset.page);
              if (!isNaN(pageNum) && pageNum !== currentPage) {
                lastObservedPageRef.current = pageNum;
                onPageChange(pageNum);
              }
            }
          }
        },
        {
          root: getVerticalScrollContainer(),
          threshold: 0.1,
          rootMargin: "-10% 0px -40% 0px",
        }, // 중앙 부근을 더 잘 감지하도록 마진 조정
      );

      observerRef.current = observer;
      const pageElements = containerRef.current?.querySelectorAll<HTMLElement>("[data-page]") ?? [];
      pageElements.forEach((el) => observer.observe(el));

      // 맨 아래 스크롤 스티키 감지 (마지막 페이지 강제)
      const handleScroll = () => {
        const content = getVerticalScrollContainer();
        if (!content || !pdfDoc) return;

        const isAtBottom = content.scrollTop + content.clientHeight >= content.scrollHeight - 10;
        if (isAtBottom && pdfDoc.numPages > 0 && currentPage !== pdfDoc.numPages) {
          onPageChange?.(pdfDoc.numPages);
        }
      };

      const content = getVerticalScrollContainer();
      content?.addEventListener("scroll", handleScroll, { passive: true });

      return () => {
        observer.disconnect();
        content?.removeEventListener("scroll", handleScroll);
        observerRef.current = null;
      };
    }, [readingMode, onPageChange, currentPage, pdfDoc]);

    // 세로 모드 초기 진입 시 저장된 currentPage 위치로 먼저 스크롤한 뒤 페이지 감지 활성화
    useEffect(() => {
      if (readingMode !== "vertical") return;
      if (!activePdfDoc || loading) return;
      if (initialPageSyncDoneRef.current) return;

      const content = getVerticalScrollContainer();
      if (!content) return;

      const targetPage = Math.max(1, Math.min(currentPage, activePdfDoc.numPages));
      const targetEl = containerRef.current?.querySelector<HTMLElement>(`[data-page="${targetPage}"]`);

      const timer = beginSuppressPageChange(250);
      if (targetEl && targetPage > 1) {
        requestAnimationFrame(() => {
          targetEl.scrollIntoView({ block: "start" });
        });
      }

      const doneTimer = window.setTimeout(() => {
        initialPageSyncDoneRef.current = true;
      }, 250);

      return () => {
        window.clearTimeout(timer);
        window.clearTimeout(doneTimer);
      };
    }, [readingMode, activePdfDoc, loading, currentPage, beginSuppressPageChange]);

    // TOC/슬라이더 등 외부 currentPage 변경 시 세로 모드 스크롤 위치 동기화
    useEffect(() => {
      if (readingMode !== "vertical") return;
      if (!activePdfDoc || loading) return;
      if (!initialPageSyncDoneRef.current) return;
      if (suppressPageChangeRef.current) return;

      // Observer가 보고한 자연 스크롤 페이지 변경은 다시 강제 스크롤하지 않음
      if (lastObservedPageRef.current === currentPage) {
        lastObservedPageRef.current = null;
        return;
      }

      const content = getVerticalScrollContainer();
      if (!content) return;

      const targetPage = Math.max(1, Math.min(currentPage, activePdfDoc.numPages));
      const targetEl = containerRef.current?.querySelector<HTMLElement>(`[data-page="${targetPage}"]`);
      if (!targetEl) return;

      const rootRect = content.getBoundingClientRect();
      const targetRect = targetEl.getBoundingClientRect();
      const isFullyVisible = targetRect.top >= rootRect.top && targetRect.bottom <= rootRect.bottom;
      if (isFullyVisible) return;

      const timer = beginSuppressPageChange(120);
      // TOC/슬라이더 점프는 중간 observer 이벤트에 영향받지 않도록 즉시 정확한 위치로 이동
      const targetTop = content.scrollTop + (targetRect.top - rootRect.top);
      content.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
      lastObservedPageRef.current = currentPage;

      return () => window.clearTimeout(timer);
    }, [readingMode, activePdfDoc, loading, currentPage, beginSuppressPageChange]);

    // 실제 렌더링에 사용할 가시 페이지 계산
    const activeVisiblePages = useMemo<Set<number>>(() => {
      if (readingMode !== "vertical") {
        return new Set(displayPages);
      }
      if (visiblePages.size > 0) {
        // 세로 모드에서는 현재 보이는 페이지 주변도 함께 렌더링해
        // 다음/이전 페이지 체감 로딩 지연을 줄인다.
        const preloadRange = Math.max(0, Math.floor(preloadCount));
        const bufferedPages = new Set<number>();
        visiblePages.forEach((pageNum) => {
          for (let delta = -preloadRange; delta <= preloadRange; delta++) {
            const target = pageNum + delta;
            if (target >= 1 && target <= displayPages.length) {
              bufferedPages.add(target);
            }
          }
        });
        return bufferedPages;
      }
      // Observer가 초기 프레임에서 아직 페이지를 감지하지 못했을 때 최소 1장은 렌더링 보장
      const fallbackPages = new Set<number>();
      if (displayPages.length > 0) {
        const clampedPage = Math.max(1, Math.min(currentPage, displayPages.length));
        fallbackPages.add(clampedPage);
        if (clampedPage + 1 <= displayPages.length) {
          fallbackPages.add(clampedPage + 1);
        }
      }
      return fallbackPages;
    }, [readingMode, visiblePages, displayPages, currentPage, preloadCount]);

    useEffect(() => {
      resizePagesRef.current = readingMode === "vertical" ? Array.from(activeVisiblePages) : displayPages;
    }, [readingMode, activeVisiblePages, displayPages]);

    // 현재 페이지(들) 렌더링
    useEffect(() => {
      if (!activePdfDoc || loading) return;

      const pagesToRender = readingMode === "vertical" ? Array.from(activeVisiblePages) : displayPages;

      pagesToRender.forEach((pageNum) => {
        const canvas = canvasesRef.current.get(pageNum);
        const textLayer = textLayersRef.current.get(pageNum);
        if (canvas) renderPage(pageNum, canvas, textLayer || null, lastZoomRerenderScaleRef.current);
      });
    }, [
      activePdfDoc,
      loading,
      currentPage,
      fitMode,
      readingMode,
      displayPages,
      activeVisiblePages,
      renderPage,
      verticalZoomScale,
    ]);

    // 창 크기 조절 대응 + 모바일 레이아웃 지연 대응 (ResizeObserver)
    useEffect(() => {
      window.addEventListener("resize", rerenderCurrentPages);

      // ResizeObserver: 모바일에서 컨테이너 크기가 0→유효값으로 변할 때만 재렌더링
      // 디바운스로 UI 토글 등에 의한 즉시 재렌더링이 더블클릭 감지를 방해하지 않도록 함
      let resizeObserver: ResizeObserver | null = null;
      let resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;
      const container = containerRef.current;
      let lastWidth = container?.clientWidth ?? 0;
      let lastHeight = container?.clientHeight ?? 0;
      if (container && typeof ResizeObserver === "function") {
        resizeObserver = new ResizeObserver((entries) => {
          const entry = entries[0];
          if (!entry) return;
          const { width, height } = entry.contentRect;
          if (width > 1 && height > 1 && (Math.abs(width - lastWidth) > 1 || Math.abs(height - lastHeight) > 1)) {
            lastWidth = width;
            lastHeight = height;
            if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
            resizeDebounceTimer = setTimeout(rerenderCurrentPages, 150);
          }
        });
        resizeObserver.observe(container);
      }

      return () => {
        window.removeEventListener("resize", rerenderCurrentPages);
        if (resizeDebounceTimer) clearTimeout(resizeDebounceTimer);
        resizeObserver?.disconnect();
      };
    }, [rerenderCurrentPages, loading]);

    // Swipe Hook
    const { onTouchStart, onTouchMove, onTouchEnd, swipeOffset, isAnimating, animateNext, animatePrev } = useSwipe({
      onNext: () => onNext(readingMode === "double" ? 2 : 1),
      onPrev: () => onPrev(readingMode === "double" ? 2 : 1),
      readingDirection,
      isZoomed,
      containerRef,
      gap: 20,
      duration: 300,
      skipNextAnimation: canGoNextChapter,
      skipPrevAnimation: canGoPrevChapter,
    });

    // Keep refs in sync with useSwipe's animation functions
    useEffect(() => {
      animateNextRef.current = animateNext;
      animatePrevRef.current = animatePrev;
    }, [animateNext, animatePrev]);

    const jumpToDestination = useCallback(
      async (destination?: string | unknown[] | null): Promise<number | null> => {
        if (!activePdfDoc || !destination) return null;

        try {
          let resolvedDestination: unknown[] | null = null;

          if (typeof destination === "string") {
            resolvedDestination = await activePdfDoc.getDestination(destination);
          } else if (Array.isArray(destination)) {
            resolvedDestination = destination;
          }

          if (!resolvedDestination || resolvedDestination.length === 0) return null;

          const ref = resolvedDestination[0] as Parameters<typeof activePdfDoc.getPageIndex>[0];
          const pageIndex = await activePdfDoc.getPageIndex(ref);
          return pageIndex + 1;
        } catch (error) {
          console.warn("PDF destination jump resolve failed:", error);
          return null;
        }
      },
      [activePdfDoc],
    );

    useImperativeHandle(
      ref,
      () => ({
        animateNext,
        animatePrev,
        zoomIn: () => {
          if (readingMode === "vertical") {
            const currentScale = verticalZoomScaleRef.current;
            const targetScale = Math.min(MAX_ZOOM_SCALE, currentScale + HEADER_ZOOM_STEP);
            verticalZoomScaleRef.current = targetScale;
            setVerticalZoomScale(targetScale);
            setIsZoomed(targetScale > 1.01);
            onZoomChange?.(targetScale);
            return;
          }

          const currentScale = transformComponentRef.current?.instance.transformState.scale ?? 1;
          const targetScale = Math.min(MAX_ZOOM_SCALE, currentScale + HEADER_ZOOM_STEP);
          const step = Math.max(0, Math.log(targetScale / currentScale));
          transformComponentRef.current?.zoomIn(step, 0);
          onZoomChange?.(targetScale);
        },
        zoomOut: () => {
          if (readingMode === "vertical") {
            const currentScale = verticalZoomScaleRef.current;
            const targetScale = Math.max(1, currentScale - HEADER_ZOOM_STEP);
            verticalZoomScaleRef.current = targetScale;
            setVerticalZoomScale(targetScale);
            setIsZoomed(targetScale > 1.01);
            onZoomChange?.(targetScale);
            return;
          }

          const currentScale = transformComponentRef.current?.instance.transformState.scale ?? 1;
          const targetScale = Math.max(1, currentScale - HEADER_ZOOM_STEP);
          const step = Math.max(0, Math.log(currentScale / targetScale));
          transformComponentRef.current?.zoomOut(step, 0);
          onZoomChange?.(targetScale);
        },
        resetZoom: () => {
          if (readingMode === "vertical") {
            verticalZoomScaleRef.current = 1;
            setVerticalZoomScale(1);
            setIsZoomed(false);
            onZoomChange?.(1);
            return;
          }

          transformComponentRef.current?.resetTransform(0);
          onZoomChange?.(1);
        },
        getZoomScale: () =>
          readingMode === "vertical"
            ? verticalZoomScaleRef.current
            : (transformComponentRef.current?.instance.transformState.scale ?? 1),
        jumpToDestination,
      }),
      [animateNext, animatePrev, jumpToDestination, onZoomChange, readingMode, setIsZoomed, transformComponentRef],
    );

    // 이전/다음 페이지 미리 렌더링
    useEffect(() => {
      if (!activePdfDoc || loading || readingMode === "vertical") return;
      [...prevDisplayPages, ...nextDisplayPages].forEach((pageNum) => {
        const canvas = canvasesRef.current.get(pageNum);
        const textLayer = textLayersRef.current.get(pageNum);
        if (canvas) renderPage(pageNum, canvas, textLayer || null);
      });
    }, [activePdfDoc, loading, prevDisplayPages, nextDisplayPages, renderPage, readingMode]);

    const handleInternalClick = (e: React.MouseEvent | React.TouchEvent) => {
      handleContentClick(e);
    };

    const handleWheelNavigation = useCallback(
      (event: React.WheelEvent) => {
        if (readingMode === "vertical") return;
        if (event.ctrlKey || isZoomed) return;

        if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Math.abs(event.deltaY) < 8) {
          return;
        }

        const now = Date.now();
        if (now - lastWheelNavAtRef.current < 220) {
          event.preventDefault();
          return;
        }
        lastWheelNavAtRef.current = now;

        event.preventDefault();
        const isNext = wheelDirection === "down" ? event.deltaY > 0 : event.deltaY < 0;
        if (isNext) {
          handleAnimatedNext();
          return;
        }
        handleAnimatedPrev();
      },
      [handleAnimatedNext, handleAnimatedPrev, isZoomed, readingMode, wheelDirection],
    );

    if (loading) {
      return (
        <div className={styles.loadingContainer}>
          <LoadingSpinner
            fullScreen={false}
            text="Loading PDF..."
          />
        </div>
      );
    }

    const isRTL = readingDirection === "rtl" && readingMode === "double";

    // Swipe handlers configuration
    const swipeHandlers =
      readingMode === "vertical"
        ? {}
        : {
            onTouchStart,
            onTouchMove,
            onTouchEnd,
          };

    if (readingMode === "vertical") {
      return (
        <PageTransition
          ref={containerRef}
          className={`${styles.viewerWrapper} ${styles.vertical}`}
          isVertical
          offset={swipeOffset}
          isAnimating={isAnimating}
          readingDirection={readingDirection}
          transitionType={transitionType}
          gap={20}
          duration={300}
          onClick={handleInternalClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          style={{ background: "transparent" }}
        >
          <div
            className={styles.canvasContainer}
            style={{
              ...getCanvasContainerStyle(readingMode, isRTL),
            }}
          >
            {renderPages(displayPages)}
          </div>
        </PageTransition>
      );
    }

    return (
      <PageTransition
        ref={containerRef}
        className={`${styles.viewerWrapper} ${styles[readingMode]}`}
        isVertical={false}
        offset={swipeOffset}
        isAnimating={isAnimating}
        readingDirection={readingDirection}
        transitionType={transitionType}
        gap={20}
        duration={300}
        {...swipeHandlers}
        onClick={handleInternalClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onWheel={handleWheelNavigation}
        style={{ background: "transparent" }}
        prevChildren={
          <div
            className={styles.canvasContainer}
            style={getCanvasContainerStyle(readingMode, isRTL)}
          >
            {renderPages(prevDisplayPages)}
          </div>
        }
        nextChildren={
          <div
            className={styles.canvasContainer}
            style={getCanvasContainerStyle(readingMode, isRTL)}
          >
            {renderPages(nextDisplayPages)}
          </div>
        }
      >
        <div
          style={{ width: "100%", height: "100%", flexShrink: 0 }}
        >
          <TransformWrapper
            ref={transformComponentRef}
            initialScale={1}
            minScale={1}
            maxScale={MAX_ZOOM_SCALE}
            wheel={{ disabled: false, activationKeys: ["Control"] }}
            doubleClick={{ disabled: true }}
            panning={{ disabled: !isZoomed, excluded: ["span"] }}
            zoomAnimation={{ animationTime: 240, animationType: "easeOut" }}
            onTransformed={(_, state) => {
              setIsZoomed(state.scale > 1.01);
              handleZoomStop(state.scale);
              onZoomChange?.(state.scale);
            }}
            onZoomStop={(zoomRef) => {
              handleZoomStop(zoomRef.state.scale);
            }}
          >
            <TransformComponent
              wrapperStyle={{ width: "100%", height: "100%", overflow: "hidden" }}
              contentStyle={{
                width: "100%",
                height: "100%",
                display: "flex",
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                className={styles.canvasContainer}
                style={getCanvasContainerStyle(readingMode, isRTL)}
              >
                {renderPages(displayPages)}
              </div>
            </TransformComponent>
          </TransformWrapper>
        </div>
      </PageTransition>
    );
  },
);

const getCanvasContainerStyle = (readingMode: string, isRtl: boolean): React.CSSProperties => ({
  display: "flex",
  flexDirection: readingMode === "vertical" ? "column" : isRtl ? "row-reverse" : "row",
  alignItems: "center",
  justifyContent: readingMode === "vertical" ? "flex-start" : "center",
  width: "100%",
  minHeight: "100%",
});

function isRenderingCancelledError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    (err as { name?: string }).name === "RenderingCancelledException"
  );
}
