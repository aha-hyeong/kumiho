import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { PdfViewerRoute } from "./PdfViewerRoute";
import { useViewerStore } from "../stores/viewerStore";
import { takeReturnFocus } from "../utils/returnFocus";

const useProgressSyncMock = vi.fn();
const useViewerSyncMock = vi.fn();
const useProgressMock = vi.fn();
const useAdjacentChaptersMock = vi.fn();
let latePaint: ((page: number) => void) | undefined;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: ({
    isOpen,
    onConfirm,
  }: {
    isOpen: boolean;
    onConfirm: () => void;
  }) => (isOpen ? <button type="button" data-testid="terminated-confirm" onClick={onConfirm} /> : null),
}));

vi.mock("./PdfViewer", () => ({
  PdfViewer: ({
    currentPage,
    onDocumentLoad,
    onPageChange,
    onPageRendered,
    onDocumentError,
    onPageRenderError,
    terminatedInfo,
    onConfirmTerminated,
    settings,
  }: {
    currentPage: number;
    onDocumentLoad: (pages: number) => void;
    onPageChange: (page: number) => void;
    onPageRendered?: (page: number) => void;
    onDocumentError?: (error: unknown) => void;
    onPageRenderError?: (page: number, error: unknown) => void;
    terminatedInfo: { isOpen: boolean };
    onConfirmTerminated: () => void;
    settings: { swipeDirection?: string; readingDirection: string };
  }) => {
    latePaint = onPageRendered;
    return (
    <div>
      <output data-testid="pdf-swipe">{settings.swipeDirection || "missing"}</output>
      <output data-testid="pdf-reading">{settings.readingDirection}</output>
      <button onClick={() => onPageRendered?.(1)}>paint first page</button>
      <button onClick={() => onPageRendered?.(7)}>paint restored page</button>
      <button onClick={() => onDocumentLoad(3)}>load shorter PDF</button>
      <button onClick={() => onPageRendered?.(currentPage)}>paint active page</button>
      <button onClick={() => onDocumentError?.(new Error("internal diagnostic detail"))}>document error</button>
      <button onClick={() => onPageRenderError?.(7, new Error("internal diagnostic detail"))}>page error</button>
      <button
        type="button"
        data-testid="pdf-load"
        onClick={() => onDocumentLoad(20)}
      />
      <button
        type="button"
        data-testid="pdf-page-1"
        onClick={() => onPageChange(1)}
      />
      <button
        type="button"
        data-testid="pdf-page-7"
        onClick={() => onPageChange(7)}
      />
      {terminatedInfo.isOpen && (
        <button
          type="button"
          data-testid="terminated-confirm"
          onClick={onConfirmTerminated}
        />
      )}
    </div>
    );
  },
}));

vi.mock("../features/viewer", () => ({
  useBGM: () => ({
    bgmInfo: null,
    isBgmPlaying: false,
    setIsBgmPlaying: vi.fn(),
    audioRef: { current: null },
  }),
  useAdjacentChapters: () => useAdjacentChaptersMock(),
  useProgress: (...args: unknown[]) => useProgressMock(...args),
  UI_HIDE_DELAY: 1500,
  useProgressSync: (...args: unknown[]) => useProgressSyncMock(...args),
  useExitFullscreenOnViewerUnmount: () => {},
  useRestoreFullscreenAfterChapterSwitch: () => {},
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: (...args: unknown[]) => useViewerSyncMock(...args),
}));

vi.mock("../hooks/useReadingTime", () => ({
  useReadingTime: () => {},
}));


vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

