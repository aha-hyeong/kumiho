import { beforeEach, expect, it, vi } from "vitest";
import { useLibraryStore } from "./libraryStore";

const { getAll } = vi.hoisted(() => ({ getAll: vi.fn() }));
vi.mock("../api/client", () => ({ libraryAPI: { getAll } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
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
