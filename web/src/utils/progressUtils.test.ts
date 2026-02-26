import { describe, it, expect } from "vitest";
import { calculateProgressDisplay } from "./progressUtils";
import type { Series, Volume, ReadingProgress } from "../types/series";

describe("Progress Utilities", () => {
  const mockSeries: Series = {
    id: "s1",
    library_id: "l1",
    title: "Test Series",
    path: "",
    thumbnail_url: "",
    is_bookmarked: false,
    created_at: "",
    updated_at: "",
    description: "",
  };

  const mockT = (key: string) => key;

  describe("calculateProgressDisplay - Volume", () => {
    it("should return 100% if volume is completed", () => {
      const volume: Volume = {
        id: "v1",
        series_id: "s1",
        title: "Vol 1",
        volume_number: 1,
        path: "",
        created_at: "",
        is_completed: true,
      };
      const result = calculateProgressDisplay({ type: "volume", series: mockSeries, volume, t: mockT });
      expect(result.percent).toBe(100);
      expect(result.label).toBe("series.info.completed");
    });

    it("should calculate percent based on pages", () => {
      const volume: Volume = {
        id: "v1",
        series_id: "s1",
        title: "Vol 1",
        volume_number: 1,
        path: "",
        created_at: "",
        total_page_count: 100,
        read_page_count: 45,
      };
      const result = calculateProgressDisplay({ type: "volume", series: mockSeries, volume, t: mockT });
      expect(result.percent).toBe(45);
      expect(result.label).toBe("45 / 100 P");
    });

    it("should fallback to progress object if page counts are missing", () => {
      const volume: Volume = { id: "v1", series_id: "s1", title: "Vol 1", volume_number: 1, path: "", created_at: "" };
      const progress: ReadingProgress = {
        id: "p1",
        user_id: "u1",
        series_id: "s1",
        progress_percent: 12.5,
        current_page: 5,
        total_pages: 40,
        updated_at: "",
        chapter_id: "",
      };
      const result = calculateProgressDisplay({ type: "volume", series: mockSeries, volume, progress, t: mockT });
      expect(result.percent).toBe(12.5);
      expect(result.label).toBe("5 / 40 P");
    });
  });

  describe("calculateProgressDisplay - Series", () => {
    it("should calculate percent based on series page counts", () => {
      const series = { ...mockSeries, total_page_count: 200, read_page_count: 100 };
      const result = calculateProgressDisplay({ type: "series", series, t: mockT });
      expect(result.percent).toBe(50);
      expect(result.label).toContain("50%");
    });

    it("should return not read label if no progress", () => {
      const result = calculateProgressDisplay({ type: "series", series: mockSeries, t: mockT });
      expect(result.percent).toBe(0);
      expect(result.label).toBe("series.info.not_read");
    });
  });
});
