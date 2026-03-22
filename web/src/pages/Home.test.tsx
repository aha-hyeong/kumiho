import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { HomePage } from "./Home";

const { mocks } = vi.hoisted(() => {
  const fetchLibrariesMock = vi.fn();
  const getAllMock = vi.fn();
  const getSeriesMock = vi.fn();
  const getRecentMock = vi.fn();
  const settingListMock = vi.fn();
  const getExtensionsBatchMock = vi.fn();

  return {
    mocks: {
      fetchLibrariesMock,
      getAllMock,
      getSeriesMock,
      getRecentMock,
      settingListMock,
      getExtensionsBatchMock,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("../stores/libraryStore", () => ({
  useLibraryStore: Object.assign(
    () => ({
      libraries: [{ id: "library-1", name: "만화책", type: "LOCAL" }],
      fetchLibraries: mocks.fetchLibrariesMock,
      refreshKey: 0,
    }),
    {
      getState: () => ({
        libraries: [{ id: "library-1", name: "만화책", type: "LOCAL" }],
      }),
    },
  ),
}));

vi.mock("../api/client", () => ({
  libraryAPI: {
    getAll: (...args: unknown[]) => mocks.getAllMock(...args),
    getSeries: (...args: unknown[]) => mocks.getSeriesMock(...args),
  },
  progressAPI: {
    getRecent: (...args: unknown[]) => mocks.getRecentMock(...args),
  },
  settingAPI: {
    list: (...args: unknown[]) => mocks.settingListMock(...args),
  },
  seriesAPI: {
    getExtensionsBatch: (...args: unknown[]) => mocks.getExtensionsBatchMock(...args),
  },
}));

vi.mock("../components/headers/Header", () => ({
  Header: ({ onMenuClick }: { onMenuClick: () => void }) => (
    <button
      type="button"
      data-testid="header"
      onClick={onMenuClick}
    >
      header
    </button>
  ),
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

vi.mock("../components/common/HorizontalDragScroll", () => ({
  HorizontalDragScroll: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/SeriesCard", () => ({
  SeriesCard: ({ item }: { item: { title?: string } }) => <div>{item.title}</div>,
}));

describe("HomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchLibrariesMock.mockResolvedValue(undefined);
    mocks.getRecentMock.mockResolvedValue({ data: { recent_progress: [] } });
    mocks.settingListMock.mockResolvedValue({ updated_series_period: "7" });
    mocks.getExtensionsBatchMock.mockResolvedValue({ data: { extensions: {} } });
    mocks.getSeriesMock.mockImplementation((libraryId: string) => {
      if (libraryId === "library-1") {
        return Promise.resolve({
          data: {
            series: [
              {
                id: "series-1",
                library_id: "library-1",
                title: "새 시리즈",
                path: "/books/series-1",
                created_at: "2026-03-22T00:00:00Z",
                updated_at: "2026-03-22T00:00:00Z",
              },
            ],
          },
        });
      }
      if (libraryId === "system-likes") {
        return Promise.reject(new Error("missing system-likes"));
      }
      throw new Error(`Unhandled getSeries(${libraryId})`);
    });
  });

  it("system-likes 조회가 실패해도 업데이트된 시리즈를 표시한다", async () => {
    render(<HomePage />);

    await waitFor(() => {
      expect(screen.getByText("새 시리즈")).toBeInTheDocument();
    });
    expect(screen.queryByText("home.sections.updated.empty")).not.toBeInTheDocument();
  });
});
