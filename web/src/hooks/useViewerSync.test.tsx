import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useViewerSync } from "./useViewerSync";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    progressUpdate: vi.fn().mockResolvedValue(undefined),
    viewerStart: vi.fn().mockResolvedValue(undefined),
    subscribe: vi.fn().mockReturnValue(() => {}),
  },
}));

vi.mock("./useSSE", () => ({
  useSSE: () => ({
    subscribe: mocks.subscribe,
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../api/client", () => ({
  progressAPI: {
    update: mocks.progressUpdate,
  },
  viewerAPI: {
    start: mocks.viewerStart,
  },
}));

describe("useViewerSync", () => {
  beforeEach(() => {
    mocks.progressUpdate.mockClear();
    mocks.viewerStart.mockClear();
    mocks.subscribe.mockClear();
  });

  it("skips first sync for each chapter and syncs from second page event", async () => {
    const { rerender } = renderHook(
      ({ chapterId, currentPage }) =>
        useViewerSync({
          seriesId: "series-1",
          chapterId,
          currentPage,
          isLoading: false,
        }),
      {
        initialProps: {
          chapterId: "chapter-1",
          currentPage: 30,
        },
      },
    );

    await waitFor(() => expect(mocks.progressUpdate).not.toHaveBeenCalled());

    rerender({ chapterId: "chapter-1", currentPage: 31 });

    await waitFor(() => {
      expect(mocks.progressUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.progressUpdate).toHaveBeenLastCalledWith({
        series_id: "series-1",
        chapter_id: "chapter-1",
        current_page: 31,
      });
    });
  });

  it("does not leak previous chapter page during chapter switch/loading", async () => {
    const { rerender } = renderHook(
      ({ chapterId, currentPage, isLoading }) =>
        useViewerSync({
          seriesId: "series-1",
          chapterId,
          currentPage,
          isLoading,
        }),
      {
        initialProps: {
          chapterId: "chapter-1",
          currentPage: 30,
          isLoading: false,
        },
      },
    );

    rerender({ chapterId: "chapter-1", currentPage: 31, isLoading: false });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // chapter switched but loader still stabilizing; old page must not be sent to new chapter
    rerender({ chapterId: "chapter-2", currentPage: 31, isLoading: true });
    rerender({ chapterId: "chapter-2", currentPage: 1, isLoading: true });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // first stable event for chapter-2 is skipped
    rerender({ chapterId: "chapter-2", currentPage: 1, isLoading: false });
    await waitFor(() => expect(mocks.progressUpdate).toHaveBeenCalledTimes(1));

    // actual movement in chapter-2 gets synced
    rerender({ chapterId: "chapter-2", currentPage: 2, isLoading: false });
    await waitFor(() => {
      expect(mocks.progressUpdate).toHaveBeenCalledTimes(2);
      expect(mocks.progressUpdate).toHaveBeenLastCalledWith({
        series_id: "series-1",
        chapter_id: "chapter-2",
        current_page: 2,
      });
    });
  });
});
