import type { MouseEvent, TouchEvent, RefObject } from "react";
import type { ReactZoomPanPinchContentRef } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";

interface VerticalPageProps {
  pageNum: number;
  imageUrl: string;
  maxAllowedPage: number;
  handleImageLoad: (pageNum: number) => void;
  handleContentClick: (
    e: MouseEvent | TouchEvent,
    ref?: RefObject<ReactZoomPanPinchContentRef> | { current: null },
  ) => void;
  styles: { readonly [key: string]: string };
}

export const VerticalPage = ({
  pageNum,
  imageUrl,
  maxAllowedPage,
  handleImageLoad,
  handleContentClick,
  styles,
}: VerticalPageProps) => {
  // No local zoom state needed for vertical mode now
  const shouldRenderImage = pageNum <= maxAllowedPage;

  return (
    <div
      id={`page-${pageNum}`}
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
          className={styles.verticalPageImage}
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
};
