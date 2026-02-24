import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChapterLoader } from "../features/viewer";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });

  if (loaderData.error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "white" }}>
        <div>{t("viewer.error.load_failed", { error: loaderData.error })}</div>
      </div>
    );
  }

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

  const isPdf = loaderData.chapter?.path?.toLowerCase().endsWith(".pdf");

  if (isPdf) {
    return <PdfViewerRoute loaderData={loaderData} />;
  }

  return <ImageViewerRoute loaderData={loaderData} />;
}
