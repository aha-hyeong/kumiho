import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import { SeriesPage } from "./Series";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const apiGetMock = vi.fn();
  const bootstrapAndPlayMock = vi.fn();
  const routeState = { value: undefined as unknown };

  return {
    mocks: {
      navigateMock,
      apiGetMock,
      bootstrapAndPlayMock,
      routeState,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
  Trans: ({ i18nKey, count }: { children?: ReactNode; i18nKey?: string; count?: number }) => (
    <span>
      {i18nKey}
      {typeof count === "number" ? ` ${count}` : ""}
    </span>
  ),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigateMock,
    useLocation: () => ({ pathname: "/series/series-1", search: "", state: mocks.routeState.value }),
  };
});

vi.mock("../api/client", () => ({
  api: {
    get: (...args: unknown[]) => mocks.apiGetMock(...args),
  },
  seriesAPI: {
    getChapters: vi.fn(),
    getVolumes: vi.fn(),
    getCharacters: vi.fn(() => Promise.resolve({ data: { characters: [] } })),
  },
  volumeAPI: {
    findFirstChapterRecursively: vi.fn(),
  },
  downloadAPI: {
    getSeriesUrl: vi.fn(),
    getVolumeUrl: vi.fn(),
  },
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ role: "MASTER" }),
}));

vi.mock("../stores/audioPlayerStore", () => ({
  useAudioPlayerStore: {
    subscribe: vi.fn(() => () => {}),
    getState: () => ({
      bootstrapAndPlay: mocks.bootstrapAndPlayMock,
      currentSeries: null,
      updateCurrentSeries: vi.fn(),
    }),
  },
}));

vi.mock("../components/headers/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("../components/headers/SubHeader", () => ({
  SubHeader: () => <div data-testid="sub-header" />,
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("../components/SeriesCard", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    SeriesCard: React.forwardRef<HTMLDivElement, { item: { title?: string } }>(({ item }, ref) => (
      <div
        ref={ref}
        data-testid="series-card"
      >
        {item.title}
      </div>
    )),
  };
});

vi.mock("../components/SeriesInfoCard", () => ({
  SeriesInfoCard: ({ onPlay }: { onPlay: () => void | Promise<void> }) => (
    <button
      type="button"
      data-testid="series-info-play"
      onClick={() => void onPlay()}
    >
      play
    </button>
  ),
}));

vi.mock("../components/modals/AlertModal", () => ({
  AlertModal: () => null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "scrollIntoView");

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeState.value = undefined;
  Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  if (originalScrollIntoViewDescriptor) {
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", originalScrollIntoViewDescriptor);
  } else {
    Reflect.deleteProperty(window.HTMLElement.prototype, "scrollIntoView");
  }
});

describe("SeriesPage audiobook bootstrap guard", () => {
  beforeEach(() => {
    mocks.bootstrapAndPlayMock.mockResolvedValue({ ok: true });
  });

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/series/series-1"]}>
        <Routes>
          <Route
            path="/series/:id"
            element={<SeriesPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it("일반 도서 시리즈는 has_audio=true 여도 기존 뷰어 진입을 사용한다", async () => {
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "일반 도서",
            path: "/books/series",
            library_type: "book",
            has_audio: true,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=root") {
        return Promise.resolve({ data: { volumes: [] } });
      }
      if (url === "/series/series-1/progress") {
        return Promise.resolve({
          data: {
            progress: {
              chapter_id: "chapter-7",
            },
            summary: null,
          },
        });
      }
      if (url === "/libraries/library-1") {
        return Promise.resolve({
          data: {
            id: "library-1",
            name: "서재",
          },
        });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    fireEvent.click(await screen.findByTestId("series-info-play"));

    await waitFor(() => {
      expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-7", {
        state: { from: "/series/series-1" },
      });
    });
    expect(mocks.bootstrapAndPlayMock).not.toHaveBeenCalled();
  });

  it("오디오북 시리즈는 오디오 부트스트랩을 호출한다", async () => {
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "오디오북",
            path: "/audio/series",
            library_type: "audiobook",
            has_audio: true,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=root") {
        return Promise.resolve({ data: { volumes: [] } });
      }
      if (url === "/series/series-1/progress") {
        return Promise.resolve({ data: null });
      }
      if (url === "/libraries/library-1") {
        return Promise.resolve({
          data: {
            id: "library-1",
            name: "오디오 서재",
          },
        });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    fireEvent.click(await screen.findByTestId("series-info-play"));

    await waitFor(() => {
      expect(mocks.bootstrapAndPlayMock).toHaveBeenCalledWith({
        source: "series",
        seriesId: "series-1",
        series: expect.objectContaining({
          id: "series-1",
          library_type: "audiobook",
        }),
      });
    });
  });
});

describe("SeriesPage count label", () => {
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/series/series-1"]}>
        <Routes>
          <Route
            path="/series/:id"
            element={<SeriesPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it("display_unit이 chapter이면 시리즈 요약에서 챕터 수를 우선 사용한다", async () => {
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "챕터 시리즈",
            path: "/books/series",
            library_type: "book",
            display_unit: "chapter",
            chapter_count: 12,
            volume_count: 12,
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=root") {
        return Promise.resolve({ data: { volumes: [] } });
      }
      if (url === "/series/series-1/progress") {
        return Promise.resolve({ data: { progress: null, summary: null } });
      }
      if (url === "/libraries/library-1") {
        return Promise.resolve({
          data: {
            id: "library-1",
            name: "서재",
          },
        });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    expect(await screen.findByText("series.chapter_count 12")).toBeInTheDocument();
    expect(screen.queryByText("series.count")).toBeNull();
  });

  it("라우트 state에 scrollToVolumeId가 있으면 해당 볼륨 카드로 스크롤한다", async () => {
    const scrollIntoViewMock = vi.fn();
    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoViewMock,
    });
    mocks.routeState.value = { scrollToVolumeId: "volume-2" };
    mocks.apiGetMock.mockImplementation((url: string) => {
      if (url === "/series/series-1") {
        return Promise.resolve({
          data: {
            id: "series-1",
            library_id: "library-1",
            title: "긴 시리즈",
            path: "/books/series",
            library_type: "book",
            created_at: "2026-03-21T00:00:00Z",
            updated_at: "2026-03-21T00:00:00Z",
          },
        });
      }
      if (url === "/series/series-1/volumes?parent_id=root") {
        return Promise.resolve({
          data: {
            volumes: [
              {
                id: "volume-1",
                series_id: "series-1",
                title: "1권",
                volume_number: 1,
                path: "/books/series/1.zip",
                created_at: "2026-03-21T00:00:00Z",
              },
              {
                id: "volume-2",
                series_id: "series-1",
                title: "2권",
                volume_number: 2,
                path: "/books/series/2.zip",
                created_at: "2026-03-21T00:00:00Z",
              },
            ],
          },
        });
      }
      if (url === "/series/series-1/progress") {
        return Promise.resolve({ data: { progress: null, summary: null } });
      }
      if (url === "/libraries/library-1") {
        return Promise.resolve({
          data: {
            id: "library-1",
            name: "서재",
          },
        });
      }
      throw new Error(`Unhandled api.get(${url})`);
    });

    renderPage();

    expect(await screen.findByText("2권")).toBeInTheDocument();
    await waitFor(() => {
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    });
  });
});
