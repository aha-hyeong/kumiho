import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAuthStore } from "./authStore";
import { useViewerStore } from "./viewerStore";

const api = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn(), disconnect: vi.fn(), resetAtmosphere: vi.fn() }));
vi.mock("../api/client", () => ({ authAPI: { login: api.login, logout: api.logout } }));
vi.mock("../hooks/useSSE", () => ({ disconnectSSE: api.disconnect }));
vi.mock("./atmosphereStore", () => ({ useAtmosphereStore: { getState: () => ({ reset: api.resetAtmosphere }) } }));

beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
  useViewerStore.getState().reset();
  api.logout.mockResolvedValue({});
  // Unit-test fixtures only: no actual authentication request or credential.
  api.login.mockResolvedValue({ data: { access_token: "test-only", refresh_token: "test-only", user: { id: "user2", username: "user2" } } });
});

describe("real auth actions invalidate Viewer requests", () => {
  it.each(["success", "failure"])("ignores the prior user's %s and finally after logout/login", async (outcome) => {
    useViewerStore.getState().initializeSwipeSettings("A", { user_default: "ltr", series_override: null, effective_direction: "ltr" });
    const old = useViewerStore.getState().beginSwipeMutation("A", "ltr");
    const oldLoad = useViewerStore.getState().beginSwipeLoad();
    await useAuthStore.getState().logout();
    await useAuthStore.getState().login("user2", "unit-test-only");
    expect(useAuthStore.getState().user?.id).toBe("user2");
    useViewerStore.getState().initializeSwipeSettings("A", { user_default: "rtl", series_override: null, effective_direction: "rtl" });
    const current = useViewerStore.getState().beginSwipeMutation("A", "rtl");
    expect(current.mutationId).toBe(old.mutationId);
    expect(current.sessionEpoch).not.toBe(old.sessionEpoch);
    const state = useViewerStore.getState();
    if (outcome === "success") state.commitSwipeMutation(old);
    else state.rollbackSwipeMutation(old);
    state.finishSwipeMutation(old);
    state.initializeSwipeSettings("A", { user_default: "ltr", series_override: null, effective_direction: "ltr" }, oldLoad);
    expect(useViewerStore.getState()).toBe(state);
    expect(useViewerStore.getState().isSwipeSaving).toBe(true);
    expect(useViewerStore.getState().settings.swipeDirection).toBe("rtl");
    state.commitSwipeMutation(current); state.finishSwipeMutation(current);
    expect(useViewerStore.getState().isSwipeSaving).toBe(false);
  });
});
