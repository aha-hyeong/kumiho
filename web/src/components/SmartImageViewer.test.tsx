import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SmartImageViewer } from "./SmartImageViewer";

class ControlledImage {
  static cached = new Set<string>();
  static requests: ControlledImage[] = [];
  src = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  get complete() { return ControlledImage.cached.has(this.src); }
  get naturalWidth() { return this.complete ? 1200 : 0; }
  constructor() { ControlledImage.requests.push(this); }
}

beforeEach(() => {
  ControlledImage.cached.clear();
  ControlledImage.requests = [];
  vi.stubGlobal("Image", ControlledImage);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const requestFor = (src: string) => {
  const request = ControlledImage.requests.find((image) => image.src === src && image.onload);
  expect(request).toBeDefined();
  return request!;
};

describe("SmartImageViewer retained-image readiness", () => {
  it("does not report the new source as ready when the retained old image fires load or error", () => {
    const onVisualReady = vi.fn();
    const { rerender } = render(<SmartImageViewer src="page-a" onVisualReady={onVisualReady} alt="page" />);
    const image = screen.getByRole("img");
    fireEvent.load(image);
    onVisualReady.mockClear();
    rerender(<SmartImageViewer src="page-b" onVisualReady={onVisualReady} alt="page" />);
    expect(image).toHaveAttribute("src", "page-a");
    fireEvent.load(image);
    fireEvent.error(image);
    expect(onVisualReady).not.toHaveBeenCalled();
    act(() => requestFor("page-b").onload!());
    expect(image).toHaveAttribute("src", "page-b");
    fireEvent.load(image);
    expect(onVisualReady).toHaveBeenCalledTimes(1);
  });

  it("swaps a cached source before painting without a loading-opacity reset", () => {
    ControlledImage.cached.add("page-b");
    const { rerender } = render(<SmartImageViewer src="page-a" alt="page" />);
    const image = screen.getByRole("img");
    rerender(<SmartImageViewer src="page-b" alt="page" />);
    expect(screen.getByRole("img")).toBe(image);
    expect(image).toHaveAttribute("src", "page-b");
    expect(image).toHaveStyle({ opacity: 1 });
  });

  it("keeps an uncached old image until preload completes", () => {
    const { rerender } = render(<SmartImageViewer src="page-a" alt="page" />);
    const image = screen.getByRole("img");
    rerender(<SmartImageViewer src="page-b" alt="page" />);
    expect(image).toHaveAttribute("src", "page-a");
    act(() => requestFor("page-b").onload!());
    expect(image).toHaveAttribute("src", "page-b");
    expect(image).toHaveStyle({ opacity: 1 });
  });

  it("ignores a stale preload completion after another navigation", () => {
    const { rerender } = render(<SmartImageViewer src="page-a" alt="page" />);
    rerender(<SmartImageViewer src="page-b" alt="page" />);
    const stale = requestFor("page-b");
    rerender(<SmartImageViewer src="page-c" alt="page" />);
    act(() => requestFor("page-c").onload!());
    act(() => stale.onload!());
    expect(screen.getByRole("img")).toHaveAttribute("src", "page-c");
  });

  it("settles failures but does not treat a broken cached image as ready", () => {
    vi.spyOn(ControlledImage.prototype, "complete", "get").mockReturnValue(true);
    vi.spyOn(ControlledImage.prototype, "naturalWidth", "get").mockReturnValue(0);
    const onVisualReady = vi.fn();
    const { rerender } = render(<SmartImageViewer src="page-a" onVisualReady={onVisualReady} alt="page" />);
    rerender(<SmartImageViewer src="page-b" onVisualReady={onVisualReady} alt="page" />);
    const image = screen.getByRole("img");
    expect(image).toHaveAttribute("src", "page-a");
    act(() => requestFor("page-b").onerror!());
    fireEvent.error(image);
    expect(onVisualReady).toHaveBeenCalledTimes(1);
    expect(image).toHaveStyle({ opacity: 1 });
  });
});
