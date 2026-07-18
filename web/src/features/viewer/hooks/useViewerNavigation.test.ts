import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useViewerNavigation } from "./useViewerNavigation";
import { takeReturnFocus } from "../../../utils/returnFocus";
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

vi.mock("../../../utils/fullscreen", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../utils/fullscreen")>();
  return {
    ...actual,
    isFullscreen: () => true,
  };
});

describe("useViewerNavigation fullscreen switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
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
        seriesId: "series-1",
        volumeId: "volume-150",
      }),
    );

    act(() => {
      result.current.handleBack();
    });

    expect(mocks.saveProgressMock).toHaveBeenCalledTimes(1);
    expect(mocks.navigateMock).toHaveBeenCalledWith("/series/1", { replace: true });
    expect(takeReturnFocus("series", "series-1")).toBe("volume-150");
  });
});

describe("useViewerNavigation fullscreen shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
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

});

describe("useViewerNavigation split-page flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
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

describe("useViewerNavigation chapter boundary flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
  });

  const wideMeta = (page: number): Map<number, PageMeta> =>
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

  it("마지막 일반 페이지 + nextChapterId 존재 → canGoNextChapter === true", () => {
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

    expect(result.current.canGoNextChapter).toBe(true);
    expect(result.current.canGoPrevChapter).toBe(false);
  });

  it("마지막 페이지 + nextChapterId 없음 → canGoNextChapter === false", () => {
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
        nextChapterId: null,
        prevChapterId: null,
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    expect(result.current.canGoNextChapter).toBe(false);
  });

  it("single 모드 마지막 wide 이미지의 첫 번째 subPage (LTR) → canGoNextChapter === false", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: wideMeta(10),
        subPage: "left",
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

    expect(result.current.canGoNextChapter).toBe(false);
  });

  it("single 모드 마지막 wide 이미지의 마지막 subPage (LTR) → canGoNextChapter === true", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: wideMeta(10),
        subPage: "right",
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

    expect(result.current.canGoNextChapter).toBe(true);
  });

  it("single 모드 마지막 wide 이미지의 첫 번째 subPage (RTL) → canGoNextChapter === false", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "rtl",
        keyboardDirection: "rtl",
        pageOffset: 0,
        pageMetaMap: wideMeta(10),
        subPage: "right",
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

    expect(result.current.canGoNextChapter).toBe(false);
  });

  it("single 모드 마지막 wide 이미지의 마지막 subPage (RTL) → canGoNextChapter === true", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "rtl",
        keyboardDirection: "rtl",
        pageOffset: 0,
        pageMetaMap: wideMeta(10),
        subPage: "left",
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

    expect(result.current.canGoNextChapter).toBe(true);
  });

  it("single 모드 첫 wide 이미지의 마지막 subPage (LTR) → canGoPrevChapter === false", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 1,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: wideMeta(1),
        subPage: "right",
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: "prev-chapter",
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    expect(result.current.canGoPrevChapter).toBe(false);
  });

  it("single 모드 첫 wide 이미지의 첫 번째 subPage (LTR) → canGoPrevChapter === true", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 1,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "ltr",
        keyboardDirection: "ltr",
        pageOffset: 0,
        pageMetaMap: wideMeta(1),
        subPage: "left",
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: "prev-chapter",
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    expect(result.current.canGoPrevChapter).toBe(true);
  });

  it("single 모드 첫 wide 이미지의 마지막 subPage (RTL) → canGoPrevChapter === false", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 1,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "rtl",
        keyboardDirection: "rtl",
        pageOffset: 0,
        pageMetaMap: wideMeta(1),
        subPage: "left",
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: "prev-chapter",
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    expect(result.current.canGoPrevChapter).toBe(false);
  });

  it("single 모드 첫 wide 이미지의 첫 번째 subPage (RTL) → canGoPrevChapter === true", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 1,
        totalPages: 10,
        readingMode: "single",
        readingDirection: "rtl",
        keyboardDirection: "rtl",
        pageOffset: 0,
        pageMetaMap: wideMeta(1),
        subPage: "right",
        setSubPage: vi.fn(),
        nextChapterId: null,
        prevChapterId: "prev-chapter",
        saveProgress: mocks.saveProgressMock,
        isSettingsOpen: false,
        closeSettings: vi.fn(),
        handleToggleFullscreen: vi.fn(),
        currentChapterId: "chapter-1",
      }),
    );

    expect(result.current.canGoPrevChapter).toBe(true);
  });

  it("double 모드 마지막 페이지 + nextChapterId 존재 → canGoNextChapter === true", () => {
    const { result } = renderHook(() =>
      useViewerNavigation({
        currentPage: 10,
        totalPages: 10,
        readingMode: "double",
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

    expect(result.current.canGoNextChapter).toBe(true);
  });
});
