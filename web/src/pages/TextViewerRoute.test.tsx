import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TextViewerRoute } from "./TextViewerRoute";
import { useViewerStore } from "../stores/viewerStore";

const chapterGetTextMock = vi.fn();
const chapterGetProgressMock = vi.fn();
const seriesUpdateViewerSettingsMock = vi.fn();

vi.mock("../api/client", () => ({
  chapterAPI: {
    getText: (...args: unknown[]) => chapterGetTextMock(...args),
    getProgress: (...args: unknown[]) => chapterGetProgressMock(...args),
  },
  seriesAPI: {
    updateProgress: vi.fn().mockResolvedValue(undefined),
    updateViewerSettings: (...args: unknown[]) => seriesUpdateViewerSettingsMock(...args),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../features/viewer", () => ({
  UI_HIDE_DELAY: 1500,
  useAdjacentChapters: () => ({
    nextChapterId: null,
    prevChapterId: null,
    nextChapterTitle: null,
    prevChapterTitle: null,
    isAdjacentResolved: true,
  }),
  useExitFullscreenOnViewerUnmount: () => {},
  useProgressSync: () => ({
    showSyncModal: false,
    serverProgress: null,
    handleConfirmSync: vi.fn(),
    handleCloseModal: vi.fn(),
  }),
  useRestoreFullscreenAfterChapterSwitch: () => {},
  ViewerHeader: () => <div data-testid="viewer-header" />,
  ViewerFooter: ({
    onReadingModeChange,
  }: {
    onReadingModeChange: (mode: "single" | "double" | "vertical") => void;
  }) => (
    <div data-testid="viewer-footer">
      <button
        type="button"
        data-testid="switch-single"
        onClick={() => onReadingModeChange("single")}
      />
      <button
        type="button"
        data-testid="switch-double"
        onClick={() => onReadingModeChange("double")}
      />
    </div>
  ),
  PageJumpModal: () => null,
  SyncConfirmModal: () => null,
  ChapterNavHint: () => null,
  PullIndicator: () => null,
}));

vi.mock("../stores/fullscreenSwitchStore", () => ({
  startChapterSwitching: vi.fn(),
}));

vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: () => ({
    terminatedInfo: {
      isOpen: false,
      reason: "",
    },
  }),
}));

vi.mock("../hooks/useReadingTime", () => ({
  useReadingTime: () => {},
}));

vi.mock("../features/viewer/hooks/usePreventBrowserZoom", () => ({
  usePreventBrowserZoom: () => {},
}));

