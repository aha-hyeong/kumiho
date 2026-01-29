import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { SmartImageViewer } from "../../../../components/SmartImageViewer";
import { VerticalPage } from "../VerticalPage";
import { useViewerZoom } from "../../hooks/useViewerZoom";
import { getPageImageUrl } from "../../utils/imageUrl";
import styles from "../../../../pages/Viewer.module.css";
import { type ReadingMode, type ReadingDirection } from "../../../../stores/viewerStore";

interface ViewerContentProps {
  readingMode: ReadingMode;
  clickDirection: ReadingDirection;
  fitMode: string;
  displayPages: number[];
  chapterId: string;
  totalPages: number;
  maxAllowedPage: number;
  imageLoading: Record<number, boolean>;
  handleImageLoad: (pageNum: number) => void;
  onNext: () => void;
  onPrev: () => void;
}

export const ViewerContent = ({
  readingMode,
  clickDirection,
  fitMode,
  displayPages,
  chapterId,
  totalPages,
  maxAllowedPage,
  imageLoading,
  handleImageLoad,
  onNext,
  onPrev,
}: ViewerContentProps) => {
  const { transformComponentRef, isZoomed, setIsZoomed, handleContentClick } = useViewerZoom({
    clickDirection,
    onNext,
    onPrev,
  });

  if (readingMode === "vertical") {
    return (
      <div
        style={{
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "flex-start",
        }}
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
          />
        ))}
      </div>
    );
  }

  return (
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
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={(e) => handleContentClick(e)}
        >
          {displayPages.map((pageNum) => {
            const isDoubleMode = readingMode === "double";
            const allLoaded = displayPages.every((p) => imageLoading[p] === false);
            const shouldHide = isDoubleMode && !allLoaded;
            const nextSrc = pageNum < totalPages ? getPageImageUrl(chapterId, pageNum + 1) : undefined;
            const isSingleWideInDouble = isDoubleMode && displayPages.length === 1;
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
      </TransformComponent>
    </TransformWrapper>
  );
};
