import { describe, expect, it, vi } from "vitest";
import {
  normalizeExtensionBadge,
  parseSupportedExtension,
  resolveExtensionFromVolumePaths,
  resolveSeriesExtensionMapWithCache,
} from "./extension";

describe("extension utils", () => {
  describe("parseSupportedExtension", () => {
    it("query/hash가 포함된 경로에서도 확장자를 파싱한다", () => {
      expect(parseSupportedExtension("/books/test.PDF?token=1#page=2")).toBe("PDF");
    });

    it("대소문자 구분 없이 지원 확장자를 파싱한다", () => {
      expect(parseSupportedExtension("/books/test.cBz")).toBe("CBZ");
    });

    it("미지원 확장자는 null을 반환한다", () => {
      expect(parseSupportedExtension("/books/test.mobi")).toBeNull();
    });
  });

  describe("normalizeExtensionBadge", () => {
    it("점(.)이 포함된 확장자를 정규화한다", () => {
      expect(normalizeExtensionBadge(".epub")).toBe("EPUB");
    });

    it("MIX를 유지한다", () => {
      expect(normalizeExtensionBadge("mix")).toBe("MIX");
    });

    it("미지원 값은 null을 반환한다", () => {
      expect(normalizeExtensionBadge("txt")).toBeNull();
    });
  });

  describe("resolveExtensionFromVolumePaths", () => {
    it("단일 포맷이면 해당 확장자를 반환한다", () => {
      expect(resolveExtensionFromVolumePaths("/series/test.pdf", ["/vol/1.pdf", "/vol/2.PDF"])).toBe("PDF");
    });

    it("여러 포맷이 섞이면 MIX를 반환한다", () => {
      expect(resolveExtensionFromVolumePaths("/series/test.pdf", ["/vol/1.pdf", "/vol/2.cbz"])).toBe("MIX");
    });
  });

  describe("resolveSeriesExtensionMapWithCache", () => {
    it("캐시를 재사용하고 미조회 시리즈만 조회한다", async () => {
      const cache = new Map<string, string>([["s1", "PDF"]]);
      const fetchVolumePaths = vi.fn(async (seriesId: string) => {
        if (seriesId === "s2") return ["/vol/2.cbz"];
        return [];
      });

      const map = await resolveSeriesExtensionMapWithCache({
        seriesList: [
          { id: "s1", path: "/series/s1.pdf" },
          { id: "s2", path: "/series/s2.cbz" },
        ],
        cache,
        fetchVolumePaths,
      });

      expect(fetchVolumePaths).toHaveBeenCalledTimes(1);
      expect(fetchVolumePaths).toHaveBeenCalledWith("s2");
      expect(map).toEqual({ s1: "PDF", s2: "CBZ" });
    });

    it("조회 실패 시 빈 값으로 처리한다", async () => {
      const onError = vi.fn();
      const map = await resolveSeriesExtensionMapWithCache({
        seriesList: [{ id: "s1", path: "/series/s1.pdf" }],
        cache: new Map<string, string>(),
        fetchVolumePaths: async () => {
          throw new Error("network");
        },
        onError,
      });

      expect(onError).toHaveBeenCalledTimes(1);
      expect(map).toEqual({});
    });
  });
});
