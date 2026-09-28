import { beforeEach, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { LibraryPage } from "./Library";
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
  let resolveFirst!: (value: { data: { series: [] } }) => void;
  const firstResponse = new Promise<{ data: { series: [] } }>((resolve) => {
    resolveFirst = resolve;
  });
  getSeries.mockImplementation((id: string) =>
    id === "library-1" ? firstResponse : Promise.resolve({ data: { series: [] } }),
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
  await act(async () => resolveFirst({ data: { series: [] } }));
  expect(screen.getByRole("heading", { name: "Second library" })).toBeInTheDocument();
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
