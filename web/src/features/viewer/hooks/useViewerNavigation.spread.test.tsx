import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useViewerNavigation } from "./useViewerNavigation";
import { useSwipe } from "./useSwipe";
import { useViewerStore } from "../../../stores/viewerStore";
import { getDisplayPages } from "../../../utils/pageCalculator";
import type { PageMeta } from "../types";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ state: {} }),
}));

const initialSettings = useViewerStore.getState().settings;
const saveProgress = vi.fn(async () => {});

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

function mountNavigation(
  currentPage: number,
  totalPages: number,
  pageOffset: number,
  direction: "ltr" | "rtl",
  pageMetaMap = new Map<number, PageMeta>(),
  overrides: Partial<Parameters<typeof useViewerNavigation>[0]> = {},
) {
  useViewerStore.setState({
    currentPage,
    totalPages,
    subPage: null,
    settings: { ...initialSettings, readingMode: "double", readingDirection: direction, keyboardDirection: direction, pageOffset },
  });
  return renderHook(() => {
    const store = useViewerStore();
    const navigation = useViewerNavigation({
      currentPage: store.currentPage,
      totalPages: store.totalPages,
      readingMode: store.settings.readingMode,
      readingDirection: store.settings.readingDirection,
      keyboardDirection: store.settings.keyboardDirection,
      pageOffset: store.settings.pageOffset,
      pageMetaMap,
      subPage: store.subPage,
      setSubPage: store.setSubPage,
      nextChapterId: "next",
      prevChapterId: "previous",
      saveProgress,
      isSettingsOpen: false,
      closeSettings: vi.fn(),
      handleToggleFullscreen: vi.fn(),
      currentChapterId: "current",
      ...overrides,
    });
    const swipe = useSwipe({
      onNext: () => { void navigation.handleNext(); },
      onPrev: () => { void navigation.handlePrev(); },
      readingDirection: direction,
      isZoomed: false,
      skipNextAnimation: navigation.canGoNextChapter,
      skipPrevAnimation: navigation.canGoPrevChapter,
    });
    return {
      ...navigation,
      animateNext: swipe.animateNext,
      isAnimating: swipe.isAnimating,
      currentPage: store.currentPage,
      visible: getDisplayPages({ currentPage: store.currentPage, totalPages: store.totalPages, readingMode: "double", pageOffset, pageMetaMap }),
    };
  });
}

describe.each(["ltr", "rtl"] as const)("useViewerNavigation final spread (%s)", (direction) => {
  it.each([
    { currentPage: 9, totalPages: 10, pageOffset: 0 },
    { currentPage: 10, totalPages: 11, pageOffset: 1 },
  ])("shows the hint on the first input at $currentPage/$totalPages with offset $pageOffset", async ({ currentPage, totalPages, pageOffset }) => {
    const { result } = mountNavigation(currentPage, totalPages, pageOffset, direction);
    const visible = result.current.visible;
    expect(visible).toContain(totalPages);
    expect(result.current.canGoNextChapter).toBe(true);

    await act(async () => { await result.current.handleNext(); });

    expect(result.current.showNextHint).toBe(true);
    expect(result.current.visible).toEqual(visible);
    // Progress saving and volume completion require the final anchor page.
    expect(result.current.currentPage).toBe(totalPages);
    expect(navigate).not.toHaveBeenCalled();
    expect(saveProgress).not.toHaveBeenCalled();

    await act(async () => { await result.current.handleNext(); });

    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/viewer/next", expect.objectContaining({ replace: true }));
  });

  it.each([
    { currentPage: 11, totalPages: 11, pageOffset: 0 },
    { currentPage: 10, totalPages: 10, pageOffset: 1 },
  ])("preserves hint-then-confirm for a standalone final page at $currentPage/$totalPages", async ({ currentPage, totalPages, pageOffset }) => {
    const { result } = mountNavigation(currentPage, totalPages, pageOffset, direction);
    expect(result.current.visible).toEqual([totalPages]);
    await act(async () => { await result.current.handleNext(); });
    expect(result.current.showNextHint).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleNext(); });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("does not skip an unseen final wide image", async () => {
    const metadata = new Map<number, PageMeta>([[10, { pageNumber: 10, width: 2600, height: 1600, isWide: true }]]);
    const { result } = mountNavigation(9, 10, 0, direction, metadata);
    expect(result.current.visible).toEqual([9]);
    expect(result.current.canGoNextChapter).toBe(false);
    await act(async () => { await result.current.handleNext(); });
    expect(result.current.visible).toEqual([10]);
    expect(result.current.showNextHint).toBe(false);
    await act(async () => { await result.current.handleNext(); });
    expect(result.current.showNextHint).toBe(true);
  });

  it("skips the slide animation for the first next action on the final spread", async () => {
    const { result } = mountNavigation(9, 10, 0, direction);
    await act(async () => { result.current.animateNext(); });
    expect(result.current.isAnimating).toBe(false);
    expect(result.current.showNextHint).toBe(true);
    expect(result.current.currentPage).toBe(10);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("handles the next keyboard input without invoking a page animation", async () => {
    const animationRef = { current: { animateNext: vi.fn(), animatePrev: vi.fn() } };
    const { result } = mountNavigation(9, 10, 0, direction, new Map(), { animationRef });
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: direction === "rtl" ? "ArrowLeft" : "ArrowRight" }));
    });
    expect(animationRef.current.animateNext).not.toHaveBeenCalled();
    expect(result.current.showNextHint).toBe(true);
  });

  it("reports series end on the first input when no next chapter exists", async () => {
    const onReachedSeriesEnd = vi.fn();
    const { result } = mountNavigation(9, 10, 0, direction, new Map(), { nextChapterId: null, onReachedSeriesEnd });
    expect(result.current.canGoNextChapter).toBe(false);
    await act(async () => { await result.current.handleNext(); });
    expect(onReachedSeriesEnd).toHaveBeenCalledTimes(1);
    expect(result.current.currentPage).toBe(10);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("normalizes the final anchor before confirming a hint left open after going back", async () => {
    const { result } = mountNavigation(10, 10, 0, direction);
    await act(async () => { await result.current.handleNext(); });
    expect(result.current.showNextHint).toBe(true);
    act(() => { useViewerStore.getState().goToPage(9); });
    await act(async () => { await result.current.handleNext(); });
    expect(result.current.currentPage).toBe(10);
    expect(navigate).not.toHaveBeenCalled();
    expect(saveProgress).not.toHaveBeenCalled();
    await act(async () => { await result.current.handleNext(); });
    expect(saveProgress).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
