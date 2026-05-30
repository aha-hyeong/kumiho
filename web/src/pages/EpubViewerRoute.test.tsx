import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from "react-router-dom";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { isMobile } from "../utils/device";

const epubProgressGetMock = vi.fn();
const apiGetMock = vi.fn();
const mockSetCurrentCFI = vi.fn();
const mockSetGlobalProgress = vi.fn();
const mockSetIsAtLastPage = vi.fn();
const mockSetIncognito = vi.fn();
const mockReset = vi.fn();
const mockSetFlow = vi.fn();
const epubProgressUpdateMock = vi.fn();
const useViewerSyncMock = vi.fn();
const useAdjacentChaptersMock = vi.fn();
const libraryGetMock = vi.fn();
const seriesGetMock = vi.fn();
const seriesGetViewerSettingsMock = vi.fn();
const seriesUpdateViewerSettingsMock = vi.fn();
const settingListMock = vi.fn();
const settingUpdateMock = vi.fn();
const mockSetFontSize = vi.fn();
const mockSetLineHeight = vi.fn();

vi.mock("../utils/device", () => ({
  isMobile: vi.fn(() => false),
}));
let latestViewerProps: {
  onInitializationComplete: () => void;
  initialProgressRatio?: number | null;
  initialCFI?: string | null;
  initialOpenMode?: "default" | "last";
  onLocationChange: (location: {
    cfi: string;
    chapterPage: number;
    chapterTotal: number;
    globalRatio: number;
    currentPosition: number;
    totalPositions: number;
    chapterHref: string;
    spineIndex?: number;
    spineLength?: number;
    atStart?: boolean;
    atEnd?: boolean;
  }) => void;
  onReady: (total: number) => void;
  onBack?: () => void;
  onReachedStartPrev?: () => void;
  onFlowChange: (flow: "paginated" | "scrolled") => void;
} | null = null;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../stores/epubViewerStore", () => ({
  normalizeEpubLineHeightScale: (value: number) => value,
  useEpubViewerStore: () => ({
    currentPage: 1,
    totalPages: 1,
    globalProgress: 0,
    isUIVisible: true,
    isSettingsOpen: false,
    isTOCOpen: false,
    isFullscreen: false,
    isIncognito: false,
    settings: {
      flow: "paginated",
      renderMode: "horizontal",
      fontSize: 100,
      fontFamily: "original",
      lineHeight: 1,
      theme: "dark",
      spread: "auto",
      wheelDirection: "down",
      keyboardDirection: "ltr",
      clickDirection: "ltr",
    },
    setCurrentCFI: mockSetCurrentCFI,
    setCurrentPage: vi.fn(),
    setTotalPages: vi.fn(),
    setGlobalProgress: mockSetGlobalProgress,
    setIsAtFirstPage: vi.fn(),
    setIsAtLastPage: mockSetIsAtLastPage,
    toggleSettings: vi.fn(),
    closeSettings: vi.fn(),
    toggleTOC: vi.fn(),
    closeTOC: vi.fn(),
    setFullscreen: vi.fn(),
    setIncognito: mockSetIncognito,
    reset: mockReset,
    setFontSize: mockSetFontSize,
    setFontFamily: vi.fn(),
    setLineHeight: mockSetLineHeight,
    setTheme: vi.fn(),
    setRenderMode: vi.fn(),
    setFlow: mockSetFlow,
    setSpread: vi.fn(),
    setWheelDirection: vi.fn(),
    setKeyboardDirection: vi.fn(),
    setClickDirection: vi.fn(),
    isAtFirstPage: false,
    isAtLastPage: false,
  }),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
    isOpen ? (
      <button
        type="button"
        data-testid="terminated-confirm"
        onClick={onConfirm}
      />
    ) : null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">loading</div>,
}));

