import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryStore } from "./libraryStore";

const { getAll, auth } = vi.hoisted(() => ({ getAll: vi.fn(), auth: { user: null as { id: string } | null } }));
vi.mock("../api/client", () => ({ libraryAPI: { getAll } }));
vi.mock("./authStore", () => ({ useAuthStore: { getState: () => auth } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  auth.user = null;
  getAll.mockReset().mockResolvedValue({ data: { libraries: [] } });
  useLibraryStore.setState({ libraries: [], refreshKey: 0, fetchRequestId: 0, isLoading: false });
});

it("shares simultaneous Home/Sidebar library requests but refetches after refresh", async () => {
  const initial = deferred<{ data: { libraries: [] } }>();
  const refreshed = deferred<{ data: { libraries: [] } }>();
  getAll.mockReturnValueOnce(initial.promise).mockReturnValueOnce(refreshed.promise);
  const store = useLibraryStore.getState();
  const home = store.fetchLibraries(true);
  const sidebar = store.fetchLibraries(true);
  expect(getAll).toHaveBeenCalledTimes(1);
  expect(sidebar).toBe(home);
  store.triggerRefresh();
  const next = store.fetchLibraries();
  expect(getAll).toHaveBeenCalledTimes(2);
  initial.resolve({ data: { libraries: [] } });
  await home;
  expect(useLibraryStore.getState().isLoading).toBe(true);
  refreshed.resolve({ data: { libraries: [] } });
  await next;
  expect(useLibraryStore.getState().isLoading).toBe(false);
  await store.fetchLibraries(false);
  expect(getAll).toHaveBeenCalledTimes(3); // no stale cross-navigation cache
});

it("does not share a pending request across accounts or sessions", async () => {
  const first = deferred<{ data: { libraries: string[] } }>();
  const second = deferred<{ data: { libraries: string[] } }>();
  getAll.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  auth.user = { id: "same-account" };
  const store = useLibraryStore.getState();
  const oldRequest = store.fetchLibraries();
  auth.user = { id: "same-account" }; // new login, same user ID
  const newRequest = store.fetchLibraries();
  expect(getAll).toHaveBeenCalledTimes(2);
  expect(newRequest).not.toBe(oldRequest);
  first.resolve({ data: { libraries: ["old"] } });
  await oldRequest;
  expect(useLibraryStore.getState().libraries).toEqual([]);
  expect(useLibraryStore.getState().isLoading).toBe(true);
  second.resolve({ data: { libraries: ["new"] } });
  await newRequest;
  expect(useLibraryStore.getState().libraries).toEqual(["new"]);
});
