import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef, useState, type ComponentProps, type ReactNode } from "react";
import { ViewerContent } from "./index";
import { getDisplayPages } from "../../../../utils/pageCalculator";
import { getPageImageUrl } from "../../utils/imageUrl";
import type { PageMeta, ViewerAnimationHandles } from "../../types";

// Keep the actual image hook, transition, swipe hook and CSS; only isolate zoom.
vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TransformComponent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
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

class PendingImage {
  static requests: PendingImage[] = [];
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    PendingImage.requests.push(this);
  }
}

const props: ComponentProps<typeof ViewerContent> = {
  readingMode: "single",
  readingDirection: "ltr",
  clickDirection: "ltr",
  wheelDirection: "down",
  fitMode: "screen",
  displayPages: [1],
  chapterId: "chapter-a",
  totalPages: 10,
  maxAllowedPage: 10,
  imageLoading: { 1: false, 2: false, 3: false, 4: false, 5: false, 6: false },
  handleImageLoad: vi.fn(),
  onNext: vi.fn(),
  onPrev: vi.fn(),
  transitionType: "slide",
};

beforeEach(() => {
  PendingImage.requests = [];
  vi.stubGlobal("Image", PendingImage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function finishImage(page: number) {
  const request = PendingImage.requests.find((image) => image.src === getPageImageUrl("chapter-a", page) && image.onload);
  expect(request).toBeDefined();
  act(() => request!.onload!());
}

const meta = (page: number): PageMeta => ({ pageNumber: page, width: 2600, height: 1600, isWide: true });

describe("ViewerContent image slot lifecycle", () => {
  it.each(["ltr", "rtl"] as const)("retains a single %s image until the replacement is loaded", (readingDirection) => {
    const { rerender } = render(<ViewerContent {...props} readingDirection={readingDirection} />);
    const image = screen.getByRole("img", { name: "페이지 1" });
    rerender(<ViewerContent {...props} readingDirection={readingDirection} displayPages={[2]} />);
    expect(screen.getByRole("img", { name: "페이지 2" })).toBe(image);
    expect(image).toHaveAttribute("src", getPageImageUrl("chapter-a", 1));
    finishImage(2);
    expect(image).toHaveAttribute("src", getPageImageUrl("chapter-a", 2));
  });

  it.each([
    { pageOffset: 0, currentPage: 2, nextPage: 4, readingDirection: "ltr" as const },
    { pageOffset: 0, currentPage: 2, nextPage: 4, readingDirection: "rtl" as const },
    { pageOffset: 1, currentPage: 3, nextPage: 5, readingDirection: "ltr" as const },
    { pageOffset: 1, currentPage: 3, nextPage: 5, readingDirection: "rtl" as const },
  ])("reuses both logical slots for offset $pageOffset / $readingDirection", ({ pageOffset, currentPage, nextPage, readingDirection }) => {
    const calculate = (page: number) => getDisplayPages({ currentPage: page, totalPages: 10, readingMode: "double", pageOffset, pageMetaMap: new Map() });
    const original = calculate(currentPage);
    const next = calculate(nextPage);
    const { rerender } = render(<ViewerContent {...props} readingMode="double" readingDirection={readingDirection} displayPages={original} />);
    const images = screen.getAllByRole("img");
    rerender(<ViewerContent {...props} readingMode="double" readingDirection={readingDirection} displayPages={next} />);
    screen.getAllByRole("img").forEach((image, index) => expect(image).toBe(images[index]));
    next.forEach((page, index) => {
      expect(images[index]).toHaveAttribute("src", getPageImageUrl("chapter-a", original[index]));
      finishImage(page);
    });
    rerender(<ViewerContent {...props} readingMode="double" readingDirection={readingDirection} displayPages={original} />);
    screen.getAllByRole("img").forEach((image, index) => expect(image).toBe(images[index]));
  });

  it("resets image instances on chapter changes, including the same page number", () => {
    const { rerender } = render(<ViewerContent {...props} />);
    const original = screen.getByRole("img");
    rerender(<ViewerContent {...props} chapterId="chapter-b" />);
    const replacement = screen.getByRole("img");
    expect(replacement).not.toBe(original);
    expect(replacement).toHaveAttribute("src", getPageImageUrl("chapter-b", 1));
    expect(original).not.toBeInTheDocument();
  });

  it("does not reuse a single-mode image as a double-mode slot", () => {
    const { rerender } = render(<ViewerContent {...props} />);
    const original = screen.getByRole("img");
    rerender(<ViewerContent {...props} readingMode="double" displayPages={[1, 2]} />);
    expect(screen.getByRole("img", { name: "페이지 1" })).not.toBe(original);
  });

  it.each(["none", "fade"] as const)("retains the image slot for %s transitions", (transitionType) => {
    const { rerender } = render(<ViewerContent {...props} transitionType={transitionType} />);
    const original = screen.getByRole("img");
    rerender(<ViewerContent {...props} transitionType={transitionType} displayPages={[2]} />);
    expect(screen.getByRole("img")).toBe(original);
    expect(original).toHaveAttribute("src", getPageImageUrl("chapter-a", 1));
  });

  it("keeps the cover slot when offset-one expands to a spread", () => {
    const { rerender } = render(<ViewerContent {...props} readingMode="double" />);
    const original = screen.getByRole("img");
    rerender(<ViewerContent {...props} readingMode="double" displayPages={[2, 3]} />);
    expect(screen.getAllByRole("img")[0]).toBe(original);
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(original.closest("[id='page-2']")?.className).not.toContain("singleWide");
  });

  it.each(["ltr", "rtl"] as const)("keeps the leading %s slot through spread / wide / spread", (readingDirection) => {
    const pageMetaMap = new Map([[3, meta(3)]]);
    const common = { ...props, readingMode: "double" as const, readingDirection, pageMetaMap };
    const { rerender } = render(<ViewerContent {...common} displayPages={[1, 2]} />);
    const [leading, trailing] = screen.getAllByRole("img");
    rerender(<ViewerContent {...common} displayPages={[3]} />);
    expect(screen.getByRole("img")).toBe(leading);
    expect(trailing).not.toBeInTheDocument();
    expect(leading.closest("[id='page-3']")?.className).toContain("singleWide");
    finishImage(3);
    rerender(<ViewerContent {...common} displayPages={[5, 6]} />);
    const [newLeading, newTrailing] = screen.getAllByRole("img");
    expect(newLeading).toBe(leading);
    expect(newTrailing).not.toBe(trailing);
    expect(leading.closest("[id='page-5']")?.className).not.toContain("singleWide");
  });

  it.each(["next", "prev"] as const)("retains the current slot when a real %s slide finishes", (direction) => {
    vi.useFakeTimers();
    const ref = createRef<ViewerAnimationHandles>();
    function Harness() {
      const [page, setPage] = useState(2);
      return <ViewerContent {...props} ref={ref} displayPages={[page]} prevDisplayPages={[page - 1]} nextDisplayPages={[page + 1]} onNext={() => setPage((value) => value + 1)} onPrev={() => setPage((value) => value - 1)} />;
    }
    const { container } = render(<Harness />);
    // Slide's next, previous and current containers are independent image trees.
    const slots = container.firstElementChild!.firstElementChild!.children;
    const nextSlot = slots[0] as HTMLElement;
    const prevSlot = slots[1] as HTMLElement;
    const currentSlot = slots[2] as HTMLElement;
    const current = within(currentSlot).getByRole("img");
    const nextImage = within(nextSlot).getByRole("img");
    const prevImage = within(prevSlot).getByRole("img");
    const preview = screen.getByRole("img", { name: direction === "next" ? "페이지 3" : "페이지 1" });
    act(() => direction === "next" ? ref.current!.animateNext() : ref.current!.animatePrev());
    expect(preview).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(300));
    expect(within(currentSlot).getByRole("img")).toBe(current);
    expect(within(currentSlot).getByRole("img")).not.toBe(preview);
    expect(within(nextSlot).getByRole("img")).toBe(nextImage);
    expect(within(prevSlot).getByRole("img")).toBe(prevImage);
    expect(container.firstElementChild!.firstElementChild).toHaveStyle({ transform: "translateX(0px)" });
  });
});

describe("ViewerContent actual opacity policy", () => {
  it("hides both image containers until the spread is ready, despite inline img opacity", () => {
    const { rerender } = render(<ViewerContent {...props} readingMode="double" displayPages={[1, 2]} imageLoading={{ 1: false, 2: true }} />);
    const images = screen.getAllByRole("img");
    images.forEach((image) => {
      expect(image).toHaveStyle({ opacity: 1 });
      expect(getComputedStyle(image.parentElement!).opacity).toBe("0");
    });
    fireEvent.load(images[1]);
    rerender(<ViewerContent {...props} readingMode="double" displayPages={[1, 2]} imageLoading={{ 1: false, 2: false }} />);
    images.forEach((image) => expect(getComputedStyle(image.parentElement!).opacity).not.toBe("0"));
  });
});