vi.mock("./EpubViewer", () => ({
  EpubViewer: ({
    onInitializationComplete,
    initialProgressRatio,
    initialCFI,
    initialOpenMode,
    onLocationChange,
    onReady,
    onBack,
    onReachedStartPrev,
    onFlowChange,
  }: {
    onInitializationComplete: () => void;
    initialProgressRatio?: number | null;
    initialCFI?: string | null;
    initialOpenMode?: "default" | "last";
    onLocationChange: (location: {
      cfi: string;
      chapterPage: number;
      chapterTotal: number;
      globalRatio: number;
      currentPosition: number;
      totalPositions: number;
      chapterHref: string;
      spineIndex?: number;
      spineLength?: number;
      atStart?: boolean;
      atEnd?: boolean;
    }) => void;
    onReady: (total: number) => void;
    onBack?: () => void;
    onReachedStartPrev?: () => void;
    onFlowChange: (flow: "paginated" | "scrolled") => void;
  }) => {
    latestViewerProps = {
      onInitializationComplete,
      initialProgressRatio,
      initialCFI,
      initialOpenMode,
      onLocationChange,
      onReady,
      onBack,
      onReachedStartPrev,
      onFlowChange,
    };
    return (
      <div>
        <div data-testid="epub-viewer">epub viewer</div>
        <button
          type="button"
          data-testid="epub-init-complete"
          onClick={onInitializationComplete}
        />
        <button
          type="button"
          data-testid="epub-ready"
          onClick={() => onReady(10)}
        />
        <button
          type="button"
          data-testid="epub-relocate"
          onClick={() =>
            onLocationChange({
              cfi: "epubcfi(/6/2[chapter]!/4/4/2)",
              chapterPage: 1,
              chapterTotal: 10,
              globalRatio: 0.1,
              currentPosition: 0,
              totalPositions: 10,
              chapterHref: "chapter.xhtml",
            })
          }
        />
        {onBack && (
          <button type="button" data-testid="epub-back" onClick={onBack} />
        )}
        {onReachedStartPrev && (
          <button type="button" data-testid="epub-prev-at-start" onClick={onReachedStartPrev} />
        )}
      </div>
    );
  },
}));

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => apiGetMock(...args),
  },
  epubProgressAPI: {
    get: (...args: unknown[]) => epubProgressGetMock(...args),
    update: (...args: unknown[]) => epubProgressUpdateMock(...args),
  },
  libraryAPI: {
    get: (...args: unknown[]) => libraryGetMock(...args),
  },
  seriesAPI: {
    get: (...args: unknown[]) => seriesGetMock(...args),
    getViewerSettings: (...args: unknown[]) => seriesGetViewerSettingsMock(...args),
    updateViewerSettings: (...args: unknown[]) => seriesUpdateViewerSettingsMock(...args),
  },
  settingAPI: {
    list: (...args: unknown[]) => settingListMock(...args),
    update: (...args: unknown[]) => settingUpdateMock(...args),
  },
}));

vi.mock("../features/viewer", () => ({
  useAdjacentChapters: (...args: unknown[]) => useAdjacentChaptersMock(...args),
  useExitFullscreenOnViewerUnmount: () => {},
  useRestoreFullscreenAfterChapterSwitch: () => {},
  useBGM: () => ({
    bgmInfo: null,
    isBgmPlaying: false,
    setIsBgmPlaying: vi.fn(),
    audioRef: { current: null },
  }),
}));

vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: (...args: unknown[]) => useViewerSyncMock(...args),
}));

globalThis.URL.createObjectURL = vi.fn(() => "blob:epub");
globalThis.URL.revokeObjectURL = vi.fn();

