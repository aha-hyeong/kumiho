import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewerNavigation } from "./useViewerNavigation";
import type { PageMeta } from "../types";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const goToPageMock = vi.fn();
  const startChapterSwitchingMock = vi.fn();
  const saveProgressMock = vi.fn(async () => {});

  const useViewerStoreMock = vi.fn(() => ({
    goToPage: goToPageMock,
  }));

  return {
    mocks: {
      navigateMock,
      goToPageMock,
      startChapterSwitchingMock,
      saveProgressMock,
      useViewerStoreMock,
    },
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigateMock,
  useLocation: () => ({ state: { from: "/series/1" } }),
}));

vi.mock("../../../stores/viewerStore", () => ({
  useViewerStore: mocks.useViewerStoreMock,
}));

vi.mock("../../../stores/fullscreenSwitchStore", () => ({
  startChapterSwitching: (...args: unknown[]) => mocks.startChapterSwitchingMock(...args),
}));

vi.mock("../../../utils/fullscreen", () => ({
  isFullscreen: () => true,
}));

describe("useViewerNavigation fullscreen switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sets chapter switching before navigating to next chapter", async () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        subPage: null,
        setSubPage: vi.fn(),
        nextChapterId: "next-chapter",
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    await act(async () => {
      await result.current.handleNext();
    });
    expect(result.current.showNextHint).toBe(true);
    expect(mocks.navigateMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.saveProgressMock).toHaveBeenCalledTimes(1);
    expect(mocks.startChapterSwitchingMock).toHaveBeenCalledWith(true);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/next-chapter", {
      replace: true,
      state: { from: "/series/1" },
    });
  });

  it("uses replace navigation when returning to viewerFrom", async () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 3,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        subPage: null,
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    act(() => {
      result.current.handleBack();
    });

    expect(mocks.saveProgressMock).toHaveBeenCalledTimes(1);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/series/1", { replace: true });
  });
});

describe("useViewerNavigation fullscreen shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("toggles fullscreen on f, F, and ㄹ", () => {
    const handleToggleFullscreen = vi.fn();

    renderHook(() =>
      useViewerNavigation({
        currentPage: 3,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        subPage: null,
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen,
        currentChapterId: "chapter-1",
      }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ㄹ" }));

    expect(handleToggleFullscreen).toHaveBeenCalledTimes(3);
  });

  it("ignores fullscreen shortcut when modifier keys or repeat are present", () => {
    const handleToggleFullscreen = vi.fn();

    renderHook(() =>
      useViewerNavigation({
        currentPage: 3,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        subPage: null,
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen,
        currentChapterId: "chapter-1",
      }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", metaKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", altKey: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "f", repeat: true }));

    expect(handleToggleFullscreen).not.toHaveBeenCalled();
  });

  it("toggles fullscreen shortcut even in scrolled mode", () => {
    const handleToggleFullscreen = vi.fn();

    renderHook(() =>
      useViewerNavigation({
        currentPage: 3,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: new Map(),
        subPage: null,
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen,
        currentChapterId: "chapter-1",
      }),
    );

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "F" }));

    expect(handleToggleFullscreen).toHaveBeenCalledTimes(1);
  });
});

describe("useViewerNavigation split-page flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createWidePageMetaMap = (page: number): Map<number, PageMeta> =>
    new Map([
      [
        page,
        {
          pageNumber: page,
          width: 2600,
          height: 1600,
          isWide: true,
        },
      ],
    ]);
  type NavHookProps = { currentPage: number; subPage: "left" | "right" | null };

  it("navigates wide page halves in LTR order", async () => {
    const setSubPage = vi.fn();
    const pageMetaMap = createWidePageMetaMap(5);
    const initialProps: NavHookProps = { currentPage: 5, subPage: "left" };

    const { result, rerender } = renderHook(
      ({ currentPage, subPage }: NavHookProps) =>
        useViewerNavigation({
          currentPage,
          totalPages: 10,
          readingMode: "single",
          readingDirection: "ltr",
          keyboardDirection: "ltr",
          pageOffset: 0,
          pageMetaMap,
          subPage,
          setSubPage,
          nextChapterId: "next-chapter",
          prevChapterId: null,
          saveProgress: mocks.saveProgressMock,
          isSettingsOpen: false,
          closeSettings: vi.fn(),
          handleToggleFullscreen: vi.fn(),
          currentChapterId: "chapter-1",
        }),
      { initialProps },
    );

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.goToPageMock).not.toHaveBeenCalled();
    expect(setSubPage).toHaveBeenCalledWith("right");

    rerender({ currentPage: 5, subPage: "right" });

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.goToPageMock).toHaveBeenCalledWith(6);
    expect(setSubPage).toHaveBeenCalledWith(null);
  });

  it("navigates wide page halves in RTL order", async () => {
    const setSubPage = vi.fn();
    const pageMetaMap = createWidePageMetaMap(5);
    const initialProps: NavHookProps = { currentPage: 5, subPage: "right" };

    const { result, rerender } = renderHook(
      ({ currentPage, subPage }: NavHookProps) =>
        useViewerNavigation({
          currentPage,
          totalPages: 10,
          readingMode: "single",
          readingDirection: "rtl",
          keyboardDirection: "rtl",
          pageOffset: 0,
          pageMetaMap,
          subPage,
          setSubPage,
          nextChapterId: "next-chapter",
          prevChapterId: null,
          saveProgress: mocks.saveProgressMock,
          isSettingsOpen: false,
          closeSettings: vi.fn(),
          handleToggleFullscreen: vi.fn(),
          currentChapterId: "chapter-1",
        }),
      { initialProps },
    );

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.goToPageMock).not.toHaveBeenCalled();
    expect(setSubPage).toHaveBeenCalledWith("left");

    rerender({ currentPage: 5, subPage: "left" });

    await act(async () => {
      await result.current.handleNext();
    });

    expect(mocks.goToPageMock).toHaveBeenCalledWith(6);
    expect(setSubPage).toHaveBeenCalledWith(null);
  });

  it("navigates previous from wide page half before moving page", async () => {
    const setSubPage = vi.fn();
    const pageMetaMap = createWidePageMetaMap(5);
    const initialProps: NavHookProps = { currentPage: 5, subPage: "right" };

    const { result, rerender } = renderHook(
      ({ currentPage, subPage }: NavHookProps) =>
        useViewerNavigation({
          currentPage,
          totalPages: 10,
          readingMode: "single",
          readingDirection: "ltr",
          keyboardDirection: "ltr",
          pageOffset: 0,
          pageMetaMap,
          subPage,
          setSubPage,
          nextChapterId: "next-chapter",
          prevChapterId: "prev-chapter",
          saveProgress: mocks.saveProgressMock,
          isSettingsOpen: false,
          closeSettings: vi.fn(),
          handleToggleFullscreen: vi.fn(),
          currentChapterId: "chapter-1",
        }),
      { initialProps },
    );

    await act(async () => {
      await result.current.handlePrev();
    });

    expect(mocks.goToPageMock).not.toHaveBeenCalled();
    expect(setSubPage).toHaveBeenCalledWith("left");

    rerender({ currentPage: 5, subPage: "left" });

    await act(async () => {
      await result.current.handlePrev();
    });

    expect(mocks.goToPageMock).toHaveBeenCalledWith(4);
    expect(setSubPage).toHaveBeenCalledWith(null);
  });
});
