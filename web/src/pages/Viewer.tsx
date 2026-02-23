import { useParams } from "react-router-dom";
import { useChapterLoader } from "../features/viewer";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });

  if (loaderData.isLoading || !loaderData.chapter) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          height: "100vh",
          backgroundColor: "#000",
        }}
      >
        {loaderData.isLoading ? (
          <LoadingSpinner
            fullScreen
            text={undefined}
          />
        ) : null}
      </div>
    );
  }

  if (loaderData.error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "white" }}>
        <div>Failed to load chapter: {loaderData.error}</div>
      </div>
    );
  }

  const isPdf = loaderData.chapter?.path?.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return <PdfViewerRoute loaderData={loaderData} />;
  }

  return <ImageViewerRoute loaderData={loaderData} />;
}