describe("EpubViewerRoute", () => {
  beforeEach(() => {
    epubProgressGetMock.mockReset();
    apiGetMock.mockReset();
    mockSetCurrentCFI.mockReset();
    mockSetGlobalProgress.mockReset();
    mockSetIsAtLastPage.mockReset();
    mockSetIncognito.mockReset();
    mockReset.mockReset();
    mockSetFlow.mockReset();
    mockSetFontSize.mockReset();
    mockSetLineHeight.mockReset();
    epubProgressUpdateMock.mockReset();
    useViewerSyncMock.mockReset();
    useAdjacentChaptersMock.mockReset();
    libraryGetMock.mockReset();
    seriesGetMock.mockReset();
    seriesGetViewerSettingsMock.mockReset();
    seriesUpdateViewerSettingsMock.mockReset();
    settingListMock.mockReset();
    settingUpdateMock.mockReset();
    latestViewerProps = null;
    libraryGetMock.mockResolvedValue({ data: {} });
    seriesGetMock.mockResolvedValue({ data: {} });
    seriesGetViewerSettingsMock.mockResolvedValue({});
    seriesUpdateViewerSettingsMock.mockResolvedValue({});
    settingListMock.mockResolvedValue({});
    settingUpdateMock.mockResolvedValue({});
    useViewerSyncMock.mockReturnValue({
      terminatedInfo: {
        isOpen: false,
        reason: "",
      },
    });
    useAdjacentChaptersMock.mockReturnValue({
      nextChapterId: null,
      prevChapterId: null,
      nextChapterTitle: null,
      prevChapterTitle: null,
      isAdjacentResolved: true,
    });

    epubProgressGetMock.mockResolvedValue({
      data: {
        progress: {
          current_cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
          progress_percent: 45,
        },
      },
    });
    apiGetMock.mockResolvedValue({
      data: new Blob(["epub"]),
    });
    epubProgressUpdateMock.mockResolvedValue({});
  });

  it("초기화 완료 전에는 EPUB 뷰어를 투명 상태로 유지하고 스피너를 표시한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    });

    expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
    const viewerContainer = screen.getByTestId("epub-viewer").parentElement?.parentElement;
    expect(viewerContainer).toHaveStyle({ opacity: "0" });
    expect(viewerContainer).toHaveStyle({ pointerEvents: "none" });
  });

  it("초기화 완료 후에만 EPUB 뷰어를 렌더한다", async () => {
    const setViewStatus = vi.fn();

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus,
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      const viewerContainer = screen.getByTestId("epub-viewer").parentElement?.parentElement;
      expect(viewerContainer).toHaveStyle({ opacity: "1" });
      expect(viewerContainer).toHaveStyle({ pointerEvents: "auto" });
      expect(setViewStatus).toHaveBeenCalledWith("ready");
    });
  });

  it("시리즈별 epub_flow 설정이 전역 설정보다 우선 적용된다", async () => {
    settingListMock.mockResolvedValueOnce({ epub_flow: "paginated" });
    seriesGetViewerSettingsMock.mockResolvedValueOnce({ epub_flow: "scrolled" });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(seriesGetViewerSettingsMock).toHaveBeenCalledWith("series-1");
      expect(mockSetFlow).toHaveBeenCalledWith("scrolled");
    });
  });

  it("시리즈가 있는 EPUB flow 변경은 전역 설정이 아니라 시리즈별 설정으로 저장한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      latestViewerProps?.onFlowChange("scrolled");
    });

    expect(mockSetFlow).toHaveBeenCalledWith("scrolled");
    expect(seriesUpdateViewerSettingsMock).toHaveBeenCalledWith("series-1", { epub_flow: "scrolled" });
    expect(settingUpdateMock).not.toHaveBeenCalledWith("epub_flow", { value: "scrolled" });
  });

  it("저장된 current_cfi가 있으면 progress_percent가 100이어도 ratio 복원을 사용하지 않는다", async () => {
    epubProgressGetMock.mockResolvedValueOnce({
      data: {
        progress: {
          current_cfi: "epubcfi(/6/2[chapter]!/4/8/2)",
          progress_percent: 100,
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    expect(latestViewerProps?.initialCFI).toBe("epubcfi(/6/2[chapter]!/4/8/2)");
    expect(latestViewerProps?.initialProgressRatio).toBeNull();
  });

  it("page=last 진입 시 저장된 current_cfi 대신 마지막 위치 비율로 복원한다", async () => {
    epubProgressGetMock.mockResolvedValueOnce({
      data: {
        progress: {
          current_cfi: "epubcfi(/6/2[chapter]!/4/4/2)",
          progress_percent: 56,
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1?page=last"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    expect(latestViewerProps?.initialCFI).toBeNull();
    expect(latestViewerProps?.initialProgressRatio).toBe(1);
    expect(latestViewerProps?.initialOpenMode).toBe("last");
    expect(mockSetGlobalProgress).toHaveBeenCalledWith(100);
    expect(epubProgressGetMock).not.toHaveBeenCalled();
  });

  it("locations 준비 전에는 저장을 미루고 준비 후 같은 CFI라도 정상 저장한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
        chapterPage: 1,
        chapterTotal: 10,
        globalRatio: 0,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    expect(epubProgressUpdateMock).not.toHaveBeenCalled();

    act(() => {
      latestViewerProps?.onReady(10);
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
        chapterPage: 5,
        chapterTotal: 10,
        globalRatio: 0.45,
        currentPosition: 4,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
      });
    });

    await waitFor(() => {
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 5,
        total_pages: 10,
        progress_percent: expect.closeTo(44.4444444444, 5),
        current_position: 4,
        total_positions: 10,
        current_cfi: "epubcfi(/6/2[chapter]!/4/2/6)",
      });
    });
  });

  it("TXT 변환 EPUB은 visible page 기준으로 진행률을 저장한다", async () => {
    apiGetMock.mockResolvedValueOnce({
      data: new Blob(["epub"]),
      headers: {
        get: (name: string) => (name.toLowerCase() === "x-kumiho-source-format" ? "txt" : null),
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "TXT 변환 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/8/2)",
        chapterPage: 4,
        chapterTotal: 8,
        globalRatio: 0,
        currentPosition: 0,
        totalPositions: 8,
        chapterHref: "chapter.xhtml",
        spineIndex: 0,
        spineLength: 1,
      });
    });

    await waitFor(() => {
      expect(mockSetGlobalProgress).toHaveBeenCalledWith(expect.closeTo(42.8571428571, 5));
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 43,
        total_pages: 100,
        progress_percent: expect.closeTo(42.8571428571, 5),
        current_position: 42,
        total_positions: 100,
        current_cfi: "epubcfi(/6/2[chapter]!/4/8/2)",
      });
    });
  });

  it("마지막 위치 도달 시 progress_percent: 100으로 저장한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onReady(10);
      // currentPosition: 9 = totalPositions - 1 → isLocationAtEnd = true → atEnd=true
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/10/2)",
        chapterPage: 10,
        chapterTotal: 10,
        globalRatio: 1.0,
        currentPosition: 9,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
      });
    });

    await waitFor(() => {
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 10,
        total_pages: 10,
        progress_percent: 100,
        current_position: 9,
        total_positions: 10,
        current_cfi: "epubcfi(/6/2[chapter]!/4/10/2)",
      });
    });

    expect(mockSetIsAtLastPage).toHaveBeenCalledWith(true);
    expect(mockSetGlobalProgress).toHaveBeenCalledWith(100);
  });

  it("마지막 location이어도 실제 마지막 페이지 신호가 없으면 마지막으로 처리하지 않는다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    mockSetIsAtLastPage.mockReset();

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/9/6)",
        chapterPage: 9,
        chapterTotal: 10,
        globalRatio: 0.94,
        currentPosition: 9,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
        atEnd: false,
      });
    });

    expect(mockSetIsAtLastPage).toHaveBeenCalledWith(false);
  });

  it("should not mark at last page when atEnd flag appears but progress is not at edge", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    mockSetIsAtLastPage.mockReset();

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/3/6)",
        chapterPage: 2,
        chapterTotal: 10,
        globalRatio: 0.25,
        currentPosition: 2,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
        atEnd: true,
      });
    });

    expect(mockSetIsAtLastPage).toHaveBeenCalledWith(false);
  });

  it("마지막 스프레드의 첫 위치에서는 마지막 페이지로 처리하지 않는다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
    });

    mockSetIsAtLastPage.mockReset();

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/9/2)",
        chapterPage: 10,
        chapterTotal: 10,
        globalRatio: 0.98,
        currentPosition: 8,
        totalPositions: 10,
        chapterHref: "chapter.xhtml",
        spineIndex: 4,
        spineLength: 5,
      });
    });

    expect(mockSetIsAtLastPage).toHaveBeenCalledWith(false);
  });

  it("locations 축이 끝까지 1이어도 pseudo page로 current_cfi를 저장한다", async () => {
    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/6/8)",
        chapterPage: 3,
        chapterTotal: 10,
        globalRatio: 0.45,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    await waitFor(() => {
      expect(epubProgressUpdateMock).toHaveBeenCalledWith("chapter-1", {
        current_page: 45,
        total_pages: 100,
        progress_percent: 45,
        current_position: 0,
        total_positions: 0,
        current_cfi: "epubcfi(/6/2[chapter]!/4/6/8)",
      });
    });
  });

  it("시크릿 모드에서는 pseudo page fallback도 저장하지 않는다", async () => {
    render(
      <MemoryRouter initialEntries={[{ pathname: "/viewer/chapter-1", state: { isIncognito: true } }]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("epub-viewer")).toBeInTheDocument();
      expect(latestViewerProps).not.toBeNull();
    });

    act(() => {
      screen.getByTestId("epub-init-complete").click();
    });

    act(() => {
      latestViewerProps?.onLocationChange({
        cfi: "epubcfi(/6/2[chapter]!/4/8/10)",
        chapterPage: 4,
        chapterTotal: 10,
        globalRatio: 0.5,
        currentPosition: 0,
        totalPositions: 1,
        chapterHref: "chapter.xhtml",
      });
    });

    expect(epubProgressUpdateMock).not.toHaveBeenCalled();
  });

  it("나가기 버튼: viewerFrom 있을 때 해당 경로로 replace 이동한다", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/viewer/:chapterId",
          element: (
            <EpubViewerRoute
              loaderData={{
                chapter: {
                  id: "chapter-1",
                  volume_id: "volume-1",
                  title: "EPUB 챕터",
                  chapter_number: 1,
                  page_count: 1,
                },
                isLoading: false,
                error: null,
                seriesId: "series-1",
                volumeId: "volume-1",
                pageMeta: [],
                pageMetaMap: new Map(),
                isInitialScrollingRef: { current: false },
                setViewStatus: vi.fn(),
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
        initialEntries: [{ pathname: "/viewer/chapter-1", state: { from: "/series/1" } }],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
      expect(latestViewerProps?.onBack).toBeDefined();
    });

    act(() => {
      latestViewerProps?.onBack?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("series-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/series/1");
      expect(router.state.historyAction).toBe("REPLACE");
    });
  });

  it("이전 챕터 이동 시 viewerFrom과 isIncognito 상태를 유지한다", async () => {
    useAdjacentChaptersMock.mockReturnValue({
      nextChapterId: null,
      prevChapterId: "chapter-0",
      nextChapterTitle: null,
      prevChapterTitle: "이전 챕터",
      isAdjacentResolved: true,
    });

    const router = createMemoryRouter(
      [
        {
          path: "/viewer/:chapterId",
          element: (
            <EpubViewerRoute
              loaderData={{
                chapter: {
                  id: "chapter-1",
                  volume_id: "volume-1",
                  title: "EPUB 챕터",
                  chapter_number: 2,
                  page_count: 1,
                },
                isLoading: false,
                error: null,
                seriesId: "series-1",
                volumeId: "volume-1",
                pageMeta: [],
                pageMetaMap: new Map(),
                isInitialScrollingRef: { current: false },
                setViewStatus: vi.fn(),
              }}
            />
          ),
        },
        {
          path: "/viewer/chapter-0",
          element: <div data-testid="prev-chapter-page">prev chapter</div>,
        },
      ],
      {
        initialEntries: [
          { pathname: "/viewer/chapter-1", state: { from: "/series/1", isIncognito: true } },
        ],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(latestViewerProps).not.toBeNull();
      expect(latestViewerProps?.onReachedStartPrev).toBeDefined();
    });

    act(() => {
      latestViewerProps?.onReachedStartPrev?.();
    });

    await waitFor(() => {
      expect(screen.getByTestId("prev-chapter-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/viewer/chapter-0");
      expect(router.state.location.search).toBe("?page=last");
      expect(router.state.location.state?.from).toBe("/series/1");
      expect(router.state.location.state?.isIncognito).toBe(true);
    });
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
            <EpubViewerRoute
              loaderData={{
                chapter: {
                  id: "chapter-1",
                  volume_id: "volume-1",
                  title: "EPUB 챕터",
                  chapter_number: 1,
                  page_count: 1,
                },
                isLoading: false,
                error: null,
                seriesId: "series-1",
                volumeId: "volume-1",
                pageMeta: [],
                pageMetaMap: new Map(),
                isInitialScrollingRef: { current: false },
                setViewStatus: vi.fn(),
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
        initialEntries: [{ pathname: "/viewer/chapter-1", state: { from: "/series/1" } }],
      },
    );

    render(<RouterProvider router={router} />);

    await waitFor(() => {
      expect(screen.getByTestId("terminated-confirm")).toBeInTheDocument();
    });

    act(() => {
      screen.getByTestId("terminated-confirm").click();
    });

    await waitFor(() => {
      expect(screen.getByTestId("series-page")).toBeInTheDocument();
      expect(router.state.location.pathname).toBe("/series/1");
      expect(router.state.historyAction).toBe("REPLACE");
    });
  });

  it("isMobile()이 true일 때 모바일 전용 설정 키를 우선 로딩한다", async () => {
    vi.mocked(isMobile).mockReturnValue(true);
    settingListMock.mockResolvedValue({
      epub_font_size_mobile: "80",
      epub_font_size: "100",
      epub_line_height_mobile: "1.1",
      epub_line_height: "1.2",
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockSetFontSize).toHaveBeenCalledWith(80);
      expect(mockSetLineHeight).toHaveBeenCalledWith(1.1);
    });
  });

  it("isMobile()이 false일 때 데스크톱 일반 설정 키를 로딩한다", async () => {
    vi.mocked(isMobile).mockReturnValue(false);
    settingListMock.mockResolvedValue({
      epub_font_size_mobile: "80",
      epub_font_size: "100",
      epub_line_height_mobile: "1.1",
      epub_line_height: "1.2",
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <EpubViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "EPUB 챕터",
                    chapter_number: 1,
                    page_count: 1,
                  },
                  isLoading: false,
                  error: null,
                  seriesId: "series-1",
                  volumeId: "volume-1",
                  pageMeta: [],
                  pageMetaMap: new Map(),
                  isInitialScrollingRef: { current: false },
                  setViewStatus: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mockSetFontSize).toHaveBeenCalledWith(100);
      expect(mockSetLineHeight).toHaveBeenCalledWith(1.2);
    });
  });
});
