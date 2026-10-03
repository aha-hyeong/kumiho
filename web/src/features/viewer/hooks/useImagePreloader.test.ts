import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { createElement, useLayoutEffect } from "react";
import { useImagePreloader } from "./useImagePreloader";
import type { Chapter } from "../types";
import { getDisplayPages } from "../../../utils/pageCalculator";
import type { PageMeta } from "../types";
import { SmartImageViewer } from "../../../components/SmartImageViewer";
import { getPageImageUrl } from "../utils/imageUrl";

const pageBehavior = new Map<number, "load" | "error">();
const requestedPages: number[] = [];

class DeferredImage {
  static requests: DeferredImage[] = [];
  src = "";
  onload: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  constructor() { DeferredImage.requests.push(this); }
}

class MockImage {
  onload: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  set src(value: string) {
    const match = value.match(/\/pages\/(\d+)\/image/);
    const page = match ? Number(match[1]) : 0;
    requestedPages.push(page);
    const behavior = pageBehavior.get(page) ?? "load";

    setTimeout(() => {
      if (behavior === "error") {
        this.onerror?.(new Event("error"));
        return;
      }
      this.onload?.(new Event("load"));
    }, 0);
  }
}

const createChapter = (id: string): Chapter => ({
  id,
  volume_id: `v-${id}`,
  title: `chapter-${id}`,
  chapter_number: 1,
  page_count: 10,
});

