import { describe, expect, it } from "vitest";
import { findMissingNumberRanges, formatMissingNumberRanges } from "./missingNumbers";

describe("findMissingNumberRanges", () => {
  it("등록된 회차 번호 사이의 빈 번호를 범위로 반환한다", () => {
    expect(findMissingNumberRanges([1, 3, 4, 5, 7, 9, 10])).toEqual([
      { start: 2, end: 2 },
      { start: 6, end: 6 },
      { start: 8, end: 8 },
    ]);
  });

  it("연속된 누락 번호를 하나의 범위로 묶는다", () => {
    expect(findMissingNumberRanges([1, 5])).toEqual([{ start: 2, end: 4 }]);
  });

  it("중복, 0 이하, 소수 번호는 누락 계산에서 제외한다", () => {
    expect(findMissingNumberRanges([0, 1, 1, 1.5, 3, -2, 5])).toEqual([
      { start: 2, end: 2 },
      { start: 4, end: 4 },
    ]);
  });

  it("처음 번호 앞이나 마지막 번호 뒤의 번호는 추정하지 않는다", () => {
    expect(findMissingNumberRanges([3, 4, 5])).toEqual([]);
  });

  it("누락 번호는 화면에서 각각의 화 또는 권으로 표시할 수 있게 펼친다", () => {
    expect(formatMissingNumberRanges([{ start: 2, end: 4 }, { start: 7, end: 7 }], "화")).toBe("2화, 3화, 4화, 7화");
  });
});
