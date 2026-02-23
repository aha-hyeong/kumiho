import React, { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { LoadingSpinner } from "../../../../components/common/LoadingSpinner";
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
  items: PDFOutlineItem[];
}

interface PDFJSOutline {
  title: string;
  dest?: string | unknown[] | null;
  items?: PDFJSOutline[] | null;
}

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
    result.push({ title: item.title, pageNumber, items: children });
  }
  return result;
};

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

const ZOOM_RERENDER_DEBOUNCE_MS = 150;
const ZOOM_RERENDER_SCALE_DELTA = 0.05;
const MAX_ZOOM_SCALE = 2.5;
const HEADER_ZOOM_STEP = 0.1;

interface PdfChapterViewerProps {
  chapterId: string | undefined;
  currentPage: number;
  fitMode: string;
  readingMode?: ReadingMode;
  readingDirection?: ReadingDirection;
  pageOffset?: number;
  onDocumentLoad: (numPages: number) => void;
  onNext: (delta?: number | React.MouseEvent) => void;
  onPrev: (delta?: number | React.MouseEvent) => void;
  onOutlineLoad?: (outline: PDFOutlineItem[]) => void;
  transitionType: PageTransitionType;
  onZoomChange?: (scale: number) => void;
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
      onDocumentLoad,
      onNext,
      onPrev,
      onOutlineLoad,
      transitionType,
      onZoomChange,
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
    const loading = chapterId ? loadedChapterId !== chapterId : false;
    const activePdfDoc = chapterId && loadedChapterId === chapterId ? pdfDoc : null;

    // Zoom and Navigation handlers
    const animateNextRef = useRef<(() => void) | null>(null);
    const animatePrevRef = useRef<(() => void) | null>(null);

    const handleAnimatedNext = () => {
      if (animateNextRef.current) animateNextRef.current();
      else onNext(readingMode === "double" ? 2 : 1);
    };

    const handleAnimatedPrev = () => {
      if (animatePrevRef.current) animatePrevRef.current();
      else onPrev(readingMode === "double" ? 2 : 1);
    };

    const clickDirection = useViewerStore.getState().settings.clickDirection;
    const { transformComponentRef, isZoomed, setIsZoomed, handleContentClick, handleMouseDown, handleMouseMove } =
      useViewerZoom({
        clickDirection,
        onNext: handleAnimatedNext,
        onPrev: handleAnimatedPrev,
      });

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

      if (!chapterId) {
        onDocumentLoad(0);
        return;
      }

      const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";
      const url = `${API_BASE_URL}/chapters/${chapterId}/pdf`;

      const loadingTask = pdfjsLib.getDocument({ url, withCredentials: true });

      loadingTask.promise
        .then((pdf) => {
          if (!isMounted) return;
          setPdfDoc(pdf);
          setLoadedChapterId(chapterId);
          onDocumentLoad(pdf.numPages);
          pdf
            .getOutline()
            .then(async (outline) => {
              if (isMounted && onOutlineLoad && outline) {
                const resolved = await resolveOutline(pdf, outline);
                if (isMounted) onOutlineLoad(resolved);
              }
            })
            .catch((err) => console.error("PDF outline load error:", err));
        })
        .catch((err) => {
          console.error("PDF load error:", err);
          if (isMounted) setLoadedChapterId(chapterId);
          onDocumentLoad(0);
        });

