import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerSettings } from "./ViewerSettings";
import { useViewerStore } from "../../stores/viewerStore";

const api = vi.hoisted(() => ({ update: vi.fn(), reset: vi.fn(), error: vi.fn() }));
vi.mock("../../api/client", () => ({ seriesAPI: { updateViewerSettings: api.update, resetSwipeDirection: api.reset }, settingAPI: { update: vi.fn() } }));
vi.mock("react-hot-toast", () => ({ toast: { error: api.error } }));
vi.mock("../../utils/device", () => ({ isMobile: () => true }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const settings = (override: "ltr" | "rtl" | null, userDefault: "ltr" | "rtl" = "rtl") => ({ user_default: userDefault, series_override: override, effective_direction: override ?? userDefault });
const left = () => screen.getByRole("button", { name: /viewer.settings.nav_direction.ltr_mobile/ });
const right = () => screen.getByRole("button", { name: /viewer.settings.nav_direction.rtl_mobile/ });
const reset = () => screen.getByRole("button", { name: "viewer.settings.nav_direction.reset_to_global" });

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useViewerStore.getState().reset();
  useViewerStore.getState().initializeSwipeSettings("B", settings(null));
  api.update.mockResolvedValue({ message: "updated" });
  api.reset.mockResolvedValue(settings(null));
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function mount() { render(<ViewerSettings onClose={() => {}} />); }

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("series swipe preference UI", () => {
  it("keeps a newer user default when an older reset response arrives", async () => {
    const response = deferred<ReturnType<typeof settings>>();
    useViewerStore.getState().initializeSwipeSettings("B", settings("rtl", "ltr"));
    api.reset.mockReturnValue(response.promise);
    mount(); fireEvent.click(reset());
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    act(() => useViewerStore.getState().setSwipeUserDefault("rtl"));
    await act(async () => response.resolve(settings(null, "ltr")));
    expect(useViewerStore.getState().swipeUserDefault).toBe("rtl");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBeUndefined();
    expect(useViewerStore.getState().isSwipeSaving).toBe(false);
  });

  it.each([
    ["success", "save"], ["failure", "save"],
    ["success", "reset"], ["failure", "reset"],
  ] as const)("ignores previous-session %s and finally while a new %s owns busy state", async (outcome, operation) => {
    const old = deferred<{ message: string }>();
    const current = deferred<{ message: string } | ReturnType<typeof settings>>();
    api.update.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    api.reset.mockReturnValue(current.promise);
    mount(); fireEvent.click(left());
    act(() => {
      useViewerStore.getState().reset();
      useViewerStore.getState().initializeSwipeSettings("B", settings(operation === "reset" ? "rtl" : null, "ltr"));
    });
    fireEvent.click(operation === "reset" ? reset() : right());
    const expected = operation === "reset" ? "ltr" : "rtl";
    expect(useViewerStore.getState().isSwipeSaving).toBe(true);
    await act(async () => {
      if (outcome === "success") old.resolve({ message: "updated" });
      else old.reject(new Error("previous user request failed"));
    });
    expect(useViewerStore.getState().swipeUserDefault).toBe("ltr");
    expect(useViewerStore.getState().settings.swipeDirection).toBe(expected);
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBe(operation === "reset" ? undefined : "rtl");
    expect(useViewerStore.getState().isSwipeSaving).toBe(true);
    expect(api.error).not.toHaveBeenCalled();
    await act(async () => current.resolve(operation === "reset" ? settings(null, "ltr") : { message: "updated" }));
    expect(useViewerStore.getState().isSwipeSaving).toBe(false);
    expect(useViewerStore.getState().settings.swipeDirection).toBe(expected);
  });
  it("keeps the newer default after reset, navigation away, and re-entry into the same series", async () => {
    const response = deferred<ReturnType<typeof settings>>();
    useViewerStore.getState().initializeSwipeSettings("B", settings("rtl", "ltr"));
    api.reset.mockReturnValue(response.promise); mount(); fireEvent.click(reset());
    act(() => {
      useViewerStore.getState().setSwipeUserDefault("rtl");
      useViewerStore.getState().initializeSwipeSettings("A", settings(null));
      useViewerStore.getState().initializeSwipeSettings("B", settings(null));
    });
    await act(async () => response.resolve(settings(null, "ltr")));
    expect(useViewerStore.getState().currentSeriesId).toBe("B");
    expect(useViewerStore.getState().swipeUserDefault).toBe("rtl");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBeUndefined();
  });

  it.each(["success", "failure"])("ignores an old reset's %s and finally after a new session starts saving", async (outcome) => {
    const old = deferred<ReturnType<typeof settings>>(); const current = deferred<{ message: string }>();
    useViewerStore.getState().initializeSwipeSettings("B", settings("ltr"));
    api.reset.mockReturnValue(old.promise); api.update.mockReturnValue(current.promise);
    mount(); fireEvent.click(reset());
    act(() => {
      useViewerStore.getState().reset();
      useViewerStore.getState().initializeSwipeSettings("B", settings(null, "ltr"));
    });
    fireEvent.click(right());
    const state = useViewerStore.getState();
    await act(async () => {
      if (outcome === "success") old.resolve(settings(null));
      else old.reject(new Error("old reset failed"));
    });
    expect(useViewerStore.getState()).toBe(state);
    expect(useViewerStore.getState().isSwipeSaving).toBe(true);
    expect(useViewerStore.getState().swipeUserDefault).toBe("ltr");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(api.error).not.toHaveBeenCalled();
    await act(async () => current.resolve({ message: "updated" }));
    expect(useViewerStore.getState().isSwipeSaving).toBe(false);
  });

  it("creates an override even when selecting the currently inherited direction", async () => {
    mount(); fireEvent.click(right());
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("B", { swipe_direction: "rtl" }));
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBe("rtl");
    expect(reset()).toBeInTheDocument();
  });

  it("rolls back both effective value and override after a failed save", async () => {
    api.update.mockRejectedValue(new Error("failed save")); mount();
    fireEvent.click(left());
    await waitFor(() => expect(api.error).toHaveBeenCalled());
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBeUndefined();
  });

  it("keeps two direction options and offers a separate reset only after an override", async () => {
    mount(); expect(left()).toBeInTheDocument(); expect(right()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "viewer.settings.nav_direction.reset_to_global" })).not.toBeInTheDocument();
    fireEvent.click(left());
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("B", { swipe_direction: "ltr" }));
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    await waitFor(() => expect(reset()).toBeEnabled());
    fireEvent.click(reset());
    await waitFor(() => expect(api.reset).toHaveBeenCalledWith("B"));
    await waitFor(() => expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl"));
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBeUndefined();
  });

  it("restores an existing override if reset fails", async () => {
    useViewerStore.getState().initializeSwipeSettings("B", settings("ltr"));
    api.reset.mockRejectedValue(new Error("reset failed")); mount(); fireEvent.click(reset());
    await waitFor(() => expect(api.error).toHaveBeenCalled());
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBe("ltr");
  });

  it("disables changes until a series is known", () => {
    useViewerStore.getState().setCurrentSeriesId(null); mount();
    expect(left()).toBeDisabled(); expect(right()).toBeDisabled();
    fireEvent.click(left()); expect(api.update).not.toHaveBeenCalled();
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
  });

  it("serializes swipe saves and does not roll a late failure into another series", async () => {
    let rejectSave!: (error: Error) => void;
    api.update.mockReturnValue(new Promise((_, reject) => { rejectSave = reject; }));
    mount(); fireEvent.click(left());
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(right()).toBeDisabled(); fireEvent.click(right()); expect(api.update).toHaveBeenCalledTimes(1);
    act(() => useViewerStore.getState().initializeSwipeSettings("A", settings(null)));
    await act(async () => rejectSave(new Error("late failure")));
    expect(useViewerStore.getState().currentSeriesId).toBe("A");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBeUndefined();
  });
});
