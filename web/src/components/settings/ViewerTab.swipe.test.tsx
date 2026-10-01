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
  it.each(["success", "failure"])("blocks a second default write until the pending save's %s and permits retry", async (outcome) => {
    const response = deferred<object>();
    api.list.mockResolvedValue({ swipe_direction: "ltr" });
    api.update.mockReturnValueOnce(response.promise);
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.change(select, { target: { value: "rtl" } });
    // Dispatch even if disabled: the action must independently refuse the write.
    fireEvent.change(select, { target: { value: "ltr" } });
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(select).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "settings.viewer.reset_button" })[0]).toBeDisabled();
    await act(async () => {
      if (outcome === "success") response.resolve({});
      else response.reject(new Error("default save failed"));
    });
    expect(select).toHaveValue(outcome === "success" ? "rtl" : "ltr");
    expect(select).not.toBeDisabled();
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBeNull();
    fireEvent.change(select, { target: { value: outcome === "success" ? "ltr" : "rtl" } });
    await waitFor(() => expect(api.update).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(select).toHaveValue(outcome === "success" ? "ltr" : "rtl"));
  });

  it("blocks an already-open full reset while a default save is pending", async () => {
    const response = deferred<object>();
    api.list.mockResolvedValue({ swipe_direction: "ltr" });
    api.update.mockReturnValue(response.promise);
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.click(screen.getAllByRole("button", { name: "settings.viewer.reset_button" })[0]);
    fireEvent.change(select, { target: { value: "rtl" } });
    const owner = useViewerStore.getState().pendingSwipeDefaultMutation;
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(api.update).toHaveBeenCalledTimes(1);
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBe(owner);
    await act(async () => response.resolve({}));
    expect(select).toHaveValue("rtl");
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    await waitFor(() => expect(select).toHaveValue("ltr"));
    expect(api.update.mock.calls.filter(([key]) => key === "swipe_direction")).toHaveLength(2);
  });

  it("blocks default saves and duplicate full resets while a reset is pending", async () => {
    const response = deferred<object>();
    api.update.mockReturnValue(response.promise);
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.click(screen.getAllByRole("button", { name: "settings.viewer.reset_button" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    const calls = api.update.mock.calls.length;
    const owner = useViewerStore.getState().pendingSwipeDefaultMutation;
    fireEvent.change(select, { target: { value: "rtl" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    expect(api.update).toHaveBeenCalledTimes(calls);
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBe(owner);
    expect(select).toBeDisabled();
    await act(async () => response.resolve({}));
    expect(select).toHaveValue("ltr");
    expect(select).not.toBeDisabled();
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBeNull();
  });

  it.each(["success", "failure"])("holds reset ownership after another field fails until swipe %s, then permits retry", async (outcome) => {
    const response = deferred<object>();
    api.update.mockImplementation((key: string) => {
      if (key === "swipe_direction") return response.promise;
      if (key === "viewer_reading_mode") return Promise.reject(new Error("other reset field failed"));
      return Promise.resolve({});
    });
    render(<ViewerTab />);
    const select = await screen.findByLabelText("settings.general.swipe.label");
    fireEvent.click(screen.getAllByRole("button", { name: "settings.viewer.reset_button" })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    const owner = useViewerStore.getState().pendingSwipeDefaultMutation;
    await act(async () => {});
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBe(owner);
    expect(select).toBeDisabled();
    fireEvent.change(select, { target: { value: "rtl" } });
    expect(api.update.mock.calls.filter(([key]) => key === "swipe_direction")).toHaveLength(1);
    await act(async () => {
      if (outcome === "success") response.resolve({});
      else response.reject(new Error("swipe reset failed"));
    });
    expect(select).toHaveValue(outcome === "success" ? "ltr" : "rtl");
    expect(useViewerStore.getState().pendingSwipeDefaultMutation).toBeNull();
    expect(select).not.toBeDisabled();
    expect(console.error).toHaveBeenCalledTimes(1);
    api.update.mockResolvedValue({});
    fireEvent.change(select, { target: { value: outcome === "success" ? "rtl" : "ltr" } });
    await waitFor(() => expect(api.update.mock.calls.filter(([key]) => key === "swipe_direction")).toHaveLength(2));
    await waitFor(() => expect(select).toHaveValue(outcome === "success" ? "rtl" : "ltr"));
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
