import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LibraryPage } from "./Library";
import type { Series } from "../types/series";
import sidebarStyles from "../components/Sidebar.module.css";

const { getLibrary, getSeries, libraryState } = vi.hoisted(() => ({
  getLibrary: vi.fn(),
  getSeries: vi.fn(),
  libraryState: {
    libraries: [
      { id: "library-1", name: "First library", scan_status: "IDLE" },
      { id: "library-2", name: "Second library", scan_status: "IDLE" },
    ],
    isLoading: false,
    refreshKey: 0,
    fetchLibraries: vi.fn().mockResolvedValue(undefined),
    triggerRefresh: vi.fn(),
  },
}));

vi.mock("../api/client", () => ({
  libraryAPI: { get: getLibrary, getSeries },
}));
vi.mock("../stores/libraryStore", () => ({
  useLibraryStore: (selector?: (state: typeof libraryState) => unknown) =>
    selector ? selector(libraryState) : libraryState,
}));
vi.mock("../stores/authStore", () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));
vi.mock("../stores/scanStore", () => ({
  useScanStore: () => ({ startPolling: vi.fn(), stopPolling: vi.fn() }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: () => null,
}));
vi.mock("../components/headers/Header", () => ({
  Header: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <button onClick={onMenuClick}>Open menu</button>
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getLibrary.mockImplementation((id: string) => Promise.resolve({
    data: libraryState.libraries.find((library) => library.id === id),
  }));
  getSeries.mockImplementation(() => new Promise(() => {}));
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/libraries/library-1"]}>
      <Routes>
        <Route path="/libraries/:id" element={<LibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

it("opens and closes the real sidebar while the library request is pending", async () => {
  getLibrary.mockImplementation(() => new Promise(() => {}));
  const { container } = renderPage();
  await waitFor(() => expect(getLibrary).toHaveBeenCalledWith("library-1"));

  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const sidebar = screen.getByRole("complementary");
  expect(sidebar).toHaveClass(sidebarStyles.open);
  expect(container.firstElementChild).toHaveClass("page-with-sidebar", "sidebar-open");

  fireEvent.click(within(sidebar).getByRole("button"));
  expect(sidebar).not.toHaveClass(sidebarStyles.open);
  expect(container.firstElementChild).not.toHaveClass("sidebar-open");
  expect(getSeries).not.toHaveBeenCalled();
});

it("navigates to another library while series are pending and ignores the old response", async () => {
  const oldSeries: Series = {
    id: "old-series", library_id: "library-1", title: "Old library series",
    path: "/first/old", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  const currentSeries: Series = {
    id: "current-series", library_id: "library-2", title: "Current library series",
    path: "/second/current", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
  };
  let resolveFirst!: (value: { data: { series: Series[] } }) => void;
  const firstResponse = new Promise<{ data: { series: Series[] } }>((resolve) => {
    resolveFirst = resolve;
  });
  getSeries.mockImplementation((id: string) =>
    id === "library-1" ? firstResponse : Promise.resolve({ data: { series: [currentSeries] } }),
  );
  renderPage();
  await waitFor(() => expect(getSeries).toHaveBeenCalledWith("library-1"));
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  const sidebar = screen.getByRole("complementary");
  expect(sidebar).toHaveClass(sidebarStyles.open);
  fireEvent.click(within(sidebar).getByRole("link", { name: "Second library" }));

  await waitFor(() => expect(getSeries).toHaveBeenCalledWith("library-2"));
  await waitFor(() => expect(screen.queryByText("common.loading")).not.toBeInTheDocument());
  expect(screen.getByRole("complementary")).not.toHaveClass(sidebarStyles.open);
  expect(screen.getByRole("heading", { name: "Second library" })).toBeInTheDocument();
  expect(screen.getByText("Current library series")).toBeInTheDocument();
  expect(screen.queryByText("Old library series")).not.toBeInTheDocument();
  await act(async () => resolveFirst({ data: { series: [oldSeries] } }));
  expect(screen.getByRole("heading", { name: "Second library" })).toBeInTheDocument();
  expect(screen.getByText("Current library series")).toBeInTheDocument();
  expect(screen.queryByText("Old library series")).not.toBeInTheDocument();
});

it("keeps the menu open when the pending series request completes", async () => {
  let resolveSeries!: (value: { data: { series: [] } }) => void;
  getSeries.mockImplementation(() => new Promise<{ data: { series: [] } }>((resolve) => {
    resolveSeries = resolve;
  }));
  const { container } = renderPage();
  await waitFor(() => expect(getSeries).toHaveBeenCalledWith("library-1"));
  fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
  expect(screen.getByRole("complementary")).toHaveClass(sidebarStyles.open);
  await act(async () => resolveSeries({ data: { series: [] } }));
  expect(screen.queryByText("common.loading")).not.toBeInTheDocument();
  expect(screen.getByRole("complementary")).toHaveClass(sidebarStyles.open);
  expect(container.firstElementChild).toHaveClass("page-with-sidebar", "sidebar-open");
});
