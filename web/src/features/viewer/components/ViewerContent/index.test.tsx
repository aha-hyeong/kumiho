import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { ViewerContent } from "./index";

vi.mock("../../../../pages/Viewer.module.css", () => ({
  default: new Proxy(
    {},
    {
      get: (_, key) => String(key),
    },
  ),
}));

vi.mock("../../../../components/SmartImageViewer", () => ({
  SmartImageViewer: ({ src, className }: { src: string; className?: string }) => (
    <img
      data-testid={`smart-${src}`}
      className={className}
      alt="mock-smart-image"
    />
  ),
}));

let mockIsZoomed = false;
let mockAnimateNext = vi.fn();
let mockAnimatePrev = vi.fn();

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
      data-testid="page-transition"
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
  readingMode: "double" as const,
  readingDirection: "ltr" as const,
  clickDirection: "ltr" as const,
  wheelDirection: "down" as const,
  fitMode: "screen",
  displayPages: [1, 2],
  chapterId: "chapter-1",
  totalPages: 10,
  maxAllowedPage: 10,
  handleImageLoad: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
  transitionType: "slide" as const,
};

afterEach(() => {
  mockIsZoomed = false;
  mockAnimateNext = vi.fn();
  mockAnimatePrev = vi.fn();
  vi.restoreAllMocks();
});

describe("ViewerContent double-mode visibility policy", () => {
  it("shows spread when both pages are loaded", () => {
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    const left = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/1/image");
    const right = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/2/image");

    expect(left).not.toHaveClass("hidden");
    expect(right).not.toHaveClass("hidden");
  });

  it("keeps spread hidden when one page is still loading", () => {
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: true }}
      />,
    );

    const left = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/1/image");
    const right = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/2/image");

    expect(left).toHaveClass("hidden");
    expect(right).toHaveClass("hidden");
  });

  it("keeps spread hidden when one page is undefined", () => {
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false }}
      />,
    );

    const left = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/1/image");
    const right = screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/2/image");

    expect(left).toHaveClass("hidden");
    expect(right).toHaveClass("hidden");
  });
});

describe("ViewerContent wheel navigation", () => {
  it("moves next on wheel down when wheelDirection is down", () => {
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    fireEvent.wheel(screen.getByTestId("page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(1);
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("moves prev on wheel down when wheelDirection is up", () => {
    render(
      <ViewerContent
        {...baseProps}
        wheelDirection="up"
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    fireEvent.wheel(screen.getByTestId("page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimatePrev).toHaveBeenCalledTimes(1);
    expect(mockAnimateNext).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation with ctrl key pressed", () => {
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    fireEvent.wheel(screen.getByTestId("page-transition"), { deltaY: 100, ctrlKey: true });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("ignores wheel navigation when zoomed", () => {
    mockIsZoomed = true;
    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    fireEvent.wheel(screen.getByTestId("page-transition"), { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).not.toHaveBeenCalled();
    expect(mockAnimatePrev).not.toHaveBeenCalled();
  });

  it("throttles rapid wheel events", () => {
    const dateNow = vi.spyOn(Date, "now");
    dateNow.mockReturnValueOnce(1000).mockReturnValueOnce(1100).mockReturnValueOnce(1300);

    render(
      <ViewerContent
        {...baseProps}
        imageLoading={{ 1: false, 2: false }}
      />,
    );

    const container = screen.getByTestId("page-transition");
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });
    fireEvent.wheel(container, { deltaY: 100, deltaX: 0 });

    expect(mockAnimateNext).toHaveBeenCalledTimes(2);
  });
});