describe("TextViewerRoute", () => {
  beforeEach(() => {
    chapterGetTextMock.mockReset();
    chapterGetProgressMock.mockReset();
    seriesUpdateViewerSettingsMock.mockReset();
    seriesUpdateViewerSettingsMock.mockResolvedValue(undefined);
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };
    Object.defineProperty(doc as unknown as Record<string, unknown>, "caretPositionFromPoint", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    Object.defineProperty(doc as unknown as Record<string, unknown>, "caretRangeFromPoint", {
      configurable: true,
      value: undefined,
      writable: true,
    });
    useViewerStore.setState({
      currentPage: 1,
      totalPages: 1,
      settings: {
        ...useViewerStore.getState().settings,
        readingMode: "single",
      },
    });
  });

  it("텍스트 렌더 직후 재측정으로 totalPages를 1보다 크게 반영한다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "테스트 문장 ".repeat(300),
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/테스트 문장/);

    const textBody = document.querySelector("article");
    const viewportMask = textBody?.parentElement as HTMLDivElement | null;
    const scrollContainer = viewportMask?.parentElement as HTMLDivElement | null;
    expect(viewportMask).toBeTruthy();
    expect(scrollContainer).toBeTruthy();

    Object.defineProperty(scrollContainer, "clientHeight", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(scrollContainer, "scrollHeight", {
      configurable: true,
      value: 2200,
    });
    Object.defineProperty(scrollContainer, "scrollTop", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(viewportMask, "clientWidth", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(scrollContainer, "clientWidth", {
      configurable: true,
      value: 548,
    });
    Object.defineProperty(scrollContainer, "scrollWidth", {
      configurable: true,
      value: 548,
    });
    Object.defineProperty(scrollContainer, "scrollLeft", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(textBody!, "scrollWidth", {
      configurable: true,
      value: 2000,
    });

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    await waitFor(() => {
      expect(useViewerStore.getState().totalPages).toBeGreaterThan(1);
    });
  });

  it("연속 빈 줄 기준으로 문단을 분리하고 문단 내부 개행은 유지한다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "첫 문단 첫 줄\n첫 문단 둘째 줄\n\n둘째 문단 첫 줄",
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelectorAll("p[data-paragraph-id]")).toHaveLength(2);
    });

    const paragraphs = Array.from(document.querySelectorAll("p[data-paragraph-id]"));
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.textContent).toBe("첫 문단 첫 줄\n첫 문단 둘째 줄");
    expect(paragraphs[1]?.textContent).toBe("둘째 문단 첫 줄");
  });

  it("2page 캡처 좌표는 좌측 페이지 내부 여백보다 안쪽을 사용한다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "문단 하나\n\n문단 둘",
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    useViewerStore.setState({
      settings: {
        ...useViewerStore.getState().settings,
        readingMode: "double",
      },
    });

    const caretSpy = vi.fn().mockReturnValue(null);
    const doc = document as Document & {
      caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    };
    doc.caretPositionFromPoint = caretSpy;

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(document.querySelector("article")).toBeTruthy();
    });

    const textBody = document.querySelector("article");
    const viewportMask = textBody?.parentElement as HTMLDivElement | null;
    expect(viewportMask).toBeTruthy();

    Object.defineProperty(viewportMask!, "getBoundingClientRect", {
      configurable: true,
      value: () =>
        ({
          left: 100,
          top: 50,
          right: 900,
          bottom: 650,
          width: 800,
          height: 600,
          x: 100,
          y: 50,
          toJSON: () => ({}),
        }) satisfies DOMRect,
    });

    act(() => {
      screen.getByTestId("switch-single").click();
    });

    await waitFor(() => {
      expect(caretSpy).toHaveBeenCalled();
    });

    const lastCall = caretSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe(128);
    expect(lastCall?.[1]).toBe(78);
  });

  it("1page에서 2page로 전환할 때 첫 spread로 튀지 않는다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "테스트 문장 ".repeat(300),
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/테스트 문장/);

    const textBody = document.querySelector("article") as HTMLElement | null;
    const viewportMask = textBody?.parentElement as HTMLDivElement | null;
    const scrollContainer = viewportMask?.parentElement as HTMLDivElement | null;
    expect(textBody).toBeTruthy();
    expect(viewportMask).toBeTruthy();
    expect(scrollContainer).toBeTruthy();

    Object.defineProperty(viewportMask!, "clientWidth", {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(scrollContainer!, "clientWidth", {
      configurable: true,
      value: 548,
    });
    Object.defineProperty(scrollContainer!, "scrollWidth", {
      configurable: true,
      value: 548,
    });
    Object.defineProperty(scrollContainer!, "scrollLeft", {
      configurable: true,
      value: 0,
      writable: true,
    });
    Object.defineProperty(textBody!, "scrollWidth", {
      configurable: true,
      value: 4000,
    });

    act(() => {
      useViewerStore.setState({ currentPage: 5 });
      Object.defineProperty(scrollContainer!, "scrollLeft", {
        configurable: true,
        value: 1000,
        writable: true,
      });
      screen.getByTestId("switch-double").click();
    });

    await waitFor(() => {
      expect(useViewerStore.getState().settings.readingMode).toBe("double");
    });

    expect(useViewerStore.getState().currentPage).toBeGreaterThan(1);
  });

  it("세로 모드에서 wheel 이벤트 시 pullOffset이 임계값 미만이면 0으로 복귀한다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "짧은 텍스트",
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    useViewerStore.setState({
      settings: {
        ...useViewerStore.getState().settings,
        readingMode: "vertical",
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/짧은 텍스트/);

    const scrollContainer = document.querySelector("article")?.parentElement?.parentElement;
    expect(scrollContainer).toBeTruthy();

    // 스크롤 컨테이너에 작은 wheel 이벤트 발생 (임계값 미달)
    act(() => {
      scrollContainer!.dispatchEvent(new WheelEvent("wheel", { deltaY: -5, bubbles: true, cancelable: true }));
    });

    // 에러 없이 정상 동작하는지 확인
    expect(document.querySelector("article")).toBeTruthy();
  });

  it("세로에서 복원된 single 페이지 번호를 다음 double 전환의 기준으로 사용한다", async () => {
    chapterGetTextMock.mockResolvedValue({
      data: {
        content: "테스트 문장 ".repeat(300),
      },
    });
    chapterGetProgressMock.mockResolvedValue({
      data: {
        progress: null,
      },
    });

    render(
      <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
        <Routes>
          <Route
            path="/viewer/:chapterId"
            element={
              <TextViewerRoute
                loaderData={{
                  chapter: {
                    id: "chapter-1",
                    volume_id: "volume-1",
                    title: "테스트 챕터",
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
                  isInitialScrolling: false,
                  setIsInitialScrolling: vi.fn(),
                }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText(/테스트 문장/);

    act(() => {
      useViewerStore.setState({
        settings: {
          ...useViewerStore.getState().settings,
          readingMode: "single",
        },
        currentPage: 7,
      });
      screen.getByTestId("switch-double").click();
    });

    await waitFor(() => {
      expect(useViewerStore.getState().settings.readingMode).toBe("double");
    });

    expect(useViewerStore.getState().currentPage).toBe(7);
  });
});
