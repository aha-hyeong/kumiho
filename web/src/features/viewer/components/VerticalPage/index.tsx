import { useEffect, useRef, useState, type MouseEvent, type TouchEvent, type RefObject } from "react";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";

interface VerticalPageProps {
  pageNum: number;
  imageUrl: string;
  pageHeightCache: Map<number, number>;
  minAllowedPage: number;
  maxAllowedPage: number;
  handleImageLoad: (pageNum: number) => void;
  handleContentClick: (
    e: MouseEvent | TouchEvent,
    ref?: RefObject<ReactZoomPanPinchContentRef> | { current: null },
  ) => void;
  styles: { readonly [key: string]: string };
  fitMode: string;
}

export const VerticalPage = ({
  pageNum,
  imageUrl,
  pageHeightCache,
  minAllowedPage,
  maxAllowedPage,
  handleImageLoad,
  handleContentClick,
  styles,
  fitMode,
}: VerticalPageProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cachedHeight, setCachedHeight] = useState<number>(() => pageHeightCache.get(pageNum) ?? 0);
  const shouldRenderImage = pageNum >= minAllowedPage && pageNum <= maxAllowedPage;
  const placeholderHeight = cachedHeight > 0 ? cachedHeight : 300;

  useEffect(() => {
    if (!shouldRenderImage) return;

    const el = wrapperRef.current;
    if (!el || !("ResizeObserver" in window)) return;

    const observer = new ResizeObserver((entries) => {
      const nextHeight = entries[0]?.contentRect.height ?? 0;
      if (nextHeight > 0) {
        setCachedHeight((prev) => {
          if (Math.abs(prev - nextHeight) <= 1) return prev;
          pageHeightCache.set(pageNum, nextHeight);
          return nextHeight;
        });
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [pageHeightCache, pageNum, shouldRenderImage]);

  return (
    <div
      id={`page-${pageNum}`}
      ref={wrapperRef}
      className={styles.pageImageWrapper}
      onClick={(e) => handleContentClick(e, { current: null })} // Pass null ref
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-start",
        margin: 0,
        padding: 0,
        lineHeight: 0,
        backgroundColor: "#000",
      }}
    >
      {shouldRenderImage ? (
        <SmartImageViewer
          src={imageUrl}
          alt={`페이지 ${pageNum}`}
          className={`${styles.verticalPageImage} ${styles[`fit${fitMode.charAt(0).toUpperCase() + fitMode.slice(1)}`]}`}
          onLoad={() => handleImageLoad(pageNum)}
          onError={() => handleImageLoad(pageNum)}
        />
      ) : (
        <div
          className={styles.pageLoadingPlaceholder}
          style={{
            minHeight: `${placeholderHeight}px`,
            height: `${placeholderHeight}px`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
};
