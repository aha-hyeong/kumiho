import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChapterLoader } from "./useChapterLoader";
import { useNextChapterPreloader } from "./useNextChapterPreloader";
import type { Chapter } from "../../../types/series";
import { useViewerStore } from "../../../stores/viewerStore";

const api = vi.hoisted(() => ({ init: vi.fn(), swipe: vi.fn(), progress: vi.fn(), volume: vi.fn(), analyze: vi.fn(), chapter: vi.fn(), pages: vi.fn() }));
vi.mock("react-router-dom", () => ({ useSearchParams: () => [new URLSearchParams()] }));
vi.mock("../../../api/client", () => ({
  viewerAPI: { getInitData: api.init },
  seriesAPI: { getSwipeSettings: api.swipe },
  chapterAPI: { get: api.chapter, getPages: api.pages, getProgress: api.progress, analyze: api.analyze },
  volumeAPI: { get: api.volume },
}));

const swipe = (override: "ltr" | "rtl" | null, userDefault: "ltr" | "rtl" = "rtl") => ({
  user_default: userDefault, series_override: override, effective_direction: override ?? userDefault,
});
const initFor = (chapterId: string, seriesId: string, override: "ltr" | "rtl" | null = null) => ({ data: {
  chapter: { id: chapterId, volume_id: `${seriesId}-volume`, title: chapterId, chapter_number: 1, path: `${chapterId}.cbz`, page_count: 1 },
  volume: { id: `${seriesId}-volume`, series_id: seriesId, is_completed: false },
  series: { id: seriesId }, library: { default_view_mode: "single" }, progress: null,
  user_settings: override ? { swipe_direction: override } : null,
  server_settings: { swipe_direction: "ltr", viewer_reading_direction: "ltr" },
  swipe_settings: swipe(override), pages: [],
} });

