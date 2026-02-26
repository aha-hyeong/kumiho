import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../../hooks/useViewerZoom", () => ({
  useViewerZoom: () => ({
    transformComponentRef: { current: null },
    isZoomed: false,
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
    animateNext: vi.fn(),
    animatePrev: vi.fn(),
  }),
}));

vi.mock("../PageTransition", () => ({
  PageTransition: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TransformComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const baseProps = {
  readingMode: "double" as const,
  readingDirection: "ltr" as const,
  clickDirection: "ltr" as const,
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
