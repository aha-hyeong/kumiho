import { useState, useRef, useImperativeHandle, forwardRef, useEffect, useCallback } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";
import { VerticalPage } from "../VerticalPage";
import { PageTransition } from "../PageTransition";
import { useViewerZoom } from "../../hooks/useViewerZoom";
import { useSwipe } from "../../hooks/useSwipe";
import { getPageImageUrl } from "../../utils/imageUrl";
import styles from "../../../../pages/Viewer.module.css";
import {
  type ReadingMode,
  type ReadingDirection,
  type PageTransitionType,
  type SubPage,
} from "../../../../stores/viewerStore";
import { VERTICAL_MAX_WIDTH } from "../../utils/constants";
import type { PageMeta, ViewStatus, ViewerAnimationHandles } from "../../types";

interface ViewerContentProps {
  currentPage?: number;
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  swipeDirection?: ReadingDirection;
  clickDirection: ReadingDirection;
  wheelDirection: "down" | "up";
  fitMode: string;
  displayPages: number[];
  prevDisplayPages?: number[];
  nextDisplayPages?: number[];
  chapterId: string;
  totalPages: number;
  maxAllowedPage: number;
  imageLoading: Record<number, boolean>;
  handleImageLoad: (pageNum: number) => void;
  onNext: () => void;
  onPrev: () => void;
  onPageChange?: (page: number) => void;
  transitionType: PageTransitionType;
  subPage?: SubPage;
  nextPreviewSubPage?: SubPage;
  prevPreviewSubPage?: SubPage;
  pageMetaMap?: Map<number, PageMeta>;
  isInitialScrolling?: boolean; // Boolean으로 회복
  estimatedPageHeights?: Map<number, number>;
  viewStatus?: ViewStatus;
  /** 마지막 페이지에서 다음 챕터 이동 가능 여부 (다음 슬라이드 애니메이션 억제용) */
  canGoNextChapter?: boolean;
  /** 첫 페이지에서 이전 챕터 이동 가능 여부 (이전 슬라이드 애니메이션 억제용) */
  canGoPrevChapter?: boolean;
}

