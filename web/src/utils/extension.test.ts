import { describe, expect, it } from "vitest";
import {
  normalizeExtensionBadge,
  parseSupportedExtension,
} from "./extension";

describe("extension utils", () => {
  describe("parseSupportedExtension", () => {
    it("query/hash가 포함된 경로에서도 확장자를 파싱한다", () => {
      expect(parseSupportedExtension("/books/test.PDF?token=1#page=2")).toBe("PDF");
    });

    it("대소문자 구분 없이 지원 확장자를 파싱한다", () => {
      expect(parseSupportedExtension("/books/test.cBz")).toBe("CBZ");
    });

    it("txt 확장자를 지원한다", () => {
      expect(parseSupportedExtension("/books/test.txt")).toBe("TXT");
    });

    it("img 확장자를 지원한다 (IMG 확장자 지원)", () => {
      expect(parseSupportedExtension("/books/test.img")).toBe("IMG");
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

    it("txt를 확장자 배지로 정규화한다", () => {
      expect(normalizeExtensionBadge("txt")).toBe("TXT");
    });

    it("img를 확장자 배지로 정규화한다", () => {
      expect(normalizeExtensionBadge("img")).toBe("IMG");
    });

    it("미지원 값은 null을 반환한다", () => {
      expect(normalizeExtensionBadge("mobi")).toBeNull();
    });
  });

});
