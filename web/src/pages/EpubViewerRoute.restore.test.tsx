import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { EpubViewerRoute } from "./EpubViewerRoute";
import { useEpubViewerStore } from "../stores/epubViewerStore";

const mocks = vi.hoisted(() => ({
  epub: vi.fn(),
  getProgress: vi.fn(),
  updateProgress: vi.fn(),
}));

vi.mock("epubjs", () => ({ default: mocks.epub }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../api/client", () => ({
  api: { get: vi.fn(async () => ({ data: new Blob(["epub"]) })) },
  epubProgressAPI: { get: mocks.getProgress, update: mocks.updateProgress },
  settingAPI: { list: vi.fn(async () => ({})), update: vi.fn() },
  seriesAPI: { get: vi.fn(async () => ({ data: {} })), getViewerSettings: vi.fn(async () => ({})) },
}));
vi.mock("../features/viewer", () => ({
  useAdjacentChapters: () => ({ isAdjacentResolved: true }),
  useExitFullscreenOnViewerUnmount: () => {},
  useRestoreFullscreenAfterChapterSwitch: () => {},
  useBGM: () => ({ bgmInfo: null, isBgmPlaying: false, setIsBgmPlaying: vi.fn(), audioRef: { current: null } }),
}));
vi.mock("../hooks/useViewerSync", () => ({
  useViewerSync: () => ({ terminatedInfo: { isOpen: false, reason: "" } }),
}));
vi.mock("../features/viewer/components", () => ({ ChapterListModal: () => null }));
vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

const TOTAL_POSITIONS = 101;
const CACHE_KEY = "epub-locations-chapter-1";
const cfiAt = (position: number) => `epubcfi(/6/2!/4/${(position + 1) * 2})`;
const positionAt = (cfi: string) => Number(cfi.match(/\/4\/(\d+)\)/)?.[1]) / 2 - 1;
const locationAt = (position: number) => ({
  start: {
    cfi: cfiAt(position),
    index: 0,
    percentage: position / (TOTAL_POSITIONS - 1),
    displayed: { page: position + 1, total: TOTAL_POSITIONS },
  },
  atStart: position === 0,
  atEnd: position === TOTAL_POSITIONS - 1,
});

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createBook() {
  const generation = deferred();
  const correction = deferred();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  let generated = false;
  let current = locationAt(0);
  const emit = (name: string, ...args: unknown[]) => listeners.get(name)?.forEach(handler => handler(...args));
  const rendition = {
    on: vi.fn((name: string, handler: (...args: unknown[]) => void) => {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
    }),
    off: vi.fn((name: string, handler: (...args: unknown[]) => void) => listeners.get(name)?.delete(handler)),
    hooks: { content: { register: vi.fn(), deregister: vi.fn() } },
    getContents: () => [],
    spread: vi.fn(),
    currentLocation: () => current,
    display: vi.fn(async (cfi?: string) => {
      if (cfi) await correction.promise;
      current = locationAt(cfi ? positionAt(cfi) : 0);
      // epub.js emits relocated before its display Promise resolves.
      emit("relocated", current);
    }),
    destroy: vi.fn(),
  };
  const locations = {
    generate: vi.fn(async () => { await generation.promise; generated = true; }),
    length: () => generated ? TOTAL_POSITIONS : 0,
    save: () => "cached-locations",
    load: vi.fn(() => { generated = true; }),
    cfiFromPercentage: vi.fn((ratio: number) => cfiAt(Math.round(ratio * (TOTAL_POSITIONS - 1)))),
    locationFromCfi: (cfi: string) => positionAt(cfi),
  };
  const book = {
    ready: Promise.resolve(),
    spine: { spineItems: [{ href: "chapter.xhtml", linear: "yes" }], get: () => null },
    navigation: { toc: [] },
    locations,
    renderTo: () => rendition,
    destroy: vi.fn(),
  };
  mocks.epub.mockReturnValue(book);
  return { book, rendition, generation, correction, emit };
}

