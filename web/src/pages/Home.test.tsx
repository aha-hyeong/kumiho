import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { HomePage } from "./Home";

const { mocks } = vi.hoisted(() => ({ mocks: {
  fetchLibrariesMock: vi.fn(), getSeriesMock: vi.fn(), getHomeMock: vi.fn(),
  getRecentMock: vi.fn(), settingListMock: vi.fn(), getExtensionsBatchMock: vi.fn(),
  libraries: [{ id: "library-1", type: "LOCAL" }, { id: "system-likes", type: "SYSTEM", is_visible: true }] as
    { id: string; type: string; is_visible?: boolean }[],
  refreshKey: 0,
} }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../stores/libraryStore", () => ({ useLibraryStore: Object.assign(
  () => ({ libraries: mocks.libraries, fetchLibraries: mocks.fetchLibrariesMock, refreshKey: mocks.refreshKey }),
  { getState: () => ({ libraries: mocks.libraries }) },
) }));
vi.mock("../api/client", () => ({
  libraryAPI: { getSeries: (...args: unknown[]) => mocks.getSeriesMock(...args) },
  progressAPI: { getRecent: (...args: unknown[]) => mocks.getRecentMock(...args) },
  settingAPI: { list: (...args: unknown[]) => mocks.settingListMock(...args) },
  seriesAPI: {
    getHome: (...args: unknown[]) => mocks.getHomeMock(...args),
    getExtensionsBatch: (...args: unknown[]) => mocks.getExtensionsBatchMock(...args),
  },
}));
vi.mock("../components/headers/Header", () => ({ Header: () => <div data-testid="header">header</div> }));
vi.mock("../components/Sidebar", () => ({ Sidebar: () => <div data-testid="sidebar">sidebar</div> }));
vi.mock("../components/common/LoadingSpinner", () => ({ LoadingSpinner: ({ className }: { className?: string }) => <div data-testid="loading-spinner" data-class={className} /> }));
vi.mock("../components/common/HorizontalDragScroll", () => ({ HorizontalDragScroll: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("../components/SeriesCard", () => ({ SeriesCard: ({ item, onStatusChange, extensionBadgeText }: { item: { title?: string }; onStatusChange?: () => void; extensionBadgeText?: string }) =>
  <button type="button" data-badge={extensionBadgeText} onClick={onStatusChange}>{item.title}</button> }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j; });
  return { promise, resolve, reject };
}

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.libraries = [{ id: "library-1", type: "LOCAL" }, { id: "system-likes", type: "SYSTEM", is_visible: true }];
    mocks.refreshKey = 0;
    mocks.fetchLibrariesMock.mockResolvedValue(undefined);
    mocks.getRecentMock.mockResolvedValue({ data: { recent_progress: [] } });
    mocks.settingListMock.mockResolvedValue({ home_layout_order: "default" });
    mocks.getExtensionsBatchMock.mockResolvedValue({ data: { extensions: {} } });
    mocks.getHomeMock.mockImplementation((section: string) => Promise.resolve({ data: {
      updated_series: section === "updated" ? [{ id: "s1", title: "새 시리즈" }] : [],
      liked_series: [],
    } }));
    mocks.getSeriesMock.mockRejectedValue(new Error("legacy list must not be called"));
  });

  it("loads Home cards without requesting any full library series list", async () => {
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("새 시리즈")).toBeInTheDocument());
    expect(mocks.getHomeMock).toHaveBeenCalledWith("updated");
    expect(mocks.getHomeMock).toHaveBeenCalledWith("liked");
    expect(mocks.getSeriesMock).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.getExtensionsBatchMock).toHaveBeenCalledWith(["s1"]));
  });

  it("shares overlapping extension IDs without blocking either section", async () => {
    const extensions = deferred<{ data: { extensions: Record<string, string> } }>();
    mocks.getExtensionsBatchMock.mockReturnValue(extensions.promise);
    mocks.getHomeMock.mockImplementation((section: string) => Promise.resolve({ data: {
      updated_series: section === "updated" ? [{ id: "s1", title: "Updated" }] : [],
      liked_series: section === "liked" ? [{ id: "s1", title: "Liked" }] : [],
    } }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("Updated")).toBeInTheDocument());
    expect(screen.getByText("Liked")).toBeInTheDocument();
    expect(mocks.getExtensionsBatchMock).toHaveBeenCalledTimes(1);
    await act(async () => { extensions.resolve({ data: { extensions: { s1: "book.pdf" } } }); });
    await waitFor(() => expect(screen.getByText("Updated")).toHaveAttribute("data-badge", "PDF"));
    expect(screen.getByText("Liked")).toHaveAttribute("data-badge", "PDF");
  });

  it("retries an overlapping badge once when the shared request fails", async () => {
    const first = deferred<{ data: { extensions: Record<string, string> } }>();
    mocks.getExtensionsBatchMock.mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ data: { extensions: { s1: "book.pdf" } } });
    mocks.getHomeMock.mockImplementation((section: string) => Promise.resolve({ data: {
      updated_series: section === "updated" ? [{ id: "s1", title: "Updated" }] : [],
      liked_series: section === "liked" ? [{ id: "s1", title: "Liked" }] : [],
    } }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("Liked")).toBeInTheDocument());
    expect(mocks.getExtensionsBatchMock).toHaveBeenCalledTimes(1);
    await act(async () => { first.reject(new Error("transient")); });
    await waitFor(() => expect(mocks.getExtensionsBatchMock).toHaveBeenCalledTimes(2));
    expect(mocks.getExtensionsBatchMock).toHaveBeenLastCalledWith(["s1"]);
    await waitFor(() => expect(screen.getByText("Updated")).toHaveAttribute("data-badge", "PDF"));
    expect(screen.getByText("Liked")).toHaveAttribute("data-badge", "PDF");
  });

  it("stops after one failed retry without hiding cards or retrying unrelated IDs", async () => {
    const first = deferred<{ data: { extensions: Record<string, string> } }>();
    const retry = deferred<{ data: { extensions: Record<string, string> } }>();
    mocks.getExtensionsBatchMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(retry.promise);
    mocks.getHomeMock.mockImplementation((section: string) => Promise.resolve({ data: {
      updated_series: section === "updated" ? [{ id: "s1", title: "Updated" }, { id: "s2", title: "Only updated" }] : [],
      liked_series: section === "liked" ? [{ id: "s1", title: "Liked" }] : [],
    } }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("Liked")).toBeInTheDocument());
    await act(async () => { first.reject(new Error("first failure")); });
    await waitFor(() => expect(mocks.getExtensionsBatchMock).toHaveBeenCalledTimes(2));
    expect(mocks.getExtensionsBatchMock).toHaveBeenLastCalledWith(["s1"]);
    await act(async () => { retry.reject(new Error("retry failure")); });
    expect(mocks.getExtensionsBatchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Updated")).not.toHaveAttribute("data-badge");
    expect(screen.getByText("Only updated")).toBeInTheDocument();
  });

  it("shows the shell and independently settles sections while libraries and settings are slow", async () => {
    const libraries = deferred<void>();
    const settings = deferred<{ home_layout_order: string }>();
    const home = deferred<{ data: { updated_series: { id: string; title: string }[]; liked_series: { id: string; title: string }[] } }>();
    mocks.fetchLibrariesMock.mockReturnValue(libraries.promise);
    mocks.settingListMock.mockReturnValue(settings.promise);
    mocks.getHomeMock.mockImplementation((section: string) => section === "updated"
      ? home.promise
      : Promise.resolve({ data: { updated_series: [], liked_series: [{ id: "liked", title: "좋아요" }] } }));
    render(<HomePage />);
    await waitFor(() => expect(mocks.getHomeMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId("header")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    expect(screen.getAllByTestId("loading-spinner").every((element) => element.dataset.class?.includes("sectionLoading"))).toBe(true);
    await waitFor(() => expect(screen.getByText("좋아요")).toBeInTheDocument());
    await act(async () => { home.resolve({ data: { updated_series: [{ id: "s2", title: "빠른 시리즈" }], liked_series: [] } }); });
    await waitFor(() => expect(screen.getByText("빠른 시리즈")).toBeInTheDocument());
    expect(screen.getByText("home.sections.continue_reading.empty")).toBeInTheDocument();
    await act(async () => { settings.resolve({ home_layout_order: "default" }); libraries.resolve(); });
  });

  it("still shows updates when likes fail", async () => {
    mocks.getHomeMock.mockImplementation((section: string) => section === "liked"
      ? Promise.reject(new Error("liked unavailable"))
      : Promise.resolve({ data: { updated_series: [{ id: "s1", title: "새 시리즈" }], liked_series: [] } }));
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("새 시리즈")).toBeInTheDocument());
    expect(screen.getByText("home.sections.liked.empty")).toBeInTheDocument();
  });

  it("keeps the configured section order and hides invisible system likes", async () => {
    mocks.libraries[1].is_visible = false;
    mocks.settingListMock.mockResolvedValue({ home_layout_order: "swapped" });
    render(<HomePage />);
    await waitFor(() => expect(screen.getByText("새 시리즈")).toBeInTheDocument());
    expect(screen.queryByText("home.sections.liked.title")).not.toBeInTheDocument();
    const titles = [...document.querySelectorAll("h2")].map((node) => node.textContent?.trim());
    expect(titles[0]).toBe("home.sections.updated.title");
  });

  it("reloads cards on refreshKey and after a card status change", async () => {
    const view = render(<HomePage />);
    await waitFor(() => expect(screen.getByText("새 시리즈")).toBeInTheDocument());
    mocks.refreshKey = 1;
    view.rerender(<HomePage />);
    await waitFor(() => expect(mocks.getHomeMock).toHaveBeenCalledTimes(4));
    fireEvent.click(screen.getByText("새 시리즈"));
    await waitFor(() => expect(mocks.getHomeMock).toHaveBeenCalledTimes(6));
  });
});
