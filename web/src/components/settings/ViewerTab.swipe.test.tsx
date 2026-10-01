import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewerTab } from "./ViewerTab";
import { useViewerStore } from "../../stores/viewerStore";

const api = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), t: (key: string) => key }));
vi.mock("../../api/client", () => ({ settingAPI: { list: api.list, update: api.update } }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: api.t }) }));
vi.mock("../modals/AlertModal", () => ({ AlertModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button onClick={onConfirm}>Confirm reset</button> : null }));
vi.mock("../common/Toast", () => ({ Toast: () => null }));

beforeEach(() => {
  vi.resetAllMocks(); useViewerStore.getState().reset();
  api.list.mockResolvedValue({ swipe_direction: "rtl" }); api.update.mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("global swipe preference", () => {
  it.each(["success", "failure"])("ignores an older default save's %s after a newer save succeeds", async (outcome) => {
    const old = deferred<object>(); const current = deferred<object>();
    api.list.mockResolvedValue({ swipe_direction: "ltr" });
    api.update.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.change(select, { target: { value: "ltr" } });
    fireEvent.change(select, { target: { value: "rtl" } });
    expect(api.update).toHaveBeenCalledTimes(2);
    await act(async () => current.resolve({}));
    expect(useViewerStore.getState().swipeUserDefault).toBe("rtl");
    const state = useViewerStore.getState();
    await act(async () => {
      if (outcome === "success") old.resolve({});
      else old.reject(new Error("old default save failed"));
    });
    expect(useViewerStore.getState()).toBe(state);
    expect(select).toHaveValue("rtl");
    expect(console.error).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("ignores a previous session's full-reset %s and finally", async (outcome) => {
    const response = deferred<object>(); api.update.mockReturnValue(response.promise);
    render(<ViewerTab />);
    await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.click(screen.getAllByRole("button", { name: "settings.viewer.reset_button" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(api.update).toHaveBeenCalledWith("swipe_direction", { value: "ltr" });
    act(() => {
      useViewerStore.getState().reset();
      useViewerStore.getState().setSwipeUserDefault("rtl");
      useViewerStore.getState().beginSwipeDefaultMutation();
      useViewerStore.getState().beginSwipeMutation("A", "rtl");
    });
    const state = useViewerStore.getState();
    await act(async () => {
      if (outcome === "success") response.resolve({});
      else response.reject(new Error("old full reset failed"));
    });
    expect(useViewerStore.getState()).toBe(state);
    expect(useViewerStore.getState().isSwipeSaving).toBe(true);
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).not.toBeNull();
    expect(useViewerStore.getState().swipeUserDefault).toBe("rtl");
    expect(console.error).not.toHaveBeenCalled();
  });
  it("does not replace a newer default with an older settings-list snapshot", async () => {
    let complete!: (value: { swipe_direction: string }) => void;
    api.list.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<ViewerTab />);
    await waitFor(() => expect(api.list).toHaveBeenCalled());
    act(() => useViewerStore.getState().setSwipeUserDefault("rtl"));
    await act(async () => complete({ swipe_direction: "ltr" }));
    await waitFor(() => expect(screen.getByLabelText("settings.general.swipe.label")).toHaveValue("rtl"));
    expect(useViewerStore.getState().swipeUserDefault).toBe("rtl");
  });

  it("ignores a previous session's global default save response", async () => {
    let complete!: (value: object) => void;
    api.list.mockResolvedValue({ swipe_direction: "ltr" });
    api.update.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.change(select, { target: { value: "rtl" } });
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("swipe_direction", { value: "rtl" }));
    act(() => {
      useViewerStore.getState().reset();
      useViewerStore.getState().initializeSwipeSettings("A", { user_default: "ltr", series_override: null, effective_direction: "ltr" });
    });
    await act(async () => complete({}));
    expect(useViewerStore.getState().swipeUserDefault).toBe("ltr");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(useViewerStore.getState().seriesSettings.A.swipeDirection).toBeUndefined();
  });
  it("loads the user default without replacing a series override", async () => {
    useViewerStore.getState().initializeSwipeSettings("B", { user_default: "ltr", series_override: "ltr", effective_direction: "ltr" });
    render(<ViewerTab />);
    await waitFor(() => expect(screen.getByLabelText("settings.general.swipe.label")).toHaveValue("rtl"));
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
    expect(useViewerStore.getState().seriesSettings.B.swipeDirection).toBe("ltr");
  });

  it("changes the global value without creating a series override", async () => {
    useViewerStore.getState().initializeSwipeSettings("A", { user_default: "ltr", series_override: null, effective_direction: "ltr" });
    api.list.mockResolvedValue({ swipe_direction: "ltr" }); render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.change(select, { target: { value: "rtl" } });
    await waitFor(() => expect(api.update).toHaveBeenCalledWith("swipe_direction", { value: "rtl" }));
    await waitFor(() => expect(select).toHaveValue("rtl"));
    expect(useViewerStore.getState().seriesSettings.A.swipeDirection).toBeUndefined();
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
  });

  it("keeps the previous default when the global save fails", async () => {
    api.list.mockResolvedValue({ swipe_direction: "ltr" }); api.update.mockRejectedValue(new Error("failed"));
    render(<ViewerTab />); const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.change(select, { target: { value: "rtl" } });
    await waitFor(() => expect(api.update).toHaveBeenCalled());
    expect(select).toHaveValue("ltr");
    expect(useViewerStore.getState().settings.swipeDirection).toBe("ltr");
  });
});
