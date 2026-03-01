import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { PdfChapterViewer } from "./index";

let mockIsZoomed = false;
let mockAnimateNext = vi.fn();
let mockAnimatePrev = vi.fn();

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {
    workerSrc: "",
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
  useSwipe: () => ({
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
    swipeOffset: 0,
    isAnimating: false,
    animateNext: mockAnimateNext,
    animatePrev: mockAnimatePrev,
  }),
}));

vi.mock("../PageTransition", () => ({
  PageTransition: ({ children, onWheel }: { children: ReactNode; onWheel?: (e: React.WheelEvent) => void }) => (
    <div
      data-testid="pdf-page-transition"
      onWheel={onWheel}
    >
      {children}
    </div>
  ),
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

afterEach(() => {
  mockIsZoomed = false;
  mockAnimateNext = vi.fn();
  mockAnimatePrev = vi.fn();
  vi.restoreAllMocks();
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
