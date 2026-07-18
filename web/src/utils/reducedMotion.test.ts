import { afterEach, describe, expect, it, vi } from "vitest";
import { prefersReducedMotion } from "./reducedMotion";

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
});

describe("prefersReducedMotion", () => {
  it("returns false when matchMedia is unavailable", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });

    expect(prefersReducedMotion()).toBe(false);
  });

  it("returns the reduced-motion media-query result", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });

    expect(prefersReducedMotion()).toBe(true);
  });
});