describe("useImagePreloader", () => {
  beforeEach(() => {
    pageBehavior.clear();
    requestedPages.length = 0;
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resets on chapter change and still settles preloaded page to false", async () => {
    // single 모드: currentPage만 visible → 나머지 페이지는 백그라운드 프리로드
    const { result, rerender } = renderHook(
      ({ chapter, chapterId }) =>
        useImagePreloader({
          chapter,
          chapterId,
          currentPage: 1,
          totalPages: 5,
          preloadCount: 1,
          readingMode: "single",
          displayPages: [1],
        }),
      {
        initialProps: {
          chapter: createChapter("chapter-a"),
          chapterId: "chapter-a",
        },
      },
    );

    await waitFor(() => {
      expect(result.current.imageLoading[2]).toBe(false);
    });

    rerender({
      chapter: createChapter("chapter-b"),
      chapterId: "chapter-b",
    });

    await waitFor(() => {
      expect(result.current.imageLoading[2]).toBe(false);
    });
  });

  it.each(["single", "double"] as const)("accepts immediately ready cached %s images after a chapter change", (readingMode) => {
    const displayPages = readingMode === "double" ? [1, 2] : [1];
    function CachedVisibleImages({ chapter }: { chapter: Chapter }) {
      const { imageLoading, handleImageLoad } = useImagePreloader({ chapter, chapterId: chapter.id, currentPage: 1, totalPages: 10, preloadCount: 0, readingMode, displayPages });
      useLayoutEffect(() => {
        // Model native cached IMG load events arriving before passive effects.
        // Use the real SmartImageViewer readiness handler, not a mocked callback.
        screen.getByTestId("cached-visible").querySelectorAll("img").forEach((image) => image.dispatchEvent(new Event("load")));
      }, [chapter.id, handleImageLoad]);
      return createElement("div", { "data-testid": "cached-visible" },
        ...displayPages.map((page) => createElement(SmartImageViewer, {
          key: `${chapter.id}-slot-${page}`,
          src: getPageImageUrl(chapter.id, page),
          alt: `page ${page}`,
          onVisualReady: () => handleImageLoad(page),
        })),
        createElement("output", { "data-testid": "loading-state" }, JSON.stringify(imageLoading)),
      );
    }
    const { rerender } = render(createElement(CachedVisibleImages, { chapter: createChapter("cached-a") }));
    const expected = Object.fromEntries(displayPages.map((page) => [page, false]));
    expect(JSON.parse(screen.getByTestId("loading-state").textContent!)).toEqual(expected);
    rerender(createElement(CachedVisibleImages, { chapter: createChapter("cached-b") }));
    expect(JSON.parse(screen.getByTestId("loading-state").textContent!)).toEqual(expected);
    expect(requestedPages).toEqual([]);
  });

  it("always settles preload state to false for both onload and onerror", async () => {
    pageBehavior.set(1, "load");
    pageBehavior.set(3, "error");

    // single 모드: currentPage(2)만 visible → page 1, 3은 백그라운드 프리로드
    const { result } = renderHook(() =>
      useImagePreloader({
        chapter: createChapter("chapter-c"),
        chapterId: "chapter-c",
        currentPage: 2,
        totalPages: 5,
        preloadCount: 1,
        readingMode: "single",
        displayPages: [2],
      }),
    );

    await waitFor(() => {
      expect(result.current.imageLoading[1]).toBe(false);
      expect(result.current.imageLoading[3]).toBe(false);
    });
  });

  it.each([
    { currentPage: 1, pageOffset: 0, widePages: [] },
    { currentPage: 2, pageOffset: 0, widePages: [] },
    { currentPage: 4, pageOffset: 0, widePages: [] },
    { currentPage: 1, pageOffset: 1, widePages: [] },
    { currentPage: 2, pageOffset: 1, widePages: [] },
    { currentPage: 3, pageOffset: 1, widePages: [] },
    { currentPage: 3, pageOffset: 0, widePages: [3] },
    { currentPage: 3, pageOffset: 1, widePages: [3] },
    { currentPage: 2, pageOffset: 0, widePages: [1] },
    { currentPage: 2, pageOffset: 1, widePages: [3] },
  ])("uses the actual spread for page $currentPage / offset $pageOffset / wide $widePages", async ({ currentPage, pageOffset, widePages }) => {
    const chapter = createChapter("spread");
    const pageMetaMap = new Map<number, PageMeta>(widePages.map((page) => [page, { pageNumber: page, width: 2600, height: 1600, isWide: true }]));
    const displayPages = getDisplayPages({ currentPage, totalPages: 10, readingMode: "double", pageOffset, pageMetaMap });
    let renders = 0;
    const { result, rerender } = renderHook(() => {
      renders++;
      return useImagePreloader({ chapter, chapterId: chapter.id, currentPage, totalPages: 10, preloadCount: 2, readingMode: "double", displayPages: [...displayPages] });
    });
    const surrounding = Array.from({ length: 5 }, (_, index) => currentPage - 2 + index).filter((page) => page >= 1 && page <= 10);
    const background = surrounding.filter((page) => !displayPages.includes(page));
    await waitFor(() => background.forEach((page) => expect(result.current.imageLoading[page]).toBe(false)));
    displayPages.forEach((page) => expect(result.current.imageLoading[page]).toBe(true));
    expect([...requestedPages].sort((a, b) => a - b)).toEqual(background.sort((a, b) => a - b));
    const settled = result.current.imageLoading;
    rerender();
    expect(result.current.imageLoading).toBe(settled);
    expect(requestedPages).toHaveLength(background.length);
    expect(renders).toBeLessThan(10);
  });

  it("tracks the entire visible spread even with no surrounding preload", () => {
    const { result } = renderHook(() => useImagePreloader({ chapter: createChapter("zero"), chapterId: "zero", currentPage: 1, totalPages: 10, preloadCount: 0, readingMode: "double", displayPages: [1, 2] }));
    expect(result.current.imageLoading).toEqual({ 1: true, 2: true });
    expect(requestedPages).toEqual([]);
  });

  it.each(["load", "error"] as const)("starts one background request when a loading visible page leaves the spread (%s)", (completion) => {
    DeferredImage.requests = [];
    vi.stubGlobal("Image", DeferredImage);
    const chapter = createChapter("changed-spread");
    const { result, rerender } = renderHook(({ displayPages }) => useImagePreloader({ chapter, chapterId: chapter.id, currentPage: 3, totalPages: 10, preloadCount: 1, readingMode: "double", displayPages }), { initialProps: { displayPages: [3, 4] } });
    const page4Requests = () => DeferredImage.requests.filter((image) => image.src === getPageImageUrl(chapter.id, 4));
    expect(result.current.imageLoading[4]).toBe(true);
    expect(page4Requests()).toHaveLength(0);
    rerender({ displayPages: [3] });
    expect(page4Requests()).toHaveLength(1);
    const request = page4Requests()[0];
    for (let i = 0; i < 3; i++) rerender({ displayPages: [3] });
    // Completing another background page reruns the effect while 4 is pending.
    const page2 = DeferredImage.requests.find((image) => image.src === getPageImageUrl(chapter.id, 2))!;
    act(() => page2.onload!(new Event("load")));
    rerender({ displayPages: [3, 4] });
    rerender({ displayPages: [3] });
    expect(page4Requests()).toHaveLength(1);
    act(() => completion === "load" ? request.onload!(new Event("load")) : request.onerror!(new Event("error")));
    expect(result.current.imageLoading[4]).toBe(false);
    expect(request.onload).toBeNull();
    expect(request.onerror).toBeNull();
    const settled = result.current.imageLoading;
    rerender({ displayPages: [3, 4] });
    expect(result.current.imageLoading).toBe(settled);
    expect(page4Requests()).toHaveLength(1);
  });

  it("does not restart a request completed before passive effects observe its state", () => {
    DeferredImage.requests = [];
    vi.stubGlobal("Image", DeferredImage);
    const chapter = createChapter("completion-before-effect");
    const src = getPageImageUrl(chapter.id, 2);
    const { result, rerender } = renderHook(({ complete }) => {
      const preloader = useImagePreloader({ chapter, chapterId: chapter.id, currentPage: 1, totalPages: 10, preloadCount: 1, readingMode: "single", displayPages: [1] });
      useLayoutEffect(() => {
        if (complete) DeferredImage.requests.find((image) => image.src === src)!.onload!(new Event("load"));
      }, [complete]);
      return preloader;
    }, { initialProps: { complete: false } });
    expect(result.current.imageLoading[2]).toBe(true);
    rerender({ complete: true });
    expect(result.current.imageLoading[2]).toBe(false);
    expect(DeferredImage.requests.filter((image) => image.src === src)).toHaveLength(1);
  });

  it("isolates old callbacks and request ownership across A to B to A and unmount", () => {
    DeferredImage.requests = [];
    vi.stubGlobal("Image", DeferredImage);
    const chapterA = createChapter("owner-a");
    const chapterB = createChapter("owner-b");
    const { result, rerender, unmount } = renderHook(({ chapter }) => useImagePreloader({ chapter, chapterId: chapter.id, currentPage: 3, totalPages: 10, preloadCount: 1, readingMode: "double", displayPages: [3] }), { initialProps: { chapter: chapterA } });
    const page4Requests = (chapter: Chapter) => DeferredImage.requests.filter((image) => image.src === getPageImageUrl(chapter.id, 4));
    const originalA = page4Requests(chapterA)[0];
    const oldACompletion = originalA.onload!;
    const oldReady = result.current.handleImageLoad;
    rerender({ chapter: chapterB });
    expect(originalA.onload).toBeNull();
    expect(originalA.onerror).toBeNull();
    expect(page4Requests(chapterB)).toHaveLength(1);
    const chapterBState = result.current.imageLoading;
    act(() => oldReady(3));
    expect(result.current.imageLoading).toBe(chapterBState);
    const oldBCompletion = page4Requests(chapterB)[0].onerror!;
    rerender({ chapter: chapterA });
    expect(page4Requests(chapterA)).toHaveLength(2);
    const currentA = page4Requests(chapterA)[1];
    const pendingAState = result.current.imageLoading;
    act(() => {
      oldACompletion(new Event("load"));
      oldBCompletion(new Event("error"));
    });
    expect(result.current.imageLoading).toBe(pendingAState);
    expect(result.current.imageLoading[4]).toBe(true);
    rerender({ chapter: chapterA });
    expect(page4Requests(chapterA)).toHaveLength(2);
    act(() => currentA.onload!(new Event("load")));
    expect(result.current.imageLoading[4]).toBe(false);
    unmount();
    DeferredImage.requests.forEach((image) => {
      expect(image.onload).toBeNull();
      expect(image.onerror).toBeNull();
    });
  });

  it("preserves vertical background preload and its sequential rendering window", async () => {
    const { result } = renderHook(() => useImagePreloader({ chapter: createChapter("vertical"), chapterId: "vertical", currentPage: 2, totalPages: 10, preloadCount: 2, readingMode: "vertical", displayPages: Array.from({ length: 10 }, (_, index) => index + 1) }));
    await waitFor(() => expect(result.current.imageLoading[1]).toBe(false));
    expect(result.current.imageLoading[2]).toBe(true);
    expect([...requestedPages].sort((a, b) => a - b)).toEqual([1, 3, 4]);
    expect(result.current.maxAllowedPage).toBe(6);
  });
});
