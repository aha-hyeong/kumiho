import { afterEach, describe, expect, it, vi } from "vitest";
import { rememberReturnFocus, takeReturnFocus } from "./returnFocus";

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("returnFocus", () => {
  it("stores and consumes the focused item only for its matching parent route", () => {
    rememberReturnFocus("library", "library-1", "series-42");

    expect(takeReturnFocus("library", "library-2")).toBeNull();
    expect(takeReturnFocus("library", "library-1")).toBe("series-42");
    expect(takeReturnFocus("library", "library-1")).toBeNull();
  });

  it("does not throw when session storage writes fail", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(() => rememberReturnFocus("library", "library-1", "series-42")).not.toThrow();
  });

  it("returns null when session storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(takeReturnFocus("library", "library-1")).toBeNull();
  });

  it("returns null when clearing a consumed focus target fails", () => {
    rememberReturnFocus("library", "library-1", "series-42");
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("storage denied");
    });

    expect(takeReturnFocus("library", "library-1")).toBeNull();
  });

  it("keeps library and series return targets isolated", () => {
    rememberReturnFocus("library", "library-1", "series-42");
    rememberReturnFocus("series", "series-42", "volume-7");

    expect(takeReturnFocus("series", "series-42")).toBe("volume-7");
    expect(takeReturnFocus("library", "library-1")).toBe("series-42");
  });
});
