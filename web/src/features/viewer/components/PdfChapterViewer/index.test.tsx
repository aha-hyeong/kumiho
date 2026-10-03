import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { forwardRef, type ReactNode } from "react";
import { PdfChapterViewer } from "./index";

let mockIsZoomed = false;
let mockAnimateNext = vi.fn();
let mockAnimatePrev = vi.fn();
const mockUseSwipe = vi.hoisted(() => vi.fn());
const mockPdfGetPage = vi.hoisted(() => vi.fn());
const mockGetDocument = vi.hoisted(() => vi.fn());
const mockRefreshAccessTokenForNonAxiosFlow = vi.hoisted(() => vi.fn());

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {
    workerSrc: "",
  },
  getDocument: mockGetDocument,
  TextLayer: class {
    async render() {
      return Promise.resolve();
    }
  },
}));

vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "mock-worker-url",
}));

vi.mock("./index.module.css", () => ({
  default: new Proxy(
    {},
    {
      get: (_, key) => String(key),
    },
  ),
}));

vi.mock("../../../../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner">loading</div>,
}));

vi.mock("../../hooks/useViewerZoom", () => ({
  useViewerZoom: () => ({
    transformComponentRef: { current: null },
    isZoomed: mockIsZoomed,
    setIsZoomed: vi.fn(),
    handleContentClick: vi.fn(),
    handleMouseDown: vi.fn(),
    handleMouseMove: vi.fn(),
  }),
}));

vi.mock("../../hooks/useSwipe", () => ({
  useSwipe: (params: unknown) => {
    mockUseSwipe(params);
    return ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
    swipeOffset: 0,
    isAnimating: false,
    animateNext: mockAnimateNext,
    animatePrev: mockAnimatePrev,
    });
  },
}));

vi.mock("../../../../api/client", () => ({
  refreshAccessTokenForNonAxiosFlow: mockRefreshAccessTokenForNonAxiosFlow,
}));

vi.mock("../PageTransition", () => ({
  PageTransition: forwardRef<
    HTMLDivElement,
    {
      children: ReactNode;
      onWheel?: (e: React.WheelEvent) => void;
      prevChildren?: ReactNode;
      nextChildren?: ReactNode;
    }
  >(({ children, onWheel, prevChildren, nextChildren }, ref) => (
    <div
      ref={ref}
      data-testid="pdf-page-transition"
      onWheel={onWheel}
    >
      {prevChildren}
      {children}
      {nextChildren}
    </div>
  )),
}));

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TransformComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const baseProps = {
  chapterId: undefined,
  currentPage: 1,
  fitMode: "screen",
  readingMode: "single" as const,
  readingDirection: "ltr" as const,
  transitionType: "slide" as const,
  onDocumentLoad: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
};

const createMockPdfPage = () => ({
  getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 100 * scale, height: 140 * scale })),
  render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  getTextContent: vi.fn(async () => ({ items: [], styles: {} })),
});

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];
  private callback: ResizeObserverCallback;
  observe = vi.fn();
  disconnect = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  trigger(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  mockIsZoomed = false;
  mockAnimateNext = vi.fn();
  mockAnimatePrev = vi.fn();
  mockUseSwipe.mockReset();
  mockPdfGetPage.mockReset();
  mockGetDocument.mockReset();
  mockRefreshAccessTokenForNonAxiosFlow.mockReset();
  MockResizeObserver.instances = [];
  globalThis.ResizeObserver = originalResizeObserver;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("PdfChapterViewer swipe preference", () => {
  it("passes the explicit swipe direction to useSwipe independently of reading direction", () => {
    const { rerender } = render(<PdfChapterViewer {...baseProps} {...{ swipeDirection: "rtl" as const }} />);
    expect(mockUseSwipe).toHaveBeenLastCalledWith(expect.objectContaining({ readingDirection: "ltr", swipeDirection: "rtl" }));
    rerender(<PdfChapterViewer {...baseProps} readingDirection="rtl" {...{ swipeDirection: "ltr" as const }} />);
    expect(mockUseSwipe).toHaveBeenLastCalledWith(expect.objectContaining({ readingDirection: "rtl", swipeDirection: "ltr" }));
  });
});

describe("PdfChapterViewer wheel navigation", () => {
  it("moves next on wheel down when wheelDirection is down", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(1);
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("moves prev on wheel down when wheelDirection is up", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="up"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimatePrev).toHaveBeenCalledTimes(1);
    expect(mockAnimateNext).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation with ctrl key pressed", () => {
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, ctrlKey: true });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation when zoomed", () => {
    mockIsZoomed = true;
    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    fireEvent.wheel(screen.getByTestId("pdf-page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("throttles rapid wheel events", () => {
    const dateNow = vi.spyOn(Date, "now");
    dateNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100).mockReturnValueOnce(1300);

    render(
      <PdfChapterViewer
        {...baseProps}
        wheelDirection="down"
      />,
    );

    const container = screen.getByTestId("pdf-page-transition");
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(2);
  });
});