      return () => {
        isMounted = false;
        loadingTask.destroy();
        renderTasks.forEach((task) => task.cancel());
        renderTasks.clear();
      };
    }, [chapterId, onDocumentLoad, onOutlineLoad]);

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
            onMouseDown={() => {
              // Removed stopPropagation to allow drag tracking at container level
            }}
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
          // 기존 렌더링 작업 취소
          const existingTask = renderTasksRef.current.get(pageNum);
          if (existingTask) {
            existingTask.cancel();
          }

          const page = await activePdfDoc.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1 });

          const containerWidth = containerRef.current?.clientWidth || window.innerWidth;
          const containerHeight = containerRef.current?.clientHeight || window.innerHeight;

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
          } else {
            targetScale = 1.0;
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
              textLayerContainer.style.width = canvas.style.width;
              textLayerContainer.style.height = canvas.style.height;

              // 텍스트 레이어는 디바이스 픽셀 비율이 아닌 출력(디스플레이) 스케일을 사용해야 함
              const textViewport = page.getViewport({ scale: targetScale });
              const textContentSource = await page.getTextContent();

              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const textLayer = new (pdfjsLib as any).TextLayer({
                textContentSource,
                container: textLayerContainer,
                viewport: textViewport,
                enhanceTextSelection: true, // Improve text selection behavior
              });
              await textLayer.render();
            }
          }
        } catch (err: unknown) {
          if (!isRenderingCancelledError(err)) {
            console.error(`Page ${pageNum} render error:`, err);
          }
        }
      },
      [activePdfDoc, fitMode, readingMode, displayPages.length],
    );

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
        },
        { threshold: 0.1, rootMargin: "50% 0px" },
      );

      observerRef.current = observer;
      return () => {
        observer.disconnect();
        observerRef.current = null;
      };
    }, [readingMode]);

    // 실제 렌더링에 사용할 가시 페이지 계산
    const activeVisiblePages = useMemo<Set<number>>(
      () => (readingMode === "vertical" ? visiblePages : new Set(displayPages)),
      [readingMode, visiblePages, displayPages],
    );

    // 현재 페이지(들) 렌더링
    useEffect(() => {
      if (!activePdfDoc || loading) return;

      const pagesToRender = readingMode === "vertical" ? Array.from(activeVisiblePages) : displayPages;

      pagesToRender.forEach((pageNum) => {
        const canvas = canvasesRef.current.get(pageNum);
        const textLayer = textLayersRef.current.get(pageNum);
        if (canvas) renderPage(pageNum, canvas, textLayer || null, lastZoomRerenderScaleRef.current);
      });
    }, [activePdfDoc, loading, currentPage, fitMode, readingMode, displayPages, activeVisiblePages, renderPage]);

    // 창 크기 조절 대응
    useEffect(() => {
      const handleResize = () => {
        const pagesToRender = readingMode === "vertical" ? Array.from(activeVisiblePages) : displayPages;
        pagesToRender.forEach((pageNum) => {
          const canvas = canvasesRef.current.get(pageNum);
          const textLayer = textLayersRef.current.get(pageNum);
          if (canvas) renderPage(pageNum, canvas, textLayer || null, lastZoomRerenderScaleRef.current);
        });
      };

      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }, [displayPages, activeVisiblePages, renderPage, readingMode]);

    // Swipe Hook
    const { onTouchStart, onTouchMove, onTouchEnd, swipeOffset, isAnimating, animateNext, animatePrev } = useSwipe({
      onNext: () => onNext(readingMode === "double" ? 2 : 1),
      onPrev: () => onPrev(readingMode === "double" ? 2 : 1),
      readingDirection,
      isZoomed,
      containerRef,
      gap: 20,
      duration: 300,
    });

    // Keep refs in sync with useSwipe's animation functions
    useEffect(() => {
      animateNextRef.current = animateNext;
      animatePrevRef.current = animatePrev;
    }, [animateNext, animatePrev]);

    useImperativeHandle(ref, () => ({
      animateNext,
      animatePrev,
      zoomIn: () => {
        const currentScale = transformComponentRef.current?.instance.transformState.scale ?? 1;
        const targetScale = Math.min(MAX_ZOOM_SCALE, currentScale + HEADER_ZOOM_STEP);
        const step = Math.max(0, Math.log(targetScale / currentScale));
        transformComponentRef.current?.zoomIn(step, 0);
        onZoomChange?.(targetScale);
      },
      zoomOut: () => {
        const currentScale = transformComponentRef.current?.instance.transformState.scale ?? 1;
        const targetScale = Math.max(1, currentScale - HEADER_ZOOM_STEP);
        const step = Math.max(0, Math.log(currentScale / targetScale));
        transformComponentRef.current?.zoomOut(step, 0);
        onZoomChange?.(targetScale);
      },
      resetZoom: () => {
        transformComponentRef.current?.resetTransform(0);
        onZoomChange?.(1);
      },
      getZoomScale: () => transformComponentRef.current?.instance.transformState.scale ?? 1,
    }));

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

    if (loading) {
      return (
        <LoadingSpinner
          fullScreen={false}
          text="Loading PDF..."
        />
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
            style={getCanvasContainerStyle(readingMode, isRTL)}
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
          onClick={handleInternalClick}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          <TransformWrapper
            ref={transformComponentRef}
            initialScale={1}
            minScale={1}
            maxScale={MAX_ZOOM_SCALE}
            wheel={{ disabled: false, activationKeys: ["Control"] }}
            doubleClick={{ disabled: true }}
            panning={{ disabled: !isZoomed, excluded: ["span"] }}
            onTransformed={(_, state) => {
              setIsZoomed(state.scale > 1.01);
              handleZoomStop(state.scale);
              onZoomChange?.(state.scale);
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
