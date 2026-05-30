import { describe, expect, it } from "vitest";
import { getValidNumber } from "./number";

describe("getValidNumber", () => {
  it("should return parsed number for valid inputs", () => {
    expect(getValidNumber(123)).toBe(123);
    expect(getValidNumber("123")).toBe(123);
    expect(getValidNumber("12.5")).toBe(12.5);
  });

  it("should return NaN for empty, null, or undefined inputs", () => {
    expect(getValidNumber("")).toBeNaN();
    expect(getValidNumber(null)).toBeNaN();
    expect(getValidNumber(undefined)).toBeNaN();
  });

  it("should return NaN for invalid numeric values", () => {
    expect(getValidNumber("abc")).toBeNaN();
    expect(getValidNumber({})).toBeNaN();
  });
});
