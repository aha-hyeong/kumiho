import { useState, useRef, useImperativeHandle, forwardRef, useEffect } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";
import { VerticalPage } from "../VerticalPage";
import { PageTransition } from "../PageTransition";
import { useViewerZoom } from "../../hooks/useViewerZoom";
import { useSwipe } from "../../hooks/useSwipe";
import { getPageImageUrl } from "../../utils/imageUrl";
import styles from "../../../../pages/Viewer.module.css";
import { type ReadingMode, type ReadingDirection, type PageTransitionType } from "../../../../stores/viewerStore";
import type { ViewerAnimationHandles } from "../../types";

interface ViewerContentProps {
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  swipeDirection?: ReadingDirection;
  clickDirection: ReadingDirection;
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
}

export const ViewerContent = forwardRef<ViewerAnimationHandles, ViewerContentProps>(
  (
    {
      readingMode,
      readingDirection,
      swipeDirection,
      clickDirection,
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
    },
    ref,
  ) => {
    /* Animation Proxy for Click Navigation */
    // We use refs to break the circular dependency:
    // useViewerZoom needs onNext (animated) -> useSwipe needs isZoomed -> useViewerZoom
    const animateNextRef = useRef<(() => void) | null>(null);
    const animatePrevRef = useRef<(() => void) | null>(null);

    const handleAnimatedNext = () => {
      if (animateNextRef.current) animateNextRef.current();
      else onNext();
    };

    const handleAnimatedPrev = () => {
      if (animatePrevRef.current) animatePrevRef.current();
      else onPrev();
    };
    const [verticalZoomScale, setVerticalZoomScale] = useState(1);

    const { transformComponentRef, isZoomed, setIsZoomed, handleContentClick, handleMouseDown, handleMouseMove } =
      useViewerZoom({
        clickDirection,
        onNext: handleAnimatedNext,
        onPrev: handleAnimatedPrev,
        deferSingleTapForDoubleTap: false,
        isVerticalMode: readingMode === "vertical",
        onVerticalZoomToggle: (isZoomingIn: boolean) => {
          const newScale = isZoomingIn ? 2 : 1;
          setVerticalZoomScale(newScale);
        },
      });

    const containerRef = useRef<HTMLDivElement>(null);
    /* Page Gap (Visual separation between pages) */
    const PAGE_GAP = 20;

    const { onTouchStart, onTouchMove, onTouchEnd, swipeOffset, isAnimating, animateNext, animatePrev } = useSwipe({
      onNext,
      onPrev,
      readingDirection,
      swipeDirection,
      isZoomed,
      threshold: 80,
      containerRef,
      gap: PAGE_GAP,
      duration: 300,
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

    // Expose animation methods to parent via Ref
    useImperativeHandle(ref, () => ({
      animateNext,
      animatePrev,
    }));

    const renderPages = (pages: number[]) => {
      if (!pages || pages.length === 0) return null;

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

            return (
              <div
                key={pageNum}
                id={`page-${pageNum}`}
                className={`${styles.pageImageWrapper} ${isSingleWideInDouble ? styles.singleWide : ""}`}
              >
                {shouldRenderImage ? (
                  <SmartImageViewer
                    src={getPageImageUrl(chapterId, pageNum)}
                    nextSrc={nextSrc}
                    alt={`페이지 ${pageNum}`}
                    className={`${styles.pageImage} ${styles[`fit${fitMode.charAt(0).toUpperCase() + fitMode.slice(1)}`]} ${shouldHide ? styles.hidden : ""}`}
                    onLoad={() => handleImageLoad(pageNum)}
                    onError={() => handleImageLoad(pageNum)}
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

    const VERTICAL_MAX_WIDTH = "760px";

    if (readingMode === "vertical") {
      return (
        <div
          style={{
            width: "100%",
            maxWidth: VERTICAL_MAX_WIDTH,
            margin: "0 auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "flex-start",
            transition: "transform 0.3s ease-out",
            transform: `scale(${verticalZoomScale})`,
            transformOrigin: "top center",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
        >
          {displayPages.map((pageNum) => (
            <VerticalPage
              key={pageNum}
              pageNum={pageNum}
              imageUrl={getPageImageUrl(chapterId, pageNum)}
              maxAllowedPage={maxAllowedPage}
              handleImageLoad={handleImageLoad}
              handleContentClick={handleContentClick}
              styles={styles}
              fitMode={fitMode}
            />
          ))}
        </div>
      );
    }

    const effectiveDirection = swipeDirection || readingDirection;

    return (
      <PageTransition
        ref={containerRef}
        className={`${styles.viewerContent} ${styles[readingMode]}`}
        isVertical={false}
        offset={swipeOffset}
        isAnimating={isAnimating}
        readingDirection={effectiveDirection}
        transitionType={transitionType}
        gap={PAGE_GAP}
        duration={300}
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchMove={swipeHandlers.onTouchMove}
        onTouchEnd={swipeHandlers.onTouchEnd}
        style={{ background: "transparent" }}
        prevChildren={renderPages(prevDisplayPages)}
        nextChildren={renderPages(nextDisplayPages)}
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
