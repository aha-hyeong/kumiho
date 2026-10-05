import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useViewerStore } from "../../../stores/viewerStore";
import { UI_HIDE_DELAY } from "../utils/constants";
import { useViewerAutoHide } from "./useViewerAutoHide";

const visible = { isUIVisible: true, isSettingsOpen: false, currentPage: 1 };
beforeEach(() => {
  useViewerStore.setState(useViewerStore.getInitialState(), true);
  vi.useFakeTimers();
  vi.setSystemTime(100000);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

it("schedules visible UI hiding and cleans up on hide/unmount", () => {
  const hide = vi.spyOn(useViewerStore.getState(), "hideUI");
  const { rerender, unmount } = renderHook(useViewerAutoHide, { initialProps: visible });
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY - 1));
  expect(hide).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(hide).toHaveBeenCalledTimes(1);
  rerender({ ...visible, isUIVisible: false });
  expect(vi.getTimerCount()).toBe(0);
  rerender(visible);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY));
  expect(hide).toHaveBeenCalledTimes(1);
});

it("pauses while settings are open and restarts after closing", () => {
  const hide = vi.spyOn(useViewerStore.getState(), "hideUI");
  const { rerender } = renderHook(useViewerAutoHide, { initialProps: visible });
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY / 2));
  rerender({ ...visible, isSettingsOpen: true });
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY * 2));
  expect(hide).not.toHaveBeenCalled();
  rerender(visible);
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY));
  expect(hide).toHaveBeenCalledTimes(1);
});

it.each([UI_HIDE_DELAY - 1, UI_HIDE_DELAY])("pauses interaction and ends after %i ms with the existing full-delay/immediate rule", (elapsed) => {
  const hide = vi.spyOn(useViewerStore.getState(), "hideUI");
  const { result, rerender } = renderHook(useViewerAutoHide, { initialProps: visible });
  act(() => result.current.handleInteractionStart());
  expect(vi.getTimerCount()).toBe(0);
  act(() => vi.advanceTimersByTime(elapsed));
  rerender({ ...visible, currentPage: 2 });
  expect(vi.getTimerCount()).toBe(0);
  act(() => result.current.handleInteractionEnd());
  if (elapsed < UI_HIDE_DELAY) {
    expect(hide).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(UI_HIDE_DELAY - 1));
    expect(hide).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
  }
  expect(hide).toHaveBeenCalledTimes(1);
});

it("restarts the timer on page changes without resetting visible-start time", () => {
  const hide = vi.spyOn(useViewerStore.getState(), "hideUI");
  const { result, rerender } = renderHook(useViewerAutoHide, { initialProps: visible });
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY / 2));
  rerender({ ...visible, currentPage: 2 });
  act(() => vi.advanceTimersByTime(UI_HIDE_DELAY / 2));
  expect(hide).not.toHaveBeenCalled();
  act(() => result.current.handleInteractionStart());
  act(() => result.current.handleInteractionEnd());
  expect(hide).toHaveBeenCalledTimes(1);
});
