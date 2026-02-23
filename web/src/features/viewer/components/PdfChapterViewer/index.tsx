import React, { useEffect, useRef, useState, useCallback } from "react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
import { LoadingSpinner } from "../../../../components/common/LoadingSpinner";
import {
  type ReadingMode,
  type ReadingDirection,
  type PageTransitionType,
  useViewerStore,
} from "../../../../stores/viewerStore";
import { PageTransition } from "../PageTransition";
import { useSwipe } from "../../hooks/useSwipe";
import styles from "./index.module.css";

export interface PDFOutlineItem {
  title: string;
  pageNumber?: number;
  items: PDFOutlineItem[];
}

const resolveOutline = async (pdfDoc: pdfjsLib.PDFDocumentProxy, outline: any[]): Promise<PDFOutlineItem[]> => {
  const result: PDFOutlineItem[] = [];
  for (const item of outline) {
    let pageNumber: number | undefined;
    try {
      let dest = item.dest;
      if (typeof dest === "string") {
        dest = await pdfDoc.getDestination(dest);
      }
      if (Array.isArray(dest) && dest.length > 0) {
        const ref = dest[0];
        const pageIndex = await pdfDoc.getPageIndex(ref);
        pageNumber = pageIndex + 1;
      }
    } catch (e) {
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
}

export const PdfChapterViewer: React.FC<PdfChapterViewerProps> = ({
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
}) => {
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [loadedChapterId, setLoadedChapterId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());
  const renderTasksRef = useRef<Map<number, pdfjsLib.RenderTask>>(new Map());
  const loading = chapterId ? loadedChapterId !== chapterId : false;
  const activePdfDoc = chapterId && loadedChapterId === chapterId ? pdfDoc : null;

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
        style={{
          flexShrink: 0,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <canvas
          ref={(el) => {
            if (el) canvasesRef.current.set(pageNum, el);
            else canvasesRef.current.delete(pageNum);
          }}
        />
      </div>
    ));

  // 페이지 렌더링 함수
  const renderPage = useCallback(
    async (pageNum: number, canvas: HTMLCanvasElement) => {
      if (!activePdfDoc) return;

      try {
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

        const outputScale = window.devicePixelRatio || 1;
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
        }
      } catch (err: unknown) {
        if (!isRenderingCancelledError(err)) {
          console.error(`Page ${pageNum} render error:`, err);
        }
      }
    },
    [activePdfDoc, fitMode, readingMode, displayPages.length],
  );

  // 현재 페이지(들) 렌더링
  useEffect(() => {
    if (!activePdfDoc || loading) return;

    displayPages.forEach((pageNum) => {
      const canvas = canvasesRef.current.get(pageNum);
      if (canvas) renderPage(pageNum, canvas);
    });
  }, [activePdfDoc, loading, currentPage, fitMode, readingMode, displayPages, renderPage]);

  // 창 크기 조절 대응
  useEffect(() => {
    const handleResize = () => {
      displayPages.forEach((pageNum) => {
        const canvas = canvasesRef.current.get(pageNum);
        if (canvas) renderPage(pageNum, canvas);
      });
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [displayPages, renderPage]);

  // Swipe Hook
  const { onTouchStart, onTouchMove, onTouchEnd, swipeOffset, isAnimating } = useSwipe({
    onNext: () => onNext(readingMode === "double" ? 2 : 1),
    onPrev: () => onPrev(readingMode === "double" ? 2 : 1),
    readingDirection,
    isZoomed: false,
    containerRef,
    gap: 20,
    duration: 300,
  });

  // 이전/다음 페이지 미리 렌더링
  useEffect(() => {
    if (!activePdfDoc || loading) return;
    [...prevDisplayPages, ...nextDisplayPages].forEach((pageNum) => {
      const canvas = canvasesRef.current.get(pageNum);
      if (canvas) renderPage(pageNum, canvas);
    });
  }, [activePdfDoc, loading, prevDisplayPages, nextDisplayPages, renderPage]);

  const handleContainerClick = (e: React.MouseEvent) => {
    const x = e.clientX;
    const width = window.innerWidth;
    const clickDirection = useViewerStore.getState().settings.clickDirection;
    const isRtl = clickDirection === "rtl";

    let delta = 1;
    if (readingMode === "double" && displayPages.length === 2) {
      delta = 2;
    }

    if (x < width * 0.3) {
      if (isRtl) onNext(delta);
      else onPrev(delta);
    } else if (x > width * 0.7) {
      if (isRtl) onPrev(delta);
      else onNext(delta);
    } else {
      useViewerStore.getState().toggleUI();
    }
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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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
        className={styles.canvasContainer}
        style={getCanvasContainerStyle(readingMode, isRTL)}
        onClick={handleContainerClick}
      >
        {renderPages(displayPages)}
      </div>
    </PageTransition>
  );
};

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
