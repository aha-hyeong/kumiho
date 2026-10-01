import { beforeEach, describe, expect, it } from "vitest";
import { useViewerStore } from "./viewerStore";
import type { ViewerSwipeSettings } from "../types/series";

const swipe = (override: "ltr" | "rtl" | null, userDefault: "ltr" | "rtl" = "ltr"): ViewerSwipeSettings => ({
  user_default: userDefault, series_override: override, effective_direction: override ?? userDefault,
});
const store = () => useViewerStore.getState();
beforeEach(() => { store().reset(); store().initializeSwipeSettings("A", swipe(null)); });

describe("swipe request revisions", () => {
  it.each(["before", "during"])("keeps the optimistic override for an init started %s a pending mutation", (timing) => {
    const before = timing === "before" ? store().beginSwipeLoad() : null;
    const mutation = store().beginSwipeMutation("A", "rtl");
    const load = before ?? store().beginSwipeLoad();
    store().initializeSwipeSettings("A", swipe(null), load);
    expect(store().settings.swipeDirection).toBe("rtl");
    expect(store().seriesSettings.A.swipeDirection).toBe("rtl");
    expect(store().isSwipeSaving).toBe(true);
    store().commitSwipeMutation(mutation); store().finishSwipeMutation(mutation);
    expect(store().isSwipeSaving).toBe(false);
  });

  it("keeps a confirmed override for an init started during the pending save", () => {
    const mutation = store().beginSwipeMutation("A", "rtl");
    const load = store().beginSwipeLoad();
    store().commitSwipeMutation(mutation); store().finishSwipeMutation(mutation);
    store().initializeSwipeSettings("A", swipe(null), load);
    expect(store().settings.swipeDirection).toBe("rtl");
    expect(store().seriesSettings.A.swipeDirection).toBe("rtl");
  });

  it("does not restore an old override during a pending reset", () => {
    store().initializeSwipeSettings("A", swipe("rtl"));
    const mutation = store().beginSwipeMutation("A", null);
    const load = store().beginSwipeLoad();
    store().initializeSwipeSettings("A", swipe("rtl"), load);
    expect(store().seriesSettings.A.swipeDirection).toBeUndefined();
    expect(store().settings.swipeDirection).toBe("ltr");
    store().commitSwipeMutation(mutation, swipe(null)); store().finishSwipeMutation(mutation);
    expect(store().seriesSettings.A.swipeDirection).toBeUndefined();
  });

  it("keeps a newer default for an old init snapshot", () => {
    const load = store().beginSwipeLoad();
    store().setSwipeUserDefault("rtl");
    store().initializeSwipeSettings("A", swipe(null), load);
    expect(store().swipeUserDefault).toBe("rtl");
    expect(store().settings.swipeDirection).toBe("rtl");
  });

  it("applies only the latest load even when both target the same series", () => {
    const old = store().beginSwipeLoad();
    const current = store().beginSwipeLoad();
    store().initializeSwipeSettings("A", swipe("rtl"), current);
    const state = store();
    store().initializeSwipeSettings("A", swipe(null), old);
    expect(store()).toBe(state);
    expect(store().settings.swipeDirection).toBe("rtl");
  });

  it("invalidates a load across reset even when its request ID is reused", () => {
    const old = store().beginSwipeLoad();
    store().reset();
    const current = store().beginSwipeLoad();
    expect(old.requestId).toBe(current.requestId);
    expect(old.sessionEpoch).not.toBe(current.sessionEpoch);
    store().initializeSwipeSettings("A", swipe("rtl"), current);
    const state = store();
    store().initializeSwipeSettings("A", swipe(null), old);
    expect(store()).toBe(state);
  });

  it.each([
    ["save", "success"], ["save", "failure"],
    ["reset", "success"], ["reset", "failure"],
  ] as const)("ignores old %s %s and finally when a newer mutation owns the store", (operation, outcome) => {
    const old = store().beginSwipeMutation("A", operation === "reset" ? null : "ltr");
    const current = store().beginSwipeMutation("A", "rtl");
    const state = store();
    if (outcome === "success") store().commitSwipeMutation(old, operation === "reset" ? swipe(null) : undefined);
    else store().rollbackSwipeMutation(old);
    store().finishSwipeMutation(old);
    expect(store()).toBe(state);
    expect(store().isSwipeSaving).toBe(true);
    store().commitSwipeMutation(current); store().finishSwipeMutation(current);
    const committed = store();
    if (outcome === "success") store().commitSwipeMutation(old, operation === "reset" ? swipe(null) : undefined);
    else store().rollbackSwipeMutation(old);
    store().finishSwipeMutation(old);
    expect(store()).toBe(committed);
    expect(store().settings.swipeDirection).toBe("rtl");
    expect(store().seriesSettings.A.swipeDirection).toBe("rtl");
    expect(store().isSwipeSaving).toBe(false);
  });

  it("rolls back a valid failure using the latest default and preserves other fields", () => {
    store().updateSeriesSetting("A", { fitMode: "width", clickDirection: "rtl" });
    const mutation = store().beginSwipeMutation("A", "rtl");
    store().setSwipeUserDefault("rtl");
    store().rollbackSwipeMutation(mutation); store().finishSwipeMutation(mutation);
    expect(store().seriesSettings.A).toEqual({ fitMode: "width", clickDirection: "rtl" });
    expect(store().swipeUserDefault).toBe("rtl");
    expect(store().settings.swipeDirection).toBe("rtl");
  });

  it("does not apply an A reset response's default to the current B Viewer", () => {
    store().initializeSwipeSettings("A", swipe("rtl"));
    const mutation = store().beginSwipeMutation("A", null);
    store().initializeSwipeSettings("B", swipe("rtl"));
    store().commitSwipeMutation(mutation, swipe(null, "rtl")); store().finishSwipeMutation(mutation);
    expect(store().currentSeriesId).toBe("B");
    expect(store().swipeUserDefault).toBe("ltr");
    expect(store().settings.swipeDirection).toBe("rtl");
    expect(store().seriesSettings.B.swipeDirection).toBe("rtl");
    expect(store().seriesSettings.A.swipeDirection).toBeUndefined();
  });

  it("rejects a concurrent default mutation without replacing its owner", () => {
    const current = store().beginSwipeDefaultMutation();
    const state = store();
    expect(store().beginSwipeDefaultMutation()).toBeNull();
    expect(store()).toBe(state);
    expect(store().pendingSwipeDefaultMutation).toBe(current);
  });

  it("does not finish a previous session's default mutation or alter series saving state", () => {
    const old = store().beginSwipeDefaultMutation()!;
    store().reset();
    const current = store().beginSwipeDefaultMutation()!;
    store().beginSwipeMutation("A", "rtl");
    const state = store();
    expect(store().isSwipeDefaultMutationCurrent(old)).toBe(false);
    store().finishSwipeDefaultMutation(old);
    expect(store()).toBe(state);
    expect(store().isSwipeDefaultMutationCurrent(current)).toBe(true);
    store().setSwipeUserDefault("rtl");
    store().finishSwipeDefaultMutation(current);
    expect(store().isSwipeSaving).toBe(true);
    expect(store().pendingSwipeDefaultMutation).toBeNull();
  });
});