function mountRoute({ incognito = false } = {}) {
  const setViewStatus = vi.fn();
  const view = render(
    <MemoryRouter initialEntries={[{ pathname: "/viewer/chapter-1", state: { isIncognito: incognito } }]}>
      <Routes>
        <Route path="/viewer/:chapterId" element={<EpubViewerRoute loaderData={{
          chapter: { id: "chapter-1", volume_id: "volume-1", title: "EPUB", chapter_number: 1, page_count: 1 },
          isLoading: false, error: null, seriesId: "series-1", volumeId: "volume-1",
          pageMeta: [], pageMetaMap: new Map(), isInitialScrollingRef: { current: false }, setViewStatus,
        }} />} />
      </Routes>
    </MemoryRouter>,
  );
  return { ...view, setViewStatus };
}

// Keep the real route, EpubViewer, EpubChapterViewer and Zustand store connected.
// Mock only the EPUB engine/network so cold generation and display can be settled separately.
describe("EPUB percentage restore state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useEpubViewerStore.setState(useEpubViewerStore.getInitialState(), true);
    vi.stubGlobal("URL", class extends URL {
      static createObjectURL = vi.fn(() => "blob:epub");
      static revokeObjectURL = vi.fn();
    });
    mocks.getProgress.mockResolvedValue({ data: { progress: { current_cfi: null, progress_percent: 45.4 } } });
    mocks.updateProgress.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([40.4, 45.4, 50.4])("syncs the corrected cold position (saved percent: %s) before the first user move", async (savedPercent) => {
    mocks.getProgress.mockResolvedValue({ data: { progress: { current_cfi: null, progress_percent: savedPercent } } });
    const { book, rendition, generation, correction, emit } = createBook();
    const { setViewStatus } = mountRoute();
    await waitFor(() => expect(book.locations.generate).toHaveBeenCalled());
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(setViewStatus).not.toHaveBeenCalledWith("ready");
    expect(mocks.updateProgress).not.toHaveBeenCalled();
    expect(useEpubViewerStore.getState().currentPage).toBe(1);

    await act(async () => { generation.resolve(); });
    const position = Math.round(savedPercent);
    expect(book.locations.cfiFromPercentage).toHaveBeenCalledWith(savedPercent / 100);
    expect(rendition.display).toHaveBeenLastCalledWith(cfiAt(position));
    expect(screen.getByTestId("loading-spinner")).toBeInTheDocument();
    expect(mocks.updateProgress).not.toHaveBeenCalled();

    await act(async () => { correction.resolve(); });
    await waitFor(() => expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument());
    expect(setViewStatus).toHaveBeenCalledTimes(1);
    expect(setViewStatus).toHaveBeenCalledWith("ready");
    expect(useEpubViewerStore.getState()).toMatchObject({
      currentCFI: cfiAt(position), currentPage: position + 1, totalPages: TOTAL_POSITIONS,
      globalProgress: position, isAtFirstPage: false, isAtLastPage: false,
    });
    expect(screen.getByRole("slider")).toHaveAttribute("aria-valuenow", String(position));
    expect(mocks.updateProgress).toHaveBeenCalledTimes(1);
    expect(mocks.updateProgress).toHaveBeenLastCalledWith("chapter-1", expect.objectContaining({
      current_cfi: cfiAt(position), progress_percent: position,
    }));
    // Establish the restored baseline: repeated relocated must not save again.
    act(() => { emit("relocated", rendition.currentLocation()); });
    expect(mocks.updateProgress).toHaveBeenCalledTimes(1);
    expect(setViewStatus).toHaveBeenCalledTimes(1);

    await act(async () => { await rendition.display(cfiAt(position + 1)); });
    expect(useEpubViewerStore.getState().currentPage).toBe(position + 2);
    expect(mocks.updateProgress).toHaveBeenCalledTimes(2);
    expect(mocks.updateProgress).toHaveBeenLastCalledWith("chapter-1", expect.objectContaining({
      current_cfi: cfiAt(position + 1), progress_percent: position + 1,
    }));
  });

  it("syncs a cold incognito restore without saving", async () => {
    const { book, generation, correction } = createBook();
    mountRoute({ incognito: true });
    await waitFor(() => expect(book.locations.generate).toHaveBeenCalled());
    await act(async () => { generation.resolve(); correction.resolve(); });
    await waitFor(() => expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument());
    expect(useEpubViewerStore.getState()).toMatchObject({ currentPage: 46, totalPages: TOTAL_POSITIONS, globalProgress: 45 });
    expect(mocks.updateProgress).not.toHaveBeenCalled();
  });

  it("keeps cached percentage restore synchronized without generating locations", async () => {
    localStorage.setItem(CACHE_KEY, "cached-locations");
    const { book, correction } = createBook();
    correction.resolve();
    mountRoute();
    await waitFor(() => expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument());
    expect(book.locations.load).toHaveBeenCalledWith("cached-locations");
    expect(book.locations.generate).not.toHaveBeenCalled();
    expect(useEpubViewerStore.getState()).toMatchObject({ currentPage: 46, totalPages: TOTAL_POSITIONS, globalProgress: 45 });
  });

  it("syncs the current position without rewinding if navigation occurred during generation", async () => {
    const { book, rendition, generation, correction } = createBook();
    mountRoute();
    await waitFor(() => expect(book.locations.generate).toHaveBeenCalled());
    correction.resolve();
    await act(async () => { await rendition.display(cfiAt(20)); });
    expect(mocks.updateProgress).not.toHaveBeenCalled();
    await act(async () => { generation.resolve(); });
    await waitFor(() => expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument());
    expect(rendition.display).toHaveBeenLastCalledWith(cfiAt(20));
    expect(useEpubViewerStore.getState()).toMatchObject({ currentPage: 21, totalPages: TOTAL_POSITIONS, globalProgress: 20 });
    expect(mocks.updateProgress).toHaveBeenCalledTimes(1);
    expect(mocks.updateProgress).toHaveBeenLastCalledWith("chapter-1", expect.objectContaining({ current_cfi: cfiAt(20) }));
  });

  it.each(["generation", "correction", "displayerror"])("does not publish a successful restore or save after %s fails", async (failure) => {
    const { book, generation, correction, emit } = createBook();
    const { setViewStatus } = mountRoute();
    await waitFor(() => expect(book.locations.generate).toHaveBeenCalled());
    await act(async () => {
      if (failure === "generation") {
        generation.reject(new Error("synthetic generation failure"));
      } else {
        generation.resolve();
      }
    });
    if (failure !== "generation") {
      await act(async () => {
        if (failure === "displayerror") {
          emit("displayerror", new Error("synthetic displayerror"));
          // The failed rendition may still settle asynchronously after reporting an error.
          correction.resolve();
        } else {
          correction.reject(new Error("synthetic correction failure"));
        }
      });
    }
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByTestId("loading-spinner")).not.toBeInTheDocument();
    expect(useEpubViewerStore.getState().currentPage).toBe(1);
    expect(mocks.updateProgress).not.toHaveBeenCalled();
    expect(setViewStatus).toHaveBeenCalledTimes(1);
  });

  it("does not sync or save after unmount during cold generation", async () => {
    const { book, generation, correction } = createBook();
    const { unmount, setViewStatus } = mountRoute();
    await waitFor(() => expect(book.locations.generate).toHaveBeenCalled());
    unmount();
    await act(async () => { generation.resolve(); correction.resolve(); });
    expect(useEpubViewerStore.getState().currentPage).toBe(1);
    expect(setViewStatus).not.toHaveBeenCalled();
    expect(mocks.updateProgress).not.toHaveBeenCalled();
  });
});