beforeEach(() => {
  vi.clearAllMocks();
  useViewerStore.getState().reset();
  useViewerStore.getState().setNextChapterData(null);
  api.progress.mockResolvedValue({ data: { progress: null } });
  api.swipe.mockImplementation((seriesId: string) => Promise.resolve(swipe(seriesId === "B" ? "ltr" : null)));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function waitLoaded(result: { current: { isLoading: boolean } }) {
  await waitFor(() => expect(result.current.isLoading).toBe(false));
}

function cacheChapter(chapterId: string, seriesId: string, includeSeriesId = true) {
  act(() => useViewerStore.getState().setNextChapterData({
    chapterId, chapter: initFor(chapterId, seriesId).data.chapter as Chapter,
    pages: [], seriesId: includeSeriesId ? seriesId : undefined,
  }));
}

describe("Viewer swipe settings initialization", () => {
  it.each([
    ["missing swipe_settings", undefined],
    ["null swipe_settings", null],
    ["missing effective_direction", { user_default: "ltr", series_override: null }],
    ["missing user_default", { effective_direction: "ltr", series_override: null }],
    ["missing series_override", { effective_direction: "ltr", user_default: "ltr" }],
    ["null user_default", { effective_direction: "ltr", user_default: null, series_override: null }],
    ["invalid direction", { effective_direction: "up", user_default: "ltr", series_override: null }],
    ["invalid override", { effective_direction: "ltr", user_default: "ltr", series_override: "up" }],
    ["inconsistent effective direction", { effective_direction: "rtl", user_default: "ltr", series_override: null }],
  ])("fails closed for %s instead of activating a stale Viewer", async (_name, invalid) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    useViewerStore.getState().initializeSwipeSettings("B", swipe("ltr"));
    api.init.mockResolvedValue({ data: { ...initFor("a", "A").data, swipe_settings: invalid } });
    const { result } = renderHook(() => useChapterLoader({ chapterId: "a" }));
    await waitLoaded(result);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).toMatch(/contract|버전/i);
    expect(result.current.chapter).toBeNull();
    expect(useViewerStore.getState().currentSeriesId).toBeNull();
    expect(useViewerStore.getState().totalPages).toBe(0);
  });

  it("preserves a newer override when an old init snapshot arrives", async () => {
    let complete!: (value: ReturnType<typeof initFor>) => void;
    api.init.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const oldSnapshot = initFor("a", "A");
    oldSnapshot.data.swipe_settings = swipe(null, "ltr");
    const { result } = renderHook(() => useChapterLoader({ chapterId: "a" }));
    await waitFor(() => expect(api.init).toHaveBeenCalledWith("a"));
    // Use the real save lifecycle after the request captured its old snapshot.
    act(() => {
      const token = useViewerStore.getState().beginSwipeMutation("A", "rtl");
      useViewerStore.getState().commitSwipeMutation(token);
      useViewerStore.getState().finishSwipeMutation(token);
    });
    await act(async () => complete(oldSnapshot));
    await waitLoaded(result);
    expect(result.current.error).toBeNull();
    expect(result.current.chapter?.id).toBe("a");
    expect(useViewerStore.getState().seriesSettings.A.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
  });

  it("preserves a confirmed save when an older cached swipe snapshot arrives", async () => {
    let complete!: (value: ReturnType<typeof swipe>) => void;
    api.swipe.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    useViewerStore.getState().initializeSwipeSettings("A", swipe(null, "ltr"));
    cacheChapter("a-next", "A");
    const { result } = renderHook(() => useChapterLoader({ chapterId: "a-next" }));
    await waitFor(() => expect(api.swipe).toHaveBeenCalledWith("A"));
    act(() => {
      const token = useViewerStore.getState().beginSwipeMutation("A", "rtl");
      useViewerStore.getState().commitSwipeMutation(token);
      useViewerStore.getState().finishSwipeMutation(token);
    });
    await act(async () => complete(swipe(null, "ltr")));
    await waitLoaded(result);
    expect(result.current.error).toBeNull();
    expect(result.current.chapter?.id).toBe("a-next");
    expect(useViewerStore.getState().seriesSettings.A.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(api.init).not.toHaveBeenCalled();
  });

  it("fails closed when cached settings violate the swipe contract", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    api.swipe.mockResolvedValue(undefined); cacheChapter("a-next", "A");
    const { result } = renderHook(() => useChapterLoader({ chapterId: "a-next" }));
    await waitLoaded(result);
    expect(result.current.error).toMatch(/contract|버전/i);
    expect(result.current.chapter).toBeNull();
    expect(useViewerStore.getState().currentSeriesId).toBeNull();
    expect(useViewerStore.getState().totalPages).toBe(0);
  });

  it("ignores an older init of the same series including its unmount cleanup", async () => {
    let complete!: (value: ReturnType<typeof initFor>) => void;
    api.init.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }))
      .mockResolvedValueOnce(initFor("a-new", "A", "rtl"));
    const old = renderHook(() => useChapterLoader({ chapterId: "a-old" }));
    await waitFor(() => expect(api.init).toHaveBeenCalledWith("a-old"));
    const current = renderHook(() => useChapterLoader({ chapterId: "a-new" }));
    await waitLoaded(current.result);
    await act(async () => complete(initFor("a-old", "A", "ltr")));
    expect(old.result.current.chapter).toBeNull();
    old.unmount();
    expect(useViewerStore.getState().currentSeriesId).toBe("A");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(current.result.current.chapter?.id).toBe("a-new");
  });

  it("applies ordinary same-series chapter init without a mutation", async () => {
    api.init.mockImplementation((id: string) => Promise.resolve(initFor(id, "A", "rtl")));
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "a-one" } });
    await waitLoaded(result); rerender({ chapterId: "a-two" }); await waitLoaded(result);
    expect(result.current.chapter?.id).toBe("a-two");
    expect(useViewerStore.getState().currentSeriesId).toBe("A");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(api.init).toHaveBeenCalledTimes(2);
  });

  it("does not activate a cached Viewer when swipe settings cannot be fetched", async () => {
    api.init.mockResolvedValue(initFor("b", "B", "ltr"));
    api.swipe.mockRejectedValue(new Error("settings unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "b" } });
    await waitLoaded(result); cacheChapter("a-next", "A");
    rerender({ chapterId: "a-next" }); await waitLoaded(result);
    expect(result.current.error).not.toBeNull(); expect(result.current.chapter).toBeNull();
    expect(useViewerStore.getState().currentSeriesId).toBeNull();
    expect(api.init).toHaveBeenCalledTimes(1);
  });

  it("ignores a late cached-series response after switching to another series", async () => {
    let complete!: (value: ReturnType<typeof swipe>) => void;
    api.swipe.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    cacheChapter("a-next", "A"); api.init.mockResolvedValue(initFor("b", "B", "ltr"));
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "a-next" } });
    await waitFor(() => expect(api.swipe).toHaveBeenCalledWith("A"));
    rerender({ chapterId: "b" }); await waitLoaded(result);
    await act(async () => complete(swipe(null)));
    expect(useViewerStore.getState().currentSeriesId).toBe("B");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(result.current.chapter?.id).toBe("b");
  });

  it("keeps real next-chapter preload reusable through A -> B -> cached A", async () => {
    api.init.mockImplementation((id: string) => Promise.resolve(initFor(id, id === "b" ? "B" : "A", id === "b" ? "ltr" : null)));
    api.chapter.mockResolvedValue({ data: initFor("a-next", "A").data.chapter });
    api.pages.mockResolvedValue({ data: { pages: [{ page_number: 1, width: 100, height: 200 }] } });
    const { result, rerender } = renderHook(({ chapterId, nextChapterId }: { chapterId: string; nextChapterId: string | null }) => {
      const loader = useChapterLoader({ chapterId });
      useNextChapterPreloader({ nextChapterId, currentChapterId: chapterId, isCurrentChapterLoaded: !loader.isLoading, seriesId: loader.seriesId });
      return loader;
    }, { initialProps: { chapterId: "a", nextChapterId: "a-next" as string | null } });
    await waitLoaded(result);
    await waitFor(() => expect(useViewerStore.getState().nextChapterData?.chapterId).toBe("a-next"));
    rerender({ chapterId: "b", nextChapterId: null }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    rerender({ chapterId: "a-next", nextChapterId: null }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(result.current.chapter?.id).toBe("a-next");
    expect(api.chapter).toHaveBeenCalledTimes(1); expect(api.pages).toHaveBeenCalledTimes(1);
    expect(api.init).toHaveBeenCalledTimes(2);
  });

  it("restores A on a preloaded cache hit after visiting B without refetching chapter/pages", async () => {
    api.init.mockImplementation((id: string) => Promise.resolve(initFor(id, id === "b" ? "B" : "A", id === "b" ? "ltr" : null)));
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "a" } });
    await waitLoaded(result);
    cacheChapter("a-next", "A");
    rerender({ chapterId: "b" }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    rerender({ chapterId: "a-next" }); await waitLoaded(result);
    expect(useViewerStore.getState().currentSeriesId).toBe("A");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(api.swipe).toHaveBeenCalledWith("A");
    expect(api.init).toHaveBeenCalledTimes(2);
    expect(result.current.chapter?.id).toBe("a-next");
  });

  it("uses the same series override across preloaded chapters in different volumes", async () => {
    api.init.mockResolvedValue(initFor("b", "B", "ltr"));
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "b" } });
    await waitLoaded(result);
    const chapter = { ...initFor("b-next", "B").data.chapter, volume_id: "B-volume-2" } as Chapter;
    act(() => useViewerStore.getState().setNextChapterData({ chapterId: "b-next", chapter, pages: [], seriesId: "B" }));
    rerender({ chapterId: "b-next" }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(result.current.volumeId).toBe("B-volume-2");
    expect(api.init).toHaveBeenCalledTimes(1);
  });

  it("resolves a legacy cache's series before applying swipe settings", async () => {
    api.init.mockResolvedValue(initFor("b", "B", "ltr"));
    api.volume.mockResolvedValue({ data: { series_id: "A" } });
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "b" } });
    await waitLoaded(result);
    cacheChapter("a-next", "A", false);
    rerender({ chapterId: "a-next" }); await waitLoaded(result);
    expect(api.volume).toHaveBeenCalledWith("A-volume");
    expect(api.swipe).toHaveBeenCalledWith("A");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
  });

  it("restores user default on A -> B -> A, ignoring the server direction", async () => {
    api.init.mockImplementation((id: string) => Promise.resolve(initFor(id, id === "b" ? "B" : "A", id === "b" ? "ltr" : null)));
    const { result, rerender } = renderHook(({ chapterId }) => useChapterLoader({ chapterId }), { initialProps: { chapterId: "a" } });
    await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().settings.readingDirection).toBe("ltr");
    rerender({ chapterId: "b" }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    rerender({ chapterId: "a" }); await waitLoaded(result);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
  });
});
