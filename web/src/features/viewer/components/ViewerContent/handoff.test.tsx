import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRef, useState, type ReactNode } from "react";
import { ViewerContent } from "./index";
import type { PageMeta, ViewerAnimationHandles } from "../../types";
import { getDisplayPages, getNextNavState, getPrevNavState, getNextTargetPage, getPrevTargetPage } from "../../../../utils/pageCalculator";
import type { PageTransitionType, ReadingDirection, ReadingMode } from "../../../../stores/viewerStore";
import styles from "../../../../pages/Viewer.module.css";

vi.mock("react-zoom-pan-pinch", () => ({
  TransformWrapper: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TransformComponent: ({ children }: { children: ReactNode }) => <div className="react-transform-component">{children}</div>,
}));

const url = (page: number) => `/api/v1/chapters/chapter-a/pages/${page}/image`;
class ControlledImage {
  static cached = new Set<string>();
  static requests: ControlledImage[] = [];
  static pending = new Map<string, (() => void)[]>();
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { ControlledImage.requests.push(this); }
  get complete() { return ControlledImage.cached.has(this.src); }
  get naturalWidth() { return this.complete ? 900 : 0; }
  decode() {
    if (this.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const pending = ControlledImage.pending.get(this.src) ?? [];
      pending.push(resolve);
      ControlledImage.pending.set(this.src, pending);
    });
  }
  static ready(src: string) {
    ControlledImage.cached.add(src);
    ControlledImage.requests.filter((image) => image.src === src).forEach((image) => image.onload?.());
    ControlledImage.pending.get(src)?.forEach((resolve) => resolve());
    ControlledImage.pending.delete(src);
  }
}
function Harness({ mode = "single", direction = "ltr", offset = 0, wide = [], chapterId = "chapter-a", transition = "slide", initialLoading, onReady }: {
  mode?: ReadingMode; direction?: ReadingDirection; offset?: number; wide?: number[]; chapterId?: string; transition?: PageTransitionType; initialLoading?: Record<number, boolean>; onReady?: (page: number) => void;
}) {
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(initialLoading ?? Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, false])));
  const [subPage, setSubPage] = useState<"left" | "right" | null>(null);
  const ref = useRef<ViewerAnimationHandles>(null);
  const meta = new Map<number, PageMeta>(wide.map((p) => [p, { pageNumber: p, width: 1800, height: 1300, isWide: true }]));
  const pages = (p: number) => p < 1 || p > 8 ? [] : getDisplayPages({ currentPage: p, totalPages: 8, readingMode: mode, pageOffset: offset, pageMetaMap: meta });
  const next = mode === "single" ? getNextNavState(page, 8, subPage, meta, direction) : { page: getNextTargetPage(page, 8, mode, meta), subPage: null };
  const prev = mode === "single" ? getPrevNavState(page, subPage, meta, direction) : { page: getPrevTargetPage(page, mode, meta), subPage: null };
  return <>
    <output data-testid="page">{page}</output>
    <button onClick={() => ref.current?.animateNext()}>next</button>
    <button onClick={() => ref.current?.animatePrev()}>prev</button>
    <ViewerContent ref={ref} currentPage={page} readingMode={mode} readingDirection={direction} clickDirection={direction}
      wheelDirection="down" fitMode="screen" displayPages={pages(page)} prevDisplayPages={pages(prev?.page ?? -1)}
      nextDisplayPages={pages(next?.page ?? -1)} chapterId={chapterId} totalPages={8} maxAllowedPage={8}
      subPage={subPage} nextPreviewSubPage={next?.subPage} prevPreviewSubPage={prev?.subPage} pageMetaMap={meta}
      // Background loading state alone is not proof that the target visual is ready.
      imageLoading={loading} handleImageLoad={(p) => { onReady?.(p); setLoading((previous) => ({ ...previous, [p]: false })); }}
      onNext={() => { if (next) { setPage(next.page); setSubPage(next.subPage); } }}
      onPrev={() => { if (prev) { setPage(prev.page); setSubPage(prev.subPage); } }} transitionType={transition} />
  </>;
}
beforeEach(() => {
  vi.useFakeTimers();
  ControlledImage.cached = new Set([url(1), url(3)]);
  ControlledImage.requests = [];
  ControlledImage.pending.clear();
  vi.stubGlobal("Image", ControlledImage);
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("non-vertical viewer visual handoff", () => {
  it("does not recenter the retained old image when the target decode outlasts the slide", async () => {
    const { container } = render(<Harness />);
    const currentImage = container.querySelector(".react-transform-component img");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(currentImage).toHaveAttribute("src", url(1));
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("2");
    expect(container.querySelector(".react-transform-component img")).toBe(currentImage);
    expect(currentImage).toHaveAttribute("src", url(2));
  });

  it.each([0, 1, 299, 300, 301, 1000])("keeps page/visual identity atomic when B decode settles at %dms", async (delay) => {
    const { container } = render(<Harness />);
    const image = container.querySelector(".react-transform-component img");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => { vi.advanceTimersByTime(delay); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("2");
    expect(container.querySelector(".react-transform-component img")).toBe(image);
    expect(image).toHaveAttribute("src", url(2));
  });

  it.each(["slide", "fade", "none"] as const)("retains the current DOM node for cached B with %s", async (transition) => {
    ControlledImage.cached.add(url(2));
    const { container } = render(<Harness transition={transition} />);
    const image = container.querySelector(".react-transform-component img");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(container.querySelector(".react-transform-component img")).toBe(image);
    expect(image).toHaveAttribute("src", url(2));
  });

  it("commits a decoded cached source without an animation delay when transition is none", async () => {
    ControlledImage.cached.add(url(2));
    const { container } = render(<Harness transition="none" />);
    const image = container.querySelector(".react-transform-component img");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(screen.getByTestId("page")).toHaveTextContent("2");
    expect(image).toHaveAttribute("src", url(2));
    expect(container.querySelector(".react-transform-component img")).toBe(image);
  });

  it.each(["ltr", "rtl"] as const)("waits for both spread visuals, even if only the trailing image is late (%s)", async (direction) => {
    [1, 2, 3].forEach((p) => ControlledImage.cached.add(url(p)));
    const { container } = render(<Harness mode="double" direction={direction} />);
    const images = [...container.querySelectorAll(".react-transform-component img")];
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    await act(async () => { ControlledImage.ready(url(4)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("3");
    expect([...container.querySelectorAll(".react-transform-component img")]).toEqual(images);
    images.forEach((image, i) => expect(image).toHaveAttribute("src", url(i + 3)));
  });

  it.each([0, 1])("preserves spread/offset %d and leading slots across wide → normal → wide", async (offset) => {
    [1, 2, 3, 4, 5, 6, 7, 8].forEach((p) => ControlledImage.cached.add(url(p)));
    const { container } = render(<Harness mode="double" offset={offset} wide={[1, 4]} />);
    const leading = container.querySelector(".react-transform-component img");
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: "next" }));
      await act(async () => {});
      await act(async () => { vi.advanceTimersByTime(300); });
      expect(container.querySelector(".react-transform-component img")).toBe(leading);
      container.querySelectorAll(".react-transform-component img").forEach((image) => {
        const page = Number(image.closest("[id^=page-]")?.id.slice(5));
        expect(image).toHaveAttribute("src", url(page));
      });
    }
  });

  it.each(["fade", "none"] as const)("publishes decoded spread readiness before %s handoff instead of hiding both prepared images", async (transition) => {
    [1, 2, 3].forEach((p) => ControlledImage.cached.add(url(p)));
    const { container } = render(<Harness mode="double" transition={transition} initialLoading={{ 1: false, 2: false, 3: true, 4: true }} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => { ControlledImage.ready(url(4)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("3");
    container.querySelectorAll(".react-transform-component img").forEach((image) => {
      expect(image).not.toHaveClass(styles.hidden);
      expect(image.parentElement).not.toHaveClass(styles.hidden);
    });
  });

  it("coalesces rapid A → B requests and then commits cached C exactly once", async () => {
    const { container } = render(<Harness />);
    const image = container.querySelector(".react-transform-component img");
    const next = screen.getByRole("button", { name: "next" });
    act(() => { next.click(); next.click(); next.click(); });
    expect(ControlledImage.pending.get(url(2))).toHaveLength(1);
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(image).toHaveAttribute("src", url(2));
    fireEvent.click(next);
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(image).toHaveAttribute("src", url(3));
    expect(container.querySelector(".react-transform-component img")).toBe(image);
  });

  it("preserves A → B → A source identity without remounting", async () => {
    const { container } = render(<Harness />);
    const image = container.querySelector(".react-transform-component img");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(300); });
    fireEvent.click(screen.getByRole("button", { name: "prev" }));
    await act(async () => {});
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
    expect(container.querySelector(".react-transform-component img")).toBe(image);
    expect(image).toHaveAttribute("src", url(1));
  });

  it("cancels pending spread preparation when page offset changes without a page change", async () => {
    [1, 2, 3].forEach((p) => ControlledImage.cached.add(url(p)));
    const { rerender } = render(<Harness mode="double" offset={0} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    rerender(<Harness mode="double" offset={1} />);
    await act(async () => { ControlledImage.ready(url(4)); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
  });

  it("does not publish stale preparation readiness after chapter A → B → A", async () => {
    const onReady = vi.fn();
    const { rerender } = render(<Harness onReady={onReady} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    rerender(<Harness chapterId="chapter-b" onReady={onReady} />);
    rerender(<Harness chapterId="chapter-a" onReady={onReady} />);
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(onReady).not.toHaveBeenCalled();
    expect(screen.getByTestId("page")).toHaveTextContent("1");
  });

  it("ignores the previous chapter's pending preparation after chapter replacement", async () => {
    const { rerender } = render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    rerender(<Harness chapterId="chapter-b" />);
    await act(async () => { ControlledImage.ready(url(2)); });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByTestId("page")).toHaveTextContent("1");
  });
});
