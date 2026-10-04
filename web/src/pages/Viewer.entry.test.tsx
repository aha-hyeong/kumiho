import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { ViewerPage } from "./Viewer";

const loader = vi.fn();
vi.mock("../features/viewer", () => ({ useChapterLoader: (...args: unknown[]) => loader(...args) }));
vi.mock("../stores/viewerStore", () => ({ useViewerStore: () => vi.fn() }));
vi.mock("../stores/epubViewerStore", () => ({ useEpubViewerStore: () => vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./ImageViewerRoute", () => ({
  ImageViewerRoute: () => <div data-testid="viewer-background"><main data-viewer-content>Image page</main></div>,
}));
vi.mock("./PdfViewerRoute", () => ({
  PdfViewerRoute: ({ onContentReady, loaderData }: { onContentReady?: (chapterId: string) => void; loaderData: { chapter: { id: string } } }) => {
    const [failed, setFailed] = useState(false);
    return failed ? <div role="alert">failed PDF</div> : (
      <main data-viewer-content>PDF page<button onClick={() => onContentReady?.(loaderData.chapter.id)}>canvas ready</button><button onClick={() => setFailed(true)}>fail PDF</button></main>
    );
  },
}));
vi.mock("./EpubViewerRoute", () => ({ EpubViewerRoute: () => <main data-viewer-content>EPUB page</main> }));

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
const cancel = vi.fn();
const animate = vi.fn(() => ({ cancel }));
const tree = () => (
  <MemoryRouter initialEntries={["/viewer/chapter-1"]}>
    <Routes><Route path="/viewer/:chapterId" element={<ViewerPage />} /></Routes>
  </MemoryRouter>
);

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(Element.prototype, "animate");
});

describe("Viewer entry motion", () => {
  it.each(["cbz", "pdf", "epub", "txt"])("enters a fresh %s visit and cancels safely when leaving", (extension) => {
    loader.mockReturnValue({ chapter: { id: "chapter-1", path: `/sample.${extension}` }, isLoading: false, error: null, viewStatus: "ready" });
    const first = render(tree());
    if (extension === "pdf") fireEvent.click(screen.getByText("canvas ready"));
    expect(animate).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(cancel).toHaveBeenCalledTimes(1);
    render(tree());
    if (extension === "pdf") fireEvent.click(screen.getByText("canvas ready"));
    expect(animate).toHaveBeenCalledTimes(2);
  });

  it("does not consume PDF entry until the restored canvas is painted", () => {
    loader.mockReturnValue({ chapter: { id: "chapter-1", path: "/sample.pdf" }, isLoading: false, error: null, viewStatus: "ready" });
    render(tree());
    expect(animate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("canvas ready"));
    expect(animate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("canvas ready"));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("does not animate a failed load", () => {
    loader.mockReturnValue({ chapter: null, isLoading: false, error: "failed", viewStatus: "ready" });
    render(tree());
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText("viewer.error.load_failed")).toBeInTheDocument();
  });

  it("does not carry a terminal PDF failure into another chapter", () => {
    const data = { chapter: { id: "chapter-1", path: "/sample.pdf" }, isLoading: false, error: null, viewStatus: "ready" };
    loader.mockReturnValue(data);
    const view = render(tree());
    fireEvent.click(screen.getByText("fail PDF"));
    view.rerender(tree());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(animate).not.toHaveBeenCalled();
    loader.mockReturnValue({ ...data, chapter: { id: "chapter-2", path: "/next.pdf" } });
    view.rerender(tree());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("canvas ready"));
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("skips entry for reduced motion without replaying later in the same visit", () => {
    const data = { chapter: { id: "chapter-1", path: "/sample.epub" }, isLoading: false, error: null, viewStatus: "ready" };
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    loader.mockReturnValue(data);
    const view = render(tree());
    expect(animate).not.toHaveBeenCalled();
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
    loader.mockReturnValue({ ...data, viewStatus: "rendering" });
    view.rerender(tree());
    loader.mockReturnValue(data);
    view.rerender(tree());
    expect(animate).not.toHaveBeenCalled();
  });

  it("keeps a live entry after StrictMode rehearses ready-on-mount effects", () => {
    loader.mockReturnValue({ chapter: { id: "chapter-1", path: "/sample.cbz" }, isLoading: false, error: null, viewStatus: "ready" });
    const view = render(<StrictMode>{tree()}</StrictMode>);
    expect(animate).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("does not replay during reading or after another chapter becomes ready", () => {
    const data = { chapter: { id: "chapter-1", path: "/sample.cbz" }, isLoading: false, error: null, viewStatus: "ready" };
    loader.mockReturnValue(data);
    const view = render(tree());
    expect(animate).toHaveBeenCalledTimes(1);
    view.rerender(tree());
    expect(animate).toHaveBeenCalledTimes(1);

    loader.mockReturnValue({ ...data, viewStatus: "rendering" });
    view.rerender(tree());
    loader.mockReturnValue({ ...data, chapter: { id: "chapter-2", path: "/next.pdf" } });
    view.rerender(tree());
    expect(screen.getByText("PDF page", { exact: false })).toBeInTheDocument();
    expect(animate).toHaveBeenCalledTimes(1);
  });

  it("waits for the restored page to be ready before fading only its content", () => {
    const data = { chapter: { id: "chapter-1", path: "/sample.cbz" }, isLoading: false, error: null, viewStatus: "rendering" };
    loader.mockReturnValue(data);
    const view = render(tree());
    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByText("common.loading")).toBeInTheDocument();

    loader.mockReturnValue({ ...data, viewStatus: "ready" });
    view.rerender(tree());
    expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
    expect(animate).toHaveBeenCalledExactlyOnceWith(
      [{ opacity: 0.45 }, { opacity: 1 }],
      { duration: 180, easing: "ease-out", id: "viewer-entry" },
    );
    expect(animate.mock.contexts[0]).toBe(screen.getByText("Image page"));
    expect(animate.mock.contexts[0]).not.toBe(screen.getByTestId("viewer-background"));
  });
});
