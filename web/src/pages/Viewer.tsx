import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useChapterLoader } from "../features/viewer";
import { useAudioPlayerStore } from "../stores/audioPlayerStore";
import { useViewerStore } from "../stores/viewerStore";
import { useEpubViewerStore } from "../stores/epubViewerStore";
import { ImageViewerRoute } from "./ImageViewerRoute";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { LoadingSpinner } from "../components/common/LoadingSpinner";
import type { Chapter } from "../types/series";
import styles from "./Viewer.module.css";

export function ViewerPage() {
  const { chapterId } = useParams<{ chapterId: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const audioRedirectDone = useRef(false);
  const setViewerIncognito = useViewerStore((state) => state.setIncognito);
  const setEpubIncognito = useEpubViewerStore((state) => state.setIncognito);

  // Fetch minimal data to route
  const loaderData = useChapterLoader({ chapterId });
  const routeIsIncognito = location.state?.isIncognito === true;

  const isAudio = loaderData.chapter?.render_mode === "audio";
  const contentScopeRef = useRef<HTMLDivElement>(null);
  const entryPlayedRef = useRef(false);
  const [paintedPdfChapterId, setPaintedPdfChapterId] = useState<string | null>(null);
  // Keep loading until the renderer has restored and displayed the reading position.
  const showLoading =
    loaderData.isLoading ||
    !loaderData.chapter ||
    (loaderData.viewStatus !== undefined && loaderData.viewStatus !== "ready");
  const needsPdfPaint = loaderData.chapter?.path?.toLowerCase().endsWith(".pdf") && loaderData.chapter.render_mode !== "image";
  const isEntryReady = !showLoading && (!needsPdfPaint || paintedPdfChapterId === loaderData.chapter?.id);

  useLayoutEffect(() => {
    if (entryPlayedRef.current || !isEntryReady || isAudio || loaderData.error) return;
    const content = contentScopeRef.current?.querySelector<HTMLElement>("[data-viewer-content]");
    if (!content) return;
    entryPlayedRef.current = true;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = content.animate(
      [{ opacity: 0.45 }, { opacity: 1 }],
      { duration: 180, easing: "ease-out", id: "viewer-entry" },
    );
    return () => animation.cancel();
  }, [isEntryReady, isAudio, loaderData.error]);

  useLayoutEffect(() => () => {
    // A new visit (including StrictMode's mount rehearsal) may enter again.
    entryPlayedRef.current = false;
  }, []);

  useLayoutEffect(() => {
    if (!routeIsIncognito) {
      setViewerIncognito(false);
      setEpubIncognito(false);
      return;
    }

    if (!loaderData.chapter) {
      setViewerIncognito(true);
      setEpubIncognito(true);
      return;
    }

    const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
    if (chapterPath.endsWith(".epub") || chapterPath.endsWith(".txt")) {
      setViewerIncognito(false);
      setEpubIncognito(true);
      return;
    }

    setViewerIncognito(true);
    setEpubIncognito(false);
  }, [loaderData.chapter, routeIsIncognito, setEpubIncognito, setViewerIncognito]);

  useEffect(() => {
    audioRedirectDone.current = false;
  }, [loaderData.chapter?.id]);

  // Audio redirect: fetch series/chapters, open audio player, navigate back
  useEffect(() => {
    if (!isAudio || !loaderData.chapter || !loaderData.seriesId || audioRedirectDone.current) return;
    audioRedirectDone.current = true;
    let cancelled = false;

    const chapter = loaderData.chapter;
    const seriesId = loaderData.seriesId;
    const volumeId = loaderData.volumeId;

    void (async () => {
      try {
        const store = useAudioPlayerStore.getState();
        const result = await store.bootstrapAndPlay({
          source: "viewer",
          seriesId,
          volumeId: volumeId ?? undefined,
          preferredChapterId: chapter.id,
          chapter: chapter as Chapter,
        });
        if (cancelled) return;
        if (!result.ok) {
          throw new Error(result.reason ?? "bootstrap_failed");
        }
        if (window.history.length > 1) {
          navigate(-1);
        } else if (volumeId) {
          navigate(`/volumes/${volumeId}`, { replace: true });
        } else {
          navigate(`/series/${seriesId}`, { replace: true });
        }
      } catch (err) {
        console.error("Failed to load audio player data:", err);
        if (cancelled) return;
        if (volumeId) {
          navigate(`/volumes/${volumeId}`, { replace: true });
        } else {
          navigate(`/series/${seriesId}`, { replace: true });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isAudio, loaderData.chapter, loaderData.seriesId, loaderData.volumeId, navigate]);

  if (isAudio) {
    return (
      <LoadingSpinner
        fullScreen
        text={undefined}
      />
    );
  }

  if (loaderData.error) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", color: "white" }}>
        <div>{t("viewer.error.load_failed", { error: loaderData.error })}</div>
      </div>
    );
  }
  if (!loaderData.chapter) {
    return showLoading ? (
      <LoadingSpinner
        fullScreen
        text={undefined}
      />
    ) : null;
  }

  const chapterPath = loaderData.chapter.path?.toLowerCase() ?? "";
  const isPdf = chapterPath.endsWith(".pdf");
  const isEpub = chapterPath.endsWith(".epub");
  const isText = chapterPath.endsWith(".txt");
  const shouldUseImageRouteForPdf = isPdf && loaderData.chapter.render_mode === "image";

  const route = isEpub || isText ? (
    <EpubViewerRoute loaderData={loaderData} />
  ) : isPdf && !shouldUseImageRouteForPdf ? (
    <PdfViewerRoute key={loaderData.chapter.id} loaderData={loaderData} onContentReady={setPaintedPdfChapterId} />
  ) : (
    <ImageViewerRoute loaderData={loaderData} />
  );

  return (
    <>
      {showLoading && (
        <LoadingSpinner
          fullScreen
          text={undefined}
          className={styles.viewerLoadingOverlay}
        />
      )}
      <div ref={contentScopeRef} style={{ display: "contents" }}>{route}</div>
    </>
  );
}
