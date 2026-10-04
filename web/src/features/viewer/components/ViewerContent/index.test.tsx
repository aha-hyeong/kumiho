import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { ReactNode } from "react";
import { ViewerContent } from "./index";
import type { PageMeta } from "../../types";

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

const mockTouch = vi.hoisted(() => ({ start: vi.fn(), move: vi.fn(), end: vi.fn(), params: vi.fn() }));
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
  useSwipe: (params: unknown) => {
    mockTouch.params(params);
    return ({
    onTouchStart: mockTouch.start,
    onTouchMove: mockTouch.move,
    onTouchEnd: mockTouch.end,
    swipeOffset: 0,
    isAnimating: false,
    animateNext: mockAnimateNext,
    animatePrev: mockAnimatePrev,
    });
  },
}));

vi.mock("../PageTransition", () => ({
  PageTransition: ({ children, onWheel, onTouchStart, onTouchMove, onTouchEnd }: { children: ReactNode; onWheel?: (e: React.WheelEvent) => void; onTouchStart?: (e: React.TouchEvent) => void; onTouchMove?: (e: React.TouchEvent) => void; onTouchEnd?: (e: React.TouchEvent) => void }) => (
    <div
      data-testid="page-transition"
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
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

const createPageMetaMap = (isWide: boolean): Map<number, PageMeta> =>
  new Map([
    [
      1,
      {
        pageNumber: 1,
        width: isWide ? 2600 : 1200,
        height: 1600,
        isWide,
      },
    ],
  ]);

afterEach(() => {
  Object.values(mockTouch).forEach((mock) => mock.mockClear());
  mockIsZoomed = false;
  mockAnimateNext = vi.fn();
  mockAnimatePrev = vi.fn();
  vi.restoreAllMocks();
});

describe("ViewerContent swipe integration", () => {
  it("passes swipe direction separately and attaches horizontal gestures", () => {
    render(<ViewerContent {...baseProps} swipeDirection="rtl" imageLoading={{ 1: false, 2: false }} />);
    expect(mockTouch.params).toHaveBeenLastCalledWith(expect.objectContaining({ readingDirection: "ltr", swipeDirection: "rtl" }));
    const el = screen.getByTestId("page-transition");
    fireEvent.touchStart(el); fireEvent.touchMove(el); fireEvent.touchEnd(el);
    expect(mockTouch.start).toHaveBeenCalledTimes(1); expect(mockTouch.move).toHaveBeenCalledTimes(1); expect(mockTouch.end).toHaveBeenCalledTimes(1);
  });

  it("does not attach horizontal swipe gestures in vertical mode", () => {
    const { container } = render(<ViewerContent {...baseProps} readingMode="vertical" swipeDirection="rtl" imageLoading={{}} />);
    container.querySelectorAll("div").forEach((el) => { fireEvent.touchStart(el); fireEvent.touchMove(el); fireEvent.touchEnd(el); });
    expect(mockTouch.start).not.toHaveBeenCalled(); expect(mockTouch.move).not.toHaveBeenCalled(); expect(mockTouch.end).not.toHaveBeenCalled();
  });
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

describe("ViewerContent vertical rendering window", () => {
  it("renders real images only near current page in vertical mode", () => {
    render(
      <ViewerContent
        {...baseProps}
        currentPage={10}
        readingMode="vertical"
        displayPages={Array.from({ length: 20 }, (_, i) => i + 1)}
        maxAllowedPage={13}
        imageLoading={{}}
      />,
    );

    // currentPage=10 -> minAllowedPage=7, maxAllowedPage=13
    // page 6 should remain placeholder (no SmartImageViewer render)
    expect(screen.queryByTestId("smart-/api/v1/chapters/chapter-1/pages/6/image")).not.toBeInTheDocument();
    // page 7 and 13 should be rendered
    expect(screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/7/image")).toBeInTheDocument();
    expect(screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/13/image")).toBeInTheDocument();
    // page 14 should remain placeholder
    expect(screen.queryByTestId("smart-/api/v1/chapters/chapter-1/pages/14/image")).not.toBeInTheDocument();
  });

  it("renders all pages during initial restore (hidden by CSS until ready)", () => {
    render(
      <ViewerContent
        {...baseProps}
        currentPage={1}
        readingMode="vertical"
        displayPages={Array.from({ length: 10 }, (_, i) => i + 1)}
        maxAllowedPage={10}
        imageLoading={{}}
        isInitialScrolling
        viewStatus="hydrating"
      />,
    );

    // All pages should be in the DOM during hydrating (content is visually hidden by viewerContentHidden CSS)
    // This prevents scroll position shifts when transitioning from hydrating to ready
    expect(screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/1/image")).toBeInTheDocument();
    expect(screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/2/image")).toBeInTheDocument();
    expect(screen.getByTestId("smart-/api/v1/chapters/chapter-1/pages/3/image")).toBeInTheDocument();
  });
});

describe("ViewerContent split rendering", () => {
  it("applies splitLeft class for wide page with left subPage", () => {
    const { container } = render(
      <ViewerContent
        {...baseProps}
        readingMode="single"
        displayPages={[1]}
        subPage="left"
        pageMetaMap={createPageMetaMap(true)}
        imageLoading={{ 1: false }}
      />,
    );

    const wrapper = container.querySelector("#page-1");
    expect(wrapper).toHaveClass("splitLeft");
    expect(wrapper).not.toHaveClass("splitRight");
  });

  it("applies splitRight class for wide page with right subPage", () => {
    const { container } = render(
      <ViewerContent
        {...baseProps}
        readingMode="single"
        displayPages={[1]}
        subPage="right"
        pageMetaMap={createPageMetaMap(true)}
        imageLoading={{ 1: false }}
      />,
    );

    const wrapper = container.querySelector("#page-1");
    expect(wrapper).toHaveClass("splitRight");
    expect(wrapper).not.toHaveClass("splitLeft");
  });

  it("does not apply split classes for non-wide page", () => {
    const { container } = render(
      <ViewerContent
        {...baseProps}
        readingMode="single"
        displayPages={[1]}
        subPage="left"
        pageMetaMap={createPageMetaMap(false)}
        imageLoading={{ 1: false }}
      />,
    );

    const wrapper = container.querySelector("#page-1");
    expect(wrapper).not.toHaveClass("splitLeft");
    expect(wrapper).not.toHaveClass("splitRight");
  });
});
