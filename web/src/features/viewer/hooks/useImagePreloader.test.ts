import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useImagePreloader } from "./useImagePreloader";
import type { Chapter } from "../types";

const pageBehavior = new Map<number, "load" | "error">();

class MockImage {
  onload: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;

  set src(value: string) {
    const match = value.match(/\/pages\/(\d+)\/image/);
    const page = match ? Number(match[1]) : 0;
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
    vi.stubGlobal("Image", MockImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resets on chapter change and still settles preloaded page to false", async () => {
    const { result, rerender } = renderHook(
      ({ chapter, chapterId }) =>
        useImagePreloader({
          chapter,
          chapterId,
          currentPage: 1,
          totalPages: 5,
          preloadCount: 1,
          readingMode: "double",
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

  it("always settles preload state to false for both onload and onerror", async () => {
    pageBehavior.set(1, "load");
    pageBehavior.set(3, "error");

    const { result } = renderHook(() =>
      useImagePreloader({
        chapter: createChapter("chapter-c"),
        chapterId: "chapter-c",
        currentPage: 2,
        totalPages: 5,
        preloadCount: 1,
        readingMode: "double",
      }),
    );

    await waitFor(() => {
      expect(result.current.imageLoading[1]).toBe(false);
      expect(result.current.imageLoading[3]).toBe(false);
    });
  });
});
