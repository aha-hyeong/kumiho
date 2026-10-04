import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSwipe } from "./useSwipe";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

describe("swipe preparation lifecycle", () => {
  it.each(["chapter", "page", "mode"])("invalidates an already running timer after %s scope replacement", async (scope) => {
    const next = vi.fn();
    const { result, rerender } = renderHook(({ key }) => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, navigationKey: key, prepareTransition: () => Promise.resolve() }), { initialProps: { key: "chapter-a-single-1" } });
    act(() => result.current.animateNext());
    await act(async () => {});
    expect(result.current.isAnimating).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    rerender({ key: `${scope}-replacement` });
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
    expect(result.current.swipeOffset).toBe(0);
    expect(result.current.isAnimating).toBe(false);
  });

  it("ignores old A preparation after A → B → A creates a newer request", async () => {
    const old = deferred(), fresh = deferred(), next = vi.fn();
    const { result, rerender } = renderHook(({ key, prepare }) => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, navigationKey: key, prepareTransition: prepare }), { initialProps: { key: "a", prepare: () => old.promise } });
    act(() => result.current.animateNext());
    rerender({ key: "b", prepare: () => fresh.promise });
    rerender({ key: "a", prepare: () => fresh.promise });
    act(() => result.current.animateNext());
    await act(async () => old.resolve());
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
    await act(async () => fresh.resolve());
    act(() => vi.advanceTimersByTime(300));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("does not invoke navigation after unmount during pending decode", async () => {
    const ready = deferred(), next = vi.fn();
    const { result, unmount } = renderHook(() => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, prepareTransition: () => ready.promise }));
    act(() => result.current.animateNext());
    unmount();
    await act(async () => ready.resolve());
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
  });

  it("shares visual preparation with touch snap, without changing swipe direction", async () => {
    const ready = deferred(), next = vi.fn(), prev = vi.fn(), prepare = vi.fn(() => ready.promise);
    function Surface() {
      const swipe = useSwipe({ onNext: next, onPrev: prev, readingDirection: "ltr", swipeDirection: "rtl", isZoomed: false, prepareTransition: prepare });
      return <div data-testid="surface" onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} />;
    }
    render(<Surface />);
    const surface = screen.getByTestId("surface");
    const touch = (x: number) => ({ clientX: x, clientY: 100 });
    fireEvent.touchStart(surface, { touches: [touch(100)] });
    fireEvent.touchMove(surface, { touches: [touch(200)] });
    fireEvent.touchMove(surface, { touches: [touch(250)] });
    fireEvent.touchEnd(surface);
    expect(prepare).toHaveBeenCalledWith("next", expect.any(Function));
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
    await act(async () => ready.resolve());
    act(() => vi.advanceTimersByTime(300));
    expect(next).toHaveBeenCalledTimes(1);
    expect(prev).not.toHaveBeenCalled();
  });

  it("snaps the released touch to the target while decode is still pending", async () => {
    const ready = deferred(), next = vi.fn();
    function Surface() {
      const swipe = useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, prepareTransition: () => ready.promise, animateWhilePreparing: true });
      return <div data-testid="pending-surface" data-offset={swipe.swipeOffset} data-animating={String(swipe.isAnimating)} onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd} />;
    }
    render(<Surface />);
    const surface = screen.getByTestId("pending-surface");
    const touch = (x: number) => ({ clientX: x, clientY: 100 });
    fireEvent.touchStart(surface, { touches: [touch(760)] });
    fireEvent.touchMove(surface, { touches: [touch(710)] });
    fireEvent.touchMove(surface, { touches: [touch(610)] });
    expect(surface).toHaveAttribute("data-offset", "-150");
    fireEvent.touchEnd(surface);
    act(() => vi.advanceTimersByTime(2000));
    expect(next).not.toHaveBeenCalled();
    expect(surface).toHaveAttribute("data-offset", String(-(window.innerWidth + 20)));
    await act(async () => ready.resolve());
    expect(next).toHaveBeenCalledTimes(1);
    expect(surface).toHaveAttribute("data-offset", "0");
    expect(surface).toHaveAttribute("data-animating", "false");
  });

  it.each([0, 299, 300, 301, 2000])("commits once after both slide and readiness complete (decode %dms)", async (delay) => {
    const ready = deferred(), next = vi.fn();
    const { result } = renderHook(() => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, prepareTransition: () => ready.promise, animateWhilePreparing: true }));
    act(() => result.current.animateNext());
    expect(result.current.isAnimating).toBe(true);
    expect(result.current.swipeOffset).toBe(-(window.innerWidth + 20));
    act(() => vi.advanceTimersByTime(delay));
    expect(next).not.toHaveBeenCalled();
    await act(async () => ready.resolve());
    if (delay < 300) {
      expect(next).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(300 - delay));
    }
    expect(next).toHaveBeenCalledTimes(1);
    expect(result.current.swipeOffset).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it.each([100, 2000])("cancels a pending parallel handoff after scope change at %dms", async (delay) => {
    const ready = deferred(), next = vi.fn();
    const { result, rerender } = renderHook(({ key }) => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, navigationKey: key, prepareTransition: () => ready.promise, animateWhilePreparing: true }), { initialProps: { key: "chapter-a" } });
    act(() => result.current.animateNext());
    act(() => vi.advanceTimersByTime(delay));
    rerender({ key: "chapter-b" });
    await act(async () => ready.resolve());
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
    expect(result.current.swipeOffset).toBe(0);
    expect(result.current.isAnimating).toBe(false);
  });

  it("ignores parallel A → B → A completion from a cancelled older transition", async () => {
    const old = deferred(), fresh = deferred(), next = vi.fn();
    const { result, rerender } = renderHook(({ key, prepare }) => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, navigationKey: key, prepareTransition: prepare, animateWhilePreparing: true }), { initialProps: { key: "a", prepare: () => old.promise } });
    act(() => result.current.animateNext());
    act(() => vi.advanceTimersByTime(400));
    rerender({ key: "b", prepare: () => fresh.promise });
    rerender({ key: "a", prepare: () => fresh.promise });
    act(() => result.current.animateNext());
    await act(async () => old.resolve());
    act(() => vi.advanceTimersByTime(400));
    expect(next).not.toHaveBeenCalled();
    await act(async () => fresh.resolve());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("resets the parallel preview and cancels its timer when preparation rejects", async () => {
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((_, fail) => { reject = fail; }), next = vi.fn();
    const { result } = renderHook(() => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, prepareTransition: () => pending, animateWhilePreparing: true }));
    act(() => result.current.animateNext());
    await act(async () => reject(new Error("cancelled preparation")));
    act(() => vi.advanceTimersByTime(1000));
    expect(next).not.toHaveBeenCalled();
    expect(result.current.swipeOffset).toBe(0);
    expect(result.current.isAnimating).toBe(false);
  });

  it("keeps chapter-boundary skip navigation independent of image preparation", () => {
    const next = vi.fn(), prepare = vi.fn(() => new Promise<void>(() => {}));
    const { result } = renderHook(() => useSwipe({ onNext: next, onPrev: vi.fn(), readingDirection: "ltr", isZoomed: false, skipNextAnimation: true, prepareTransition: prepare }));
    act(() => result.current.animateNext());
    expect(next).toHaveBeenCalledTimes(1);
    expect(prepare).not.toHaveBeenCalled();
  });
});