describe("PdfViewerRoute", () => {
  beforeEach(() => {
    latePaint = undefined;
    useViewerStore.getState().reset();
    useAdjacentChaptersMock.mockReset();
    useAdjacentChaptersMock.mockReturnValue({
      nextChapterId: null,
      prevChapterId: null,
      isLastChapterOfVolume: false,
      isAdjacentResolved: true,
    });
    useProgressMock.mockReset();
    useProgressMock.mockReturnValue({ saveProgress: vi.fn() });
    useProgressSyncMock.mockReset();
    useProgressSyncMock.mockReturnValue({
      showSyncModal: false,
      serverProgress: null,
      handleConfirmSync: vi.fn(),
      handleCloseModal: vi.fn(),
    });
    useViewerSyncMock.mockReset();
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: false,
        reason: "",
      },
    });
    useViewerStore.setState({
      currentPage: 1,
      totalPages: 0,
    });
  });

  it("forwards effective swipe direction separately from reading direction and updates without re-entry", () => {
    useViewerStore.getState().reset();
    useViewerStore.getState().initializeSwipeSettings("A", { user_default: "rtl", series_override: null, effective_direction: "rtl" });
    render(<MemoryRouter><PdfViewerRoute loaderData={{
      chapter: { id: "chapter-a", volume_id: "volume-a", title: "PDF", chapter_number: 1, page_count: 3 },
      isLoading: false, error: null, seriesId: "A", volumeId: "volume-a", pageMeta: [], pageMetaMap: new Map(),
      isInitialScrollingRef: { current: false },
    }} /></MemoryRouter>);
    expect(screen.getByTestId("pdf-swipe")).toHaveTextContent("rtl");
    expect(screen.getByTestId("pdf-reading")).toHaveTextContent("ltr");
    act(() => useViewerStore.getState().setSwipeOverride("A", "ltr"));
    expect(screen.getByTestId("pdf-swipe")).toHaveTextContent("ltr");
    expect(screen.getByTestId("pdf-reading")).toHaveTextContent("ltr");
  });

  it.each([1, 7])("keeps loading through document/page restore from %i until restored canvas paint", async (initialPage) => {
    useViewerStore.setState({ currentPage: initialPage });
    const setViewStatus = vi.fn();
    const onContentReady = vi.fn();

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-7"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <PdfViewerRoute
                onContentReady={onContentReady}
                loaderData={{
                  chapter: {
                    id: "chapter-7",
                    volume_id: "volume-1",
                    title: "PDF 챕터",
                    chapter_number: 1,
                    page_count: 20,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  restorePosition: { currentPage: 7, anchorPage: 7, offsetRatio: 0 },
                  setViewStatus,
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(useProgressSyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isRestoreSettled: false,
      }),
    );

    act(() => {
      screen.getByTestId("pdf-load").click();
    });

    expect(setViewStatus).not.toHaveBeenCalled();
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        isRestoreSettled: false,
      }),
    );

    act(() => {
      screen.getByTestId("pdf-page-7").click();
    });

    // A document-ready RAF is not a completed canvas render.
    await act(async () => { await new Promise<void>(resolve => window.requestAnimationFrame(() => resolve())); });
    expect(setViewStatus).not.toHaveBeenCalledWith("ready");
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(expect.objectContaining({ isRestoreSettled: false }));
    expect(onContentReady).not.toHaveBeenCalled();
    act(() => screen.getByText("paint first page").click());
    expect(setViewStatus).not.toHaveBeenCalledWith("ready");
    expect(onContentReady).not.toHaveBeenCalled();
    act(() => screen.getByText("paint restored page").click());
    expect(onContentReady).toHaveBeenCalledExactlyOnceWith("chapter-7");
    expect(setViewStatus).toHaveBeenCalledExactlyOnceWith("ready");
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(expect.objectContaining({ isRestoreSettled: true }));
    act(() => screen.getByText("paint restored page").click());
    expect(onContentReady).toHaveBeenCalledTimes(1);
    expect(setViewStatus).toHaveBeenCalledTimes(1);
  });

  it.each(["document error", "page error"])("ends loading on %s without treating failure as painted content", (failure) => {
    useViewerStore.setState({ currentPage: 7, totalPages: 20 });
    const setViewStatus = vi.fn(), onContentReady = vi.fn();
    render(<MemoryRouter><PdfViewerRoute onContentReady={onContentReady} loaderData={{
      chapter: { id: "error-chapter", volume_id: "volume-1", title: "PDF", chapter_number: 1, page_count: 20 },
      isLoading: false, error: null, seriesId: "series-1", volumeId: "volume-1", pageMeta: [], pageMetaMap: new Map(),
      isInitialScrollingRef: { current: false }, restorePosition: { currentPage: 7, anchorPage: 7, offsetRatio: 0 }, setViewStatus,
    }} /></MemoryRouter>);
    const completion = latePaint;
    act(() => screen.getByTestId("pdf-load").click());
    act(() => screen.getByRole("button", { name: failure }).click());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveTextContent("internal diagnostic detail");
    expect(setViewStatus).toHaveBeenCalledExactlyOnceWith("ready");
    expect(useProgressMock).toHaveBeenLastCalledWith(expect.objectContaining({ isLoading: true, viewStatus: "rendering" }));
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(expect.objectContaining({ isLoading: true, isRestoreSettled: false }));
    act(() => completion?.(7));
    expect(onContentReady).not.toHaveBeenCalled();
    expect(setViewStatus).toHaveBeenCalledTimes(1);
  });

  const renderNavigationRoute = (currentPage: number) => {
    useViewerStore.setState({ currentPage, totalPages: 20 });
    useAdjacentChaptersMock.mockReturnValue({
      nextChapterId: "next-chapter",
      prevChapterId: "prev-chapter",
      isLastChapterOfVolume: false,
      isAdjacentResolved: true,
    });
    const router = createMemoryRouter([
      {
        path: "/viewer/:chapterId",
        element: <PdfViewerRoute loaderData={{
          chapter: { id: "error-chapter", volume_id: "volume-1", title: "PDF", chapter_number: 1, page_count: 20 },
          isLoading: false, error: null, seriesId: "series-1", volumeId: "volume-1", pageMeta: [], pageMetaMap: new Map(),
          isInitialScrollingRef: { current: false },
        }} />,
      },
      { path: "/series/1", element: <div data-testid="series-page">series page</div> },
    ], { initialEntries: [{ pathname: "/viewer/error-chapter", state: { from: "/series/1" } }] });
    render(<RouterProvider router={router} />);
    act(() => screen.getByTestId("pdf-load").click());
    return router;
  };

  it.each(["ArrowLeft", "ArrowRight", " ", "Home", "End"])("ignores %s on a PDF error screen without changing pages or chapters", async (key) => {
    const initialPage = key === "ArrowLeft" ? 1 : key === "ArrowRight" || key === " " ? 20 : 7;
    const router = renderNavigationRoute(initialPage);
    // Fail after a successful paint too: the terminal state must win over prior readiness.
    act(() => screen.getByRole("button", { name: "paint active page" }).click());
    act(() => screen.getByRole("button", { name: "page error" }).click());
    expect(screen.getByRole("alert")).toBeInTheDocument();

    for (let press = 0; press < 3; press++) {
      await act(async () => { fireEvent.keyDown(window, { key }); });
    }

    expect(useViewerStore.getState().currentPage).toBe(initialPage);
    expect(useViewerStore.getState().totalPages).toBe(20);
    expect(router.state.location.pathname).toBe("/viewer/error-chapter");
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it.each(["Escape", "back button"])("keeps %s available on a PDF error screen", async (action) => {
    const router = renderNavigationRoute(7);
    act(() => screen.getByRole("button", { name: "document error" }).click());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await act(async () => {
      if (action === "Escape") fireEvent.keyDown(window, { key: "Escape" });
      else screen.getByRole("button", { name: "common.back" }).click();
    });
    expect(router.state.location.pathname).toBe("/series/1");
    expect(screen.getByTestId("series-page")).toBeInTheDocument();
  });

  it.each([
    ["ArrowLeft", 7, 6],
    ["ArrowRight", 7, 8],
    [" ", 7, 8],
    ["Home", 7, 1],
    ["End", 7, 20],
  ] as const)("preserves %s during initial PDF paint", async (key, initialPage, expectedPage) => {
    const router = renderNavigationRoute(initialPage);
    await act(async () => { fireEvent.keyDown(window, { key }); });
    expect(useViewerStore.getState().currentPage).toBe(expectedPage);
    expect(router.state.location.pathname).toBe("/viewer/error-chapter");
  });

  it.each(["clamped restore", "navigation during initial paint"])("settles on current painted page after %s", (scenario) => {
    useViewerStore.setState({ currentPage: 7, totalPages: 20 });
    const setViewStatus = vi.fn(), onContentReady = vi.fn();
    render(<MemoryRouter><PdfViewerRoute onContentReady={onContentReady} loaderData={{
      chapter: { id: "current-chapter", volume_id: "volume-1", title: "PDF", chapter_number: 1, page_count: 20 },
      isLoading: false, error: null, seriesId: "series-1", volumeId: "volume-1", pageMeta: [], pageMetaMap: new Map(),
      isInitialScrollingRef: { current: false }, restorePosition: { currentPage: 7, anchorPage: 7, offsetRatio: 0 }, setViewStatus,
    }} /></MemoryRouter>);
    const oldPaint = latePaint;
    if (scenario === "clamped restore") {
      act(() => screen.getByRole("button", { name: "load shorter PDF" }).click());
      expect(useViewerStore.getState().currentPage).toBe(3);
      expect(useViewerStore.getState().totalPages).toBe(3);
    } else {
      act(() => screen.getByTestId("pdf-load").click());
      act(() => useViewerStore.getState().goToPage(8));
      expect(useViewerStore.getState().currentPage).toBe(8);
    }
    act(() => oldPaint?.(7));
    expect(onContentReady).not.toHaveBeenCalled();
    expect(setViewStatus).not.toHaveBeenCalled();
    act(() => screen.getByRole("button", { name: "paint active page" }).click());
    expect(setViewStatus).toHaveBeenCalledExactlyOnceWith("ready");
    expect(onContentReady).toHaveBeenCalledExactlyOnceWith("current-chapter");
    expect(useProgressSyncMock).toHaveBeenLastCalledWith(expect.objectContaining({ isRestoreSettled: true, isLoading: false }));
  });

  it("세션 종료 확인 시 viewerFrom으로 replace 이동한다", async () => {
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: true,
        reason: "session ended",
      },
    });

    const router = createMemoryRouter(
      [
        {
          path: "/viewer/:chapterId",
          element: (
            <PdfViewerRoute
              loaderData={{
                chapter: {
                  id: "chapter-7",
                  volume_id: "volume-150",
                  title: "PDF 챕터 150",
                  chapter_number: 1,
                  page_count: 20,
                },
                isLoading: false,
                error: null,
                seriesId: "series-1",
                volumeId: "volume-150",
                pageMeta: [],
                pageMetaMap: new Map(),
                isInitialScrollingRef: { current: false },
              }}
            />
          ),
        },
        {
          path: "/series/1",
          element: <div data-testid="series-page">series page</div>,
        },
      ],
      {
        initialEntries: [{ pathname: "/viewer/chapter-7", state: { from: "/series/1" } }],
      },
    );

    render(
      <RouterProvider router={router} />,
    );

    act(() => {
      screen.getByTestId("terminated-confirm").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("series-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/series/1");
      expect(router.state.historyAction).toBe("REPLACE");
    });
    expect(takeReturnFocus("series", "series-1")).toBe("volume-150");
  });
});
