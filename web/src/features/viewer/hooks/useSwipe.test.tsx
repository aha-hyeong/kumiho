import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadingDirection } from "../../../stores/viewerStore";
import { useSwipe } from "./useSwipe";

interface SurfaceProps {
  swipeDirection: ReadingDirection;
  readingDirection?: ReadingDirection;
  isZoomed?: boolean;
  onNext: () => void;
  onPrev: () => void;
}
function Surface({ readingDirection = "ltr", isZoomed = false, ...props }: SurfaceProps) {
  const gesture = useSwipe({ ...props, readingDirection, isZoomed, duration: 10 });
  return <div data-testid="surface" onTouchStart={gesture.onTouchStart} onTouchMove={gesture.onTouchMove} onTouchEnd={gesture.onTouchEnd} />;
}
const touch = (x: number, y = 100) => ({ clientX: x, clientY: y });
function swipe(left: boolean, count = 1, vertical = false) {
  const el = screen.getByTestId("surface");
  const start = left ? 200 : 100;
  const end = left ? 100 : 200;
  fireEvent.touchStart(el, { touches: Array.from({ length: count }, () => touch(start)) });
  fireEvent.touchMove(el, { touches: [touch(end, vertical ? 300 : 100)] });
  fireEvent.touchMove(el, { touches: [touch(end, vertical ? 300 : 100)] });
  fireEvent.touchEnd(el);
  act(() => vi.advanceTimersByTime(10));
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

describe("swipe direction gesture", () => {
  it.each([
    ["ltr", true, "next"], ["ltr", false, "previous"],
    ["rtl", true, "previous"], ["rtl", false, "next"],
  ] as const)("%s left=%s maps to %s, independently of reading direction", (direction, left, expected) => {
    const next = vi.fn(), prev = vi.fn();
    render(<Surface swipeDirection={direction} readingDirection={direction === "ltr" ? "rtl" : "ltr"} onNext={next} onPrev={prev} />);
    swipe(left);
    expect(next).toHaveBeenCalledTimes(expected === "next" ? 1 : 0);
    expect(prev).toHaveBeenCalledTimes(expected === "previous" ? 1 : 0);
  });

  it("uses a changed direction without remounting", () => {
    const next = vi.fn(), prev = vi.fn();
    const { rerender } = render(<Surface swipeDirection="ltr" onNext={next} onPrev={prev} />);
    swipe(true); expect(next).toHaveBeenCalledTimes(1);
    rerender(<Surface swipeDirection="rtl" onNext={next} onPrev={prev} />);
    swipe(true); expect(prev).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each(["zoom", "multitouch", "vertical"] as const)("does not navigate during %s", (restriction) => {
    const next = vi.fn(), prev = vi.fn();
    render(<Surface swipeDirection="rtl" isZoomed={restriction === "zoom"} onNext={next} onPrev={prev} />);
    swipe(true, restriction === "multitouch" ? 2 : 1, restriction === "vertical");
    expect(next).not.toHaveBeenCalled(); expect(prev).not.toHaveBeenCalled();
  });
});