export const ViewerContent = forwardRef<ViewerAnimationHandles, ViewerContentProps>(
  (
    {
      currentPage = 1,
      readingMode,
      readingDirection,
      swipeDirection,
      clickDirection,
      wheelDirection,
      fitMode,
      displayPages,
      prevDisplayPages = [],
      nextDisplayPages = [],
      chapterId,
      totalPages,
      maxAllowedPage,
      imageLoading,
      handleImageLoad,
      onNext,
      onPrev,
      transitionType,
      subPage,
      nextPreviewSubPage,
      prevPreviewSubPage,
      pageMetaMap,
      isInitialScrolling = false,
      estimatedPageHeights,
      viewStatus = "ready",
      canGoNextChapter = false,
      canGoPrevChapter = false,
    },
    ref,
  ) => {
    /* Animation Proxy for Click Navigation */
    // We use refs to break the circular dependency:
    // useViewerZoom needs onNext (animated) -> useSwipe needs isZoomed -> useViewerZoom
    const animateNextRef = useRef<(() => void) | null>(null);
    const animatePrevRef = useRef<(() => void) | null>(null);

    const handleAnimatedNext = useCallback(() => {
      if (canGoNextChapter) {
        onNext();
      } else if (animateNextRef.current) {
        animateNextRef.current();
      } else {
        onNext();
      }
    }, [canGoNextChapter, onNext]);

    const handleAnimatedPrev = useCallback(() => {
      if (canGoPrevChapter) {
        onPrev();
      } else if (animatePrevRef.current) {
        animatePrevRef.current();
      } else {
        onPrev();
      }
    }, [canGoPrevChapter, onPrev]);
    const { transformComponentRef, isZoomed, setIsZoomed, handleContentClick, handleMouseDown, handleMouseMove } =
      useViewerZoom({
        clickDirection,
        onNext: handleAnimatedNext,
        onPrev: handleAnimatedPrev,
        doubleTapZoomZone: "center",
        deferSingleTapForDoubleTap: false,
      });

    const containerRef = useRef<HTMLDivElement>(null);
    const lastWheelNavAtRef = useRef(0);
    const [verticalPageHeightCache] = useState<Map<number, number>>(() => new Map<number, number>());
    /* Page Gap (Visual separation between pages) */
    const PAGE_GAP = 20;

    const { onTouchStart, onTouchMove, onTouchEnd, swipeOffset, isAnimating, animateNext, animatePrev } = useSwipe({
      onNext,
      onPrev,
      readingDirection,
      swipeDirection,
      isZoomed,
      threshold: 40,
      containerRef,
      gap: PAGE_GAP,
      duration: 300,
      skipNextAnimation: canGoNextChapter,
      skipPrevAnimation: canGoPrevChapter,
    });

    // Vertical 모드일 때는 이벤트 핸들러를 null로 처리하여 스와이프 방지
    const swipeHandlers =
      readingMode === "vertical"
        ? {}
        : {
            onTouchStart: onTouchStart,
            onTouchMove: onTouchMove,
            onTouchEnd: onTouchEnd,
          };

    // Keep refs in sync with useSwipe's animation functions
    useEffect(() => {
      animateNextRef.current = animateNext;
      animatePrevRef.current = animatePrev;
    }, [animateNext, animatePrev]);

    useEffect(() => {
      verticalPageHeightCache.clear();
    }, [chapterId, verticalPageHeightCache]);

    // Expose animation methods to parent via Ref
    useImperativeHandle(ref, () => ({
      animateNext,
      animatePrev,
    }));

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

    const renderPages = (pages: number[], renderSubPage?: SubPage) => {
      if (!pages || pages.length === 0) return null;

      // 명시적으로 전달된 subPage가 있으면 사용, 없으면 현재 subPage 사용
      const effectiveSubPage = renderSubPage !== undefined ? renderSubPage : subPage;

      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: readingDirection === "rtl" ? "row-reverse" : "row",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {pages.map((pageNum) => {
            const isDoubleMode = readingMode === "double";
            const allLoaded = pages.every((p) => imageLoading[p] === false);
            const shouldHide = isDoubleMode && !allLoaded;
            const nextSrc = pageNum < totalPages ? getPageImageUrl(chapterId, pageNum + 1) : undefined;
            const isSingleWideInDouble = isDoubleMode && pages.length === 1;
            const shouldRenderImage = pageNum <= maxAllowedPage;

            // 스프레드 분할: single 모드 + wide 이미지 + subPage 활성화
            const isSplit = readingMode === "single" && effectiveSubPage && pageMetaMap?.get(pageNum)?.isWide;
            const splitClass = isSplit ? (effectiveSubPage === "left" ? styles.splitLeft : styles.splitRight) : "";

            return (
              <div
                key={pageNum}
                id={`page-${pageNum}`}
                className={`${styles.pageImageWrapper} ${isSingleWideInDouble ? styles.singleWide : ""} ${splitClass}`}
              >
                {shouldRenderImage ? (
                  <SmartImageViewer
                    src={getPageImageUrl(chapterId, pageNum)}
                    nextSrc={nextSrc}
                    alt={`페이지 ${pageNum}`}
                    className={`${styles.pageImage} ${styles[`fit${fitMode.charAt(0).toUpperCase() + fitMode.slice(1)}`]} ${shouldHide ? styles.hidden : ""}`}
                    onVisualReady={() => handleImageLoad(pageNum)}
                  />
                ) : (
                  <div
                    className={styles.pageLoadingPlaceholder}
                    style={{ minHeight: "300px", display: "flex", alignItems: "center", justifyContent: "center" }}
                  >
                    <div className={styles.spinner} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    };

    if (readingMode === "vertical") {
      const minRenderPage = Math.max(1, currentPage - 3);

      return (
        <div
          style={{
            width: "100%",
            maxWidth: `${VERTICAL_MAX_WIDTH}px`,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            gap: 0,
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          {displayPages.map((pageNum) => (
            <VerticalPage
              key={`${chapterId}-${pageNum}`}
              pageNum={pageNum}
              imageUrl={getPageImageUrl(chapterId, pageNum)}
              pageHeightCache={verticalPageHeightCache}
              maxAllowedPage={maxAllowedPage}
              minAllowedPage={minRenderPage}
              isInitialScrolling={isInitialScrolling} // Boolean 전달
              estimatedHeight={estimatedPageHeights?.get(pageNum)}
              viewStatus={viewStatus}
              handleImageLoad={handleImageLoad}
              handleContentClick={handleContentClick}
              styles={styles}
              fitMode={fitMode}
            />
          ))}
        </div>
      );
    }

    return (
      <PageTransition
        ref={containerRef}
        className={`${styles.viewerContent} ${styles[readingMode]}`}
        isVertical={false}
        offset={swipeOffset}
        isAnimating={isAnimating}
        readingDirection={readingDirection}
        transitionType={transitionType}
        gap={PAGE_GAP}
        duration={300}
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchMove={swipeHandlers.onTouchMove}
        onTouchEnd={swipeHandlers.onTouchEnd}
        onWheel={handleWheelNavigation}
        style={{ background: "transparent" }}
        prevChildren={renderPages(prevDisplayPages, prevPreviewSubPage)}
        nextChildren={renderPages(nextDisplayPages, nextPreviewSubPage)}
      >
        {/* Current Pages (With Zoom) */}
        <div style={{ width: "100%", height: "100%", flexShrink: 0 }}>
          <TransformWrapper
            ref={transformComponentRef}
            initialScale={1}
            minScale={1}
            maxScale={3}
            wheel={{ disabled: false, activationKeys: ["Control"] }}
            doubleClick={{ disabled: true }}
            panning={{ disabled: !isZoomed }}
            onTransformed={(r) => setIsZoomed(r.state.scale > 1.01)}
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
                style={{ width: "100%", height: "100%" }}
                onClick={(e) => handleContentClick(e)}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
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
