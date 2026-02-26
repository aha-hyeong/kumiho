import { describe, it, expect } from "vitest";
import { calculateGlobalProgress, calculatePercentageFromPages } from "./epubUtils";

describe("EPUB Progress Utilities", () => {
  describe("calculateGlobalProgress", () => {
    it("should return percentage if available and greater than 0", () => {
      const result = calculateGlobalProgress({
        percentage: 0.25,
        index: 10,
        spineLength: 100,
      });
      expect(result).toBe(0.25);
    });

    it("should estimate progress using spine index if percentage is 0", () => {
      const result = calculateGlobalProgress({
        percentage: 0,
        index: 25,
        spineLength: 100,
      });
      expect(result).toBe(0.25);
    });

    it("should return 0 if no info is provided", () => {
      const result = calculateGlobalProgress({
        percentage: undefined,
        index: 0,
        spineLength: 0,
      });
      expect(result).toBe(0);
    });

    it("should return 0 for the very beginning of the book", () => {
      const result = calculateGlobalProgress({
        percentage: 0,
        index: 0,
        spineLength: 100,
      });
      expect(result).toBe(0);
    });
  });

  describe("calculatePercentageFromPages", () => {
    it("should calculate correct percentage", () => {
      expect(calculatePercentageFromPages(50, 100)).toBe(0.5);
      expect(calculatePercentageFromPages(0, 100)).toBe(0);
      expect(calculatePercentageFromPages(100, 100)).toBe(1);
    });

    it("should handle division by zero", () => {
      expect(calculatePercentageFromPages(10, 0)).toBe(0);
    });

    it("should clamp values between 0 and 1", () => {
      expect(calculatePercentageFromPages(110, 100)).toBe(1);
      expect(calculatePercentageFromPages(-10, 100)).toBe(0);
    });
  });
});
