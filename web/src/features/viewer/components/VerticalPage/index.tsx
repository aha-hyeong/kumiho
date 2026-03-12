import { useEffect, useRef, useState, type MouseEvent, type TouchEvent, type RefObject } from "react";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";

interface VerticalPageProps {
  pageNum: number;
  imageUrl: string;
  pageHeightCache: Map<number, number>;
  minAllowedPage: number;
  maxAllowedPage: number;
  isInitialScrolling?: boolean; // Boolean으로 회복
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
  isInitialScrolling = false,
  handleImageLoad,
  handleContentClick,
  styles,
  fitMode,
}: VerticalPageProps) => {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [cachedHeight, setCachedHeight] = useState<number>(() => pageHeightCache.get(pageNum) ?? 0);

  // 초기 스크롤/점프 시 번쩍임을 방지하기 위해, 현재 페이지 이후의 페이지는 레이아웃이 잡히기 전까지 렌더링하지 않는다.
  const shouldRenderImage = isInitialScrolling
    ? pageNum <= maxAllowedPage // 가드 중에는 이미 확인된 페이지만 렌더링 (사용자 로직 복원하되 0px 높이 가드 유지)
    : pageNum >= minAllowedPage && pageNum <= maxAllowedPage;

  // 가드 중이면서 현재 페이지 이후인 경우, 플레이스홀더 높이를 0으로 하여 시각적 노이즈 제거
  const isAfterCurrentDuringGuard = isInitialScrolling && pageNum > maxAllowedPage;

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

  const placeholderHeight = cachedHeight > 0 ? cachedHeight : 300;

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
            minHeight: isAfterCurrentDuringGuard ? "0" : `${placeholderHeight}px`,
            height: isAfterCurrentDuringGuard ? "0" : `${placeholderHeight}px`,
            display: isAfterCurrentDuringGuard ? "none" : "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          <div className={styles.spinner} />
        </div>
      )}
    </div>
  );
};