describe("PdfChapterViewer PDF load logic", () => {
  const createMockPdf = (numPages = 3) => {
    // PdfChapterViewer는 문서 로드 직후 pdf.getPage()를 호출하므로
    // 기본 페이지 mock을 설정하여 렌더링 중 TypeError를 방지한다.
    mockPdfGetPage.mockResolvedValue(createMockPdfPage());
    return {
      numPages,
      getPage: mockPdfGetPage,
      getOutline: vi.fn(async () => null),
    };
  };

  it.each([1, 2])("waits for both latest double-mode canvases when page %i finishes first", async (firstPage) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const pdf = createMockPdf(2);
    const paints: Array<{ page: number; pdfPage: ReturnType<typeof createMockPdfPage>; finish: () => void }> = [];
    mockPdfGetPage.mockImplementation(async (page: number) => {
      const pdfPage = createMockPdfPage();
      let finish!: () => void;
      const promise = new Promise<void>(resolve => { finish = resolve; });
      pdfPage.render.mockReturnValue({ promise, cancel: vi.fn() });
      paints.push({ page, pdfPage, finish });
      return pdfPage;
    });
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn() });
    const onPageRendered = vi.fn();
    const props = { ...baseProps, chapterId: "spread", currentPage: 2, readingMode: "double" as const, onPageRendered };
    const view = render(<PdfChapterViewer {...props} />);
    const latest = (page: number) => paints.filter(p => p.page === page && p.pdfPage.render.mock.calls.length > 0).at(-1)!;
    await waitFor(() => { expect(latest(1)).toBeDefined(); expect(latest(2)).toBeDefined(); });
    const oldOther = latest(firstPage === 1 ? 2 : 1);
    await act(async () => { latest(firstPage).finish(); });
    expect(onPageRendered).not.toHaveBeenCalled();
    const previousCount = paints.length;
    view.rerender(<PdfChapterViewer {...props} fitMode="width" />);
    await waitFor(() => expect(paints.length).toBeGreaterThan(previousCount));
    await waitFor(() => expect(latest(firstPage === 1 ? 2 : 1)).not.toBe(oldOther));
    // A replaced half-spread cannot combine with paint from a previous request.
    await act(async () => { oldOther.finish(); });
    expect(onPageRendered).not.toHaveBeenCalled();
    await act(async () => { latest(firstPage).finish(); });
    expect(onPageRendered).not.toHaveBeenCalled();
    await act(async () => { latest(firstPage === 1 ? 2 : 1).finish(); });
    expect(onPageRendered).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("only signals the latest connected canvas after its render promise completes", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const pdf = createMockPdf(1);
    const requests: Array<(page: ReturnType<typeof createMockPdfPage>) => void> = [];
    mockPdfGetPage.mockImplementation(() => new Promise(resolve => requests.push(resolve)));
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn() });
    const onPageRendered = vi.fn();
    const props = { ...baseProps, chapterId: "paint", onPageRendered };
    const view = render(<PdfChapterViewer {...props} />);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const previousCount = requests.length;
    view.rerender(<PdfChapterViewer {...props} fitMode="width" />);
    await waitFor(() => expect(requests.length).toBeGreaterThan(previousCount));
    let finishPaint!: () => void;
    const paint = new Promise<void>(resolve => { finishPaint = resolve; });
    const newestPage = createMockPdfPage();
    newestPage.render.mockReturnValue({ promise: paint, cancel: vi.fn() });
    await act(async () => { requests.at(-1)!(newestPage); });
    expect(newestPage.render).toHaveBeenCalled();
    expect(onPageRendered).not.toHaveBeenCalled();
    await act(async () => { finishPaint(); });
    expect(onPageRendered).toHaveBeenCalledExactlyOnceWith(1);
    const stalePage = createMockPdfPage();
    await act(async () => { requests.slice(0, -1).forEach(resolve => resolve(stalePage)); });
    expect(stalePage.render).not.toHaveBeenCalled();
    expect(onPageRendered).toHaveBeenCalledTimes(1);
  });

  it("calls onDocumentLoad with numPages on successful load", async () => {
    mockRefreshAccessTokenForNonAxiosFlow.mockResolvedValue({ accessToken: "new-token" });
    const mockPdf = createMockPdf(5);
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve(mockPdf),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-1"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(5));
  });

  it("signals terminal document error after every load fallback fails", async () => {
    // worker on/off 각각 main/query 모두 실패하는 시나리오
    mockRefreshAccessTokenForNonAxiosFlow.mockRejectedValue(new Error("refresh failed"));
    mockGetDocument
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("First failure")),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Query token failure")),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Worker off failure")),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Worker off query failure")),
        destroy: vi.fn(),
      });

    const onDocumentLoad = vi.fn(), onDocumentError = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-fail"
        onDocumentLoad={onDocumentLoad}
        {...{ onDocumentError }}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(0));
    expect(onDocumentError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "Worker off query failure" }));
    expect(mockGetDocument).toHaveBeenCalledTimes(4);
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({ disableWorker: false });
    expect(mockGetDocument.mock.calls[1][0]).toMatchObject({ disableWorker: false });
    expect(mockGetDocument.mock.calls[2][0]).toMatchObject({ disableWorker: true });
    expect(mockGetDocument.mock.calls[3][0]).toMatchObject({ disableWorker: true });
    expect(mockRefreshAccessTokenForNonAxiosFlow).toHaveBeenCalledTimes(1);
  });

  it.each(["single", "double"] as const)("signals visible %s page failures without signaling ready", async (mode) => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const error = new Error("synthetic render failure");
    const pdf = createMockPdf(2);
    mockPdfGetPage.mockImplementation(async () => { throw error; });
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn() });
    const onPageRendered = vi.fn(), onPageRenderError = vi.fn();
    render(<PdfChapterViewer {...baseProps} chapterId="visible-failure" currentPage={2} readingMode={mode} onPageRendered={onPageRendered} {...{ onPageRenderError }} />);
    await waitFor(() => expect(onPageRenderError).toHaveBeenCalledWith(mode === "double" ? 1 : 2, error));
    expect(onPageRendered).not.toHaveBeenCalled();
  });

  it("signals a rejected canvas render promise for the active page", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(800);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(900);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as CanvasRenderingContext2D);
    const error = new Error("synthetic paint failure"), pdf = createMockPdf(1), page = createMockPdfPage();
    page.render.mockImplementation(() => ({ promise: Promise.reject(error), cancel: vi.fn() }));
    mockPdfGetPage.mockResolvedValue(page);
    mockGetDocument.mockReturnValue({ promise: Promise.resolve(pdf), destroy: vi.fn() });
    const onPageRendered = vi.fn(), onPageRenderError = vi.fn();
    render(<PdfChapterViewer {...baseProps} chapterId="paint-failure" onPageRendered={onPageRendered} {...{ onPageRenderError }} />);
    await waitFor(() => expect(onPageRenderError).toHaveBeenCalledWith(1, error));
    expect(onPageRendered).not.toHaveBeenCalled();
  });

  it("retries with disableWorker:true on first load failure", async () => {
    mockRefreshAccessTokenForNonAxiosFlow.mockRejectedValue(new Error("refresh failed"));
    const mockPdf = createMockPdf(3);
    const destroyFn = vi.fn();
    mockGetDocument
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Worker failed")),
        destroy: destroyFn,
      })
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Query fallback failed")),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(mockPdf),
        destroy: vi.fn(),
      });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-retry"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(3));
    expect(mockGetDocument).toHaveBeenCalledTimes(3);
    // 1차 시도는 disableWorker: false
    expect(mockGetDocument.mock.calls[0][0]).toMatchObject({ disableWorker: false });
    // 2차 시도는 worker-on/query-token
    expect(mockGetDocument.mock.calls[1][0]).toMatchObject({ disableWorker: false });
    // 3차 시도는 worker-off/main-url
    expect(mockGetDocument.mock.calls[2][0]).toMatchObject({ disableWorker: true });
    // 1차 실패한 loadingTask가 destroy로 정리되었는지 확인
    expect(destroyFn).toHaveBeenCalled();
    expect(mockRefreshAccessTokenForNonAxiosFlow).toHaveBeenCalledTimes(1);
  });

  it("includes JWT Authorization header when access_token looks like JWT", async () => {
    mockRefreshAccessTokenForNonAxiosFlow.mockResolvedValue({ accessToken: "new-token" });
    const jwtToken = "eyJhbGciOi.eyJzdWIiOi.signature";
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((key: string) =>
        key === "access_token" ? jwtToken : null,
      );

    try {
      const mockPdf = createMockPdf(1);
      mockGetDocument.mockReturnValue({
        promise: Promise.resolve(mockPdf),
        destroy: vi.fn(),
      });

      const onDocumentLoad = vi.fn();
      render(
        <PdfChapterViewer
          {...baseProps}
          chapterId="chapter-jwt"
          onDocumentLoad={onDocumentLoad}
        />,
      );

      await waitFor(() => expect(onDocumentLoad).toHaveBeenCalled());
      expect(mockGetDocument.mock.calls[0][0]).toMatchObject({
        httpHeaders: { Authorization: `Bearer ${jwtToken}` },
      });
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it("does not include Authorization header when access_token is not JWT-like", async () => {
    mockRefreshAccessTokenForNonAxiosFlow.mockResolvedValue({ accessToken: "new-token" });
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((key: string) =>
        key === "access_token" ? "not-a-jwt" : null,
      );

    try {
      const mockPdf = createMockPdf(1);
      mockGetDocument.mockReturnValue({
        promise: Promise.resolve(mockPdf),
        destroy: vi.fn(),
      });

      const onDocumentLoad = vi.fn();
      render(
        <PdfChapterViewer
          {...baseProps}
          chapterId="chapter-no-jwt"
          onDocumentLoad={onDocumentLoad}
        />,
      );

      await waitFor(() => expect(onDocumentLoad).toHaveBeenCalled());
      expect(mockGetDocument.mock.calls[0][0]).not.toHaveProperty("httpHeaders");
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it("refreshes once and retries main URL successfully", async () => {
    const mockPdf = createMockPdf(2);
    mockRefreshAccessTokenForNonAxiosFlow.mockResolvedValue({ accessToken: "new-token" });
    mockGetDocument
      .mockReturnValueOnce({
        promise: Promise.reject(new Error("Unauthorized")),
        destroy: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve(mockPdf),
        destroy: vi.fn(),
      });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-refresh-success"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(2));
    expect(mockRefreshAccessTokenForNonAxiosFlow).toHaveBeenCalledTimes(1);
    expect(mockGetDocument).toHaveBeenCalledTimes(2);
    expect(mockGetDocument.mock.calls[0][0].url).not.toContain("?token=");
    expect(mockGetDocument.mock.calls[1][0].url).not.toContain("?token=");
  });

  it("falls back to query token URL after Authorization/main URL failure", async () => {
    const jwtToken = "eyJhbGciOi.eyJzdWIiOi.signature";
    const getItemSpy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation((key: string) =>
        key === "access_token" ? jwtToken : null,
      );

    try {
      const mockPdf = createMockPdf(4);
      mockRefreshAccessTokenForNonAxiosFlow.mockRejectedValue(new Error("refresh failed"));
      mockGetDocument
        .mockReturnValueOnce({
          promise: Promise.reject(new Error("401")),
          destroy: vi.fn(),
        })
        .mockReturnValueOnce({
          promise: Promise.resolve(mockPdf),
          destroy: vi.fn(),
        });

      const onDocumentLoad = vi.fn();
      render(
        <PdfChapterViewer
          {...baseProps}
          chapterId="chapter-query-fallback"
          onDocumentLoad={onDocumentLoad}
        />,
      );

      await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(4));
      expect(mockRefreshAccessTokenForNonAxiosFlow).toHaveBeenCalledTimes(1);
      expect(mockGetDocument.mock.calls[0][0].url).not.toContain("?token=");
      expect(mockGetDocument.mock.calls[1][0].url).toContain("?token=");
    } finally {
      getItemSpy.mockRestore();
    }
  });

  it("calls onDocumentLoad(0) when refresh fails and all fallbacks fail", async () => {
    mockRefreshAccessTokenForNonAxiosFlow.mockRejectedValue(new Error("refresh failed"));
    mockGetDocument
      .mockReturnValueOnce({ promise: Promise.reject(new Error("1")), destroy: vi.fn() })
      .mockReturnValueOnce({ promise: Promise.reject(new Error("2")), destroy: vi.fn() })
      .mockReturnValueOnce({ promise: Promise.reject(new Error("3")), destroy: vi.fn() })
      .mockReturnValueOnce({ promise: Promise.reject(new Error("4")), destroy: vi.fn() });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-refresh-final-fail"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(0));
    expect(mockRefreshAccessTokenForNonAxiosFlow).toHaveBeenCalledTimes(1);
  });
});

describe("PdfChapterViewer resize observer", () => {
  it("rerenders when container size changes from zero to valid size", async () => {
    mockPdfGetPage.mockResolvedValue(createMockPdfPage());
    mockGetDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: mockPdfGetPage,
        getOutline: vi.fn(async () => null),
      }),
      destroy: vi.fn(),
    });

    const onDocumentLoad = vi.fn();
    render(
      <PdfChapterViewer
        {...baseProps}
        chapterId="chapter-1"
        onDocumentLoad={onDocumentLoad}
      />,
    );

    await waitFor(() => expect(onDocumentLoad).toHaveBeenCalledWith(1));
    await waitFor(() => expect(MockResizeObserver.instances.length).toBeGreaterThan(0));

    const renderCallsBeforeResize = mockPdfGetPage.mock.calls.length;
    const container = screen.getByTestId("pdf-page-transition");
    Object.defineProperty(container, "clientWidth", { configurable: true, get: () => 480 });
    Object.defineProperty(container, "clientHeight", { configurable: true, get: () => 800 });

    vi.useFakeTimers();
    MockResizeObserver.instances[0]?.trigger(480, 800);
    vi.advanceTimersByTime(180);
    await vi.runOnlyPendingTimersAsync();
    vi.useRealTimers();

    await waitFor(() => {
      expect(mockPdfGetPage.mock.calls.length).toBeGreaterThan(renderCallsBeforeResize);
    });
  });
});
