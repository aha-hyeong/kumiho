import { describe, it, expect } from "vitest";
import { calculateProgressDisplay, formatDuration } from "./progressUtils";
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

  describe("formatDuration", () => {
    it("should return 0:00 for negative and NaN input", () => {
      expect(formatDuration(-1)).toBe("0:00");
      expect(formatDuration(Number.NaN)).toBe("0:00");
    });

    it("should format under 1 hour as M:SS", () => {
      expect(formatDuration(65)).toBe("1:05");
    });

    it("should format over 1 hour as H:MM:SS", () => {
      expect(formatDuration(3661)).toBe("1:01:01");
    });
  });

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
        is_bookmarked: false,
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
        is_bookmarked: false,
      };
      const result = calculateProgressDisplay({ type: "volume", series: mockSeries, volume, t: mockT });
      expect(result.percent).toBe(45);
      expect(result.label).toBe("45 / 100 P");
    });

    it("should prefer volume progress_percent for variable-page media", () => {
      const volume: Volume = {
        id: "v1",
        series_id: "s1",
        title: "Vol 1",
        volume_number: 1,
        path: "",
        created_at: "",
        total_page_count: 1,
        read_page_count: 0,
        progress_percent: 13.3,
        is_bookmarked: false,
      };
      const result = calculateProgressDisplay({ type: "volume", series: mockSeries, volume, t: mockT });
      expect(result.percent).toBe(13.3);
      expect(result.label).toBe("0 / 1 P");
    });

    it("should show percent-only label when preferred for variable-page volume", () => {
      const volume: Volume = {
        id: "v1",
        series_id: "s1",
        title: "Vol 1",
        volume_number: 1,
        path: "",
        created_at: "",
        total_page_count: 1,
        read_page_count: 0,
        progress_percent: 13.3,
        is_bookmarked: false,
      };
      const result = calculateProgressDisplay({
        type: "volume",
        series: mockSeries,
        volume,
        preferPercentLabel: true,
        t: mockT,
      });
      expect(result.percent).toBe(13.3);
      expect(result.label).toBe("13%");
    });

    it("should fallback to progress object if page counts are missing", () => {
      const volume: Volume = { id: "v1", series_id: "s1", title: "Vol 1", volume_number: 1, path: "", created_at: "", is_bookmarked: false };
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

    it("should show percent-only label when preferred for variable-page series", () => {
      const result = calculateProgressDisplay({
        type: "series",
        series: mockSeries,
        summary: {
          current_volume_number: 1,
          total_volumes: 3,
          current_chapter_number: 2,
          total_chapters: 10,
          total_pages: 300,
          read_pages: 99,
        },
        preferPercentLabel: true,
        t: mockT,
      });
      expect(result.percent).toBe(33);
      expect(result.label).toBe("33%");
    });

    it("should return not read label if no progress", () => {
      const result = calculateProgressDisplay({ type: "series", series: mockSeries, t: mockT });
      expect(result.percent).toBe(0);
      expect(result.label).toBe("series.info.not_read");
    });

    it("should calculate audiobook series progress with duration summary", () => {
      const audioSeries: Series = { ...mockSeries, library_type: "audiobook" };
      const result = calculateProgressDisplay({
        type: "series",
        series: audioSeries,
        summary: {
          current_volume_number: 1,
          total_volumes: 3,
          current_chapter_number: 2,
          total_chapters: 10,
          total_duration: 120,
          listened_duration: 30,
        },
        t: mockT,
      });
      expect(result.percent).toBe(25);
      expect(result.label).toBe("25% (0:30 / 2:00)");
    });

    it("should clamp listened duration to total duration in audiobook series label", () => {
      const audioSeries: Series = { ...mockSeries, library_type: "audiobook" };
      const result = calculateProgressDisplay({
        type: "series",
        series: audioSeries,
        summary: {
          current_volume_number: 1,
          total_volumes: 3,
          current_chapter_number: 2,
          total_chapters: 10,
          total_duration: 120,
          listened_duration: 121,
        },
        t: mockT,
      });
      expect(result.percent).toBe(100);
      expect(result.label).toBe("100% (2:00 / 2:00)");
    });

    it("should prefer volume count label when display_unit is volume and page counts are missing", () => {
      const series: Series = { ...mockSeries, display_unit: "volume", volume_count: 4, chapter_count: 12 };
      const result = calculateProgressDisplay({ type: "series", series, t: mockT });
      expect(result.percent).toBe(0);
      expect(result.label).toBe("series.unit.volume");
    });

    it("should prefer chapter count label when display_unit is chapter and page counts are missing", () => {
      const series: Series = { ...mockSeries, display_unit: "chapter", chapter_count: 12, volume_count: 4 };
      const result = calculateProgressDisplay({ type: "series", series, t: mockT });
      expect(result.percent).toBe(0);
      expect(result.label).toBe("series.unit.chapter_count");
    });

    it("should keep legacy fallback order when display_unit is missing", () => {
      const series = { ...mockSeries, chapter_count: 12, volume_count: 4 };
      const result = calculateProgressDisplay({ type: "series", series, t: mockT });
      expect(result.percent).toBe(0);
      expect(result.label).toBe("series.unit.chapter_count");
    });
  });

  describe("calculateProgressDisplay - Audiobook Volume", () => {
    it("should calculate volume progress by current_time and duration", () => {
      const audioSeries: Series = { ...mockSeries, library_type: "audiobook" };
      const volume: Volume = {
        id: "v1",
        series_id: "s1",
        title: "Vol 1",
        volume_number: 1,
        path: "",
        created_at: "",
        is_bookmarked: false,
      };
      const progress: ReadingProgress = {
        id: "p1",
        user_id: "u1",
        series_id: "s1",
        chapter_id: "c1",
        current_page: 0,
        total_pages: 0,
        progress_percent: 0,
        updated_at: "",
        current_time: 45,
        duration: 180,
      };
      const result = calculateProgressDisplay({ type: "volume", series: audioSeries, volume, progress, t: mockT });
      expect(result.percent).toBe(25);
      expect(result.label).toBe("25% (0:45 / 3:00)");
    });
  });
});
