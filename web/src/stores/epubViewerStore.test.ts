import { describe, expect, it } from "vitest";
import { normalizeEpubLineHeightScale } from "./epubViewerStore";

describe("normalizeEpubLineHeightScale", () => {
  it("새 배율 범위 내의 값은 그대로 유지한다", () => {
    expect(normalizeEpubLineHeightScale(0.75)).toBe(0.75);
    expect(normalizeEpubLineHeightScale(1.0)).toBe(1.0);
    expect(normalizeEpubLineHeightScale(1.2)).toBe(1.2);
    expect(normalizeEpubLineHeightScale(1.25)).toBe(1.25);
  });

  it("기존 절대 줄 간격(> 1.25 및 <= 2.0)을 새 배율 범위로 변환한다", () => {
    expect(normalizeEpubLineHeightScale(1.6)).toBe(1.0);
    expect(normalizeEpubLineHeightScale(2.0)).toBe(1.25);
  });
});
