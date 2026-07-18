import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";
import type { Series } from "../types/series";
import { LibraryPage } from "./Library";
import styles from "./Library.module.css";
import { rememberReturnFocus } from "../utils/returnFocus";

const { mocks, libraryStoreState, authStoreState } = vi.hoisted(() => {
  const libraryGetMock = vi.fn();
  const libraryGetSeriesMock = vi.fn();
  const libraryScanMock = vi.fn();
  const fetchLibrariesMock = vi.fn();
  const triggerRefreshMock = vi.fn();

  return {
    mocks: {
      libraryGetMock,
      libraryGetSeriesMock,
      libraryScanMock,
      fetchLibrariesMock,
      triggerRefreshMock,
    },
    libraryStoreState: {
      libraries: [{ id: "library-1", scan_status: "IDLE" }],
      refreshKey: 0,
      fetchLibraries: fetchLibrariesMock,
      triggerRefresh: triggerRefreshMock,
    },
    authStoreState: {
      user: {
        id: "user-1",
        username: "master",
        nickname: "구미호",
        role: "MASTER",
        can_download: true,
        created_at: "2026-04-10T00:00:00Z",
        updated_at: "2026-04-10T00:00:00Z",
      },
    },
  };
});

type LibraryStoreState = typeof libraryStoreState;
type AuthStoreState = typeof authStoreState;

class MockResizeObserver {
  static instances: MockResizeObserver[] = [];

  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    MockResizeObserver.instances.push(this);
  }

  observe = vi.fn();
  disconnect = vi.fn();

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === "home.library.series_index_nav") {
        return "series index";
      }
      if (key === "home.library.series_index_jump") {
        return `jump ${String(options?.key ?? "")}`;
      }
      if (key === "series.unit.total_volume" || key === "series.unit.total_chapter") {
        return `${key} ${String(options?.count ?? "")}`;
      }
      return key;
    },
  }),
  Trans: ({ i18nKey, count }: { i18nKey?: string; count?: number; components?: Record<string, ReactNode> }) => (
    <span>
      {i18nKey}
      {typeof count === "number" ? ` ${count}` : ""}
    </span>
  ),
}));

vi.mock("../api/client", () => ({
  libraryAPI: {
    get: (...args: unknown[]) => mocks.libraryGetMock(...args),
    getSeries: (...args: unknown[]) => mocks.libraryGetSeriesMock(...args),
    scan: (...args: unknown[]) => mocks.libraryScanMock(...args),
  },
}));

vi.mock("../stores/libraryStore", () => ({
  useLibraryStore: (selector?: (state: LibraryStoreState) => unknown) =>
    selector ? selector(libraryStoreState) : libraryStoreState,
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: (selector?: (state: AuthStoreState) => unknown) =>
    selector ? selector(authStoreState) : authStoreState,
}));

vi.mock("../components/headers/Header", () => ({
  Header: () => <div data-testid="header" />,
}));

vi.mock("../components/headers/SubHeader", () => ({
  SubHeader: ({ title, rightContent }: { title: ReactNode; rightContent?: ReactNode }) => (
    <header>
      <div>{title}</div>
      {rightContent}
    </header>
  ),
}));

vi.mock("../components/Sidebar", () => ({
  Sidebar: () => null,
}));

vi.mock("../components/SeriesCard", () => ({
  SeriesCard: ({ item, customSubtitle }: { item: Series; customSubtitle?: string }) => (
    <article data-testid="series-card">
      {item.title}
      {customSubtitle && <span data-testid={`series-subtitle-${item.id}`}>{customSubtitle}</span>}
    </article>
  ),
}));

vi.mock("../components/common/Toast", () => ({
  Toast: () => null,
}));

vi.mock("../components/common/LoadingSpinner", () => ({
  LoadingSpinner: () => <div data-testid="loading-spinner" />,
}));

const originalResizeObserver = globalThis.ResizeObserver;
const originalMatchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalScrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  window.HTMLElement.prototype,
  "scrollIntoView",
);
const originalScrollToDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, "scrollTo");
const originalElementScrollToDescriptor = Object.getOwnPropertyDescriptor(window.Element.prototype, "scrollTo");

const createRect = (overrides: Partial<DOMRect> = {}): DOMRect => ({
  x: overrides.x ?? 0,
  y: overrides.y ?? overrides.top ?? 0,
  width: overrides.width ?? 0,
  height: overrides.height ?? 0,
  top: overrides.top ?? 0,
  right: overrides.right ?? 0,
  bottom: overrides.bottom ?? 0,
  left: overrides.left ?? 0,
  toJSON: () => ({}),
});

const setElementScrollMetrics = (
  element: HTMLElement,
  metrics: { clientHeight: number; scrollHeight: number; scrollTop?: number },
) => {
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: metrics.scrollTop ?? 0,
  });
};

const seriesFixture: Series[] = [
  {
    id: "series-a",
    library_id: "library-1",
    title: "Alpha",
    path: "/library/Alpha",
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
  },
  {
    id: "series-b",
    library_id: "library-1",
    title: "Beta",
    path: "/library/Beta",
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
  },
  {
    id: "series-c",
    library_id: "library-1",
    title: "Cat",
    path: "/library/Cat",
    created_at: "2026-04-10T00:00:00Z",
    updated_at: "2026-04-10T00:00:00Z",
  },
];

const renderLibraryPage = () =>
  render(
    <MemoryRouter initialEntries={["/libraries/library-1"]}>
      <Routes>
        <Route
          path="/libraries/:id"
          element={<LibraryPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("LibraryPage series index", () => {
  let defaultRectSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    MockResizeObserver.instances = [];
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

    defaultRectSpy = vi.spyOn(window.HTMLElement.prototype, "getBoundingClientRect");
    defaultRectSpy.mockReturnValue(createRect({ top: 999, bottom: 1019, height: 20 }));

    Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
    Object.defineProperty(window.Element.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });

    mocks.fetchLibrariesMock.mockResolvedValue(undefined);
    mocks.libraryGetMock.mockResolvedValue({
      data: {
        id: "library-1",
        name: "테스트",
        paths: ["/library"],
        default_view_mode: "single",
        default_read_direction: "left-to-right",
        default_page_transition: "slide",
        default_epub_render_mode: "flow",
        default_epub_theme: "dark",
        default_epub_spread: "auto",
        default_epub_wheel_direction: "vertical",
        default_epub_keyboard_direction: "default",
        default_epub_click_direction: "default",
        sort_order: 0,
        scan_status: "IDLE",
        last_scan_result: "",
        type: "LOCAL",
      },
    });
    mocks.libraryGetSeriesMock.mockResolvedValue({
      data: {
        series: seriesFixture,
      },
    });
  });

  afterEach(() => {
    defaultRectSpy.mockRestore();
    globalThis.ResizeObserver = originalResizeObserver;
    if (originalMatchMediaDescriptor) {
      Object.defineProperty(window, "matchMedia", originalMatchMediaDescriptor);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
    if (originalScrollIntoViewDescriptor) {
      Object.defineProperty(window.HTMLElement.prototype, "scrollIntoView", originalScrollIntoViewDescriptor);
    } else {
      Reflect.deleteProperty(window.HTMLElement.prototype, "scrollIntoView");
    }
    if (originalScrollToDescriptor) {
      Object.defineProperty(window.HTMLElement.prototype, "scrollTo", originalScrollToDescriptor);
    } else {
      Reflect.deleteProperty(window.HTMLElement.prototype, "scrollTo");
    }
    if (originalElementScrollToDescriptor) {
      Object.defineProperty(window.Element.prototype, "scrollTo", originalElementScrollToDescriptor);
    } else {
      Reflect.deleteProperty(window.Element.prototype, "scrollTo");
    }
  });

  it("복귀한 라이브러리에서 직전에 열었던 시리즈 카드를 중앙에 맞춘다", async () => {
    rememberReturnFocus("library", "library-1", "series-b");

    renderLibraryPage();

    await screen.findByText("Beta");
    await waitFor(() => {
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: "smooth",
        block: "center",
      });
    });
  });

  it("동작 줄이기 설정에서는 복귀 카드를 즉시 중앙에 맞춘다", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn(() => ({ matches: true })),
    });
    rememberReturnFocus("library", "library-1", "series-b");

    renderLibraryPage();

    await screen.findByText("Beta");
    await waitFor(() => {
      expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: "auto",
        block: "center",
      });
    });
  });

  it("활성 목차 항목이 스크롤 영역 중앙에 오도록 이동한다", async () => {
    renderLibraryPage();

    const targetButton = await screen.findByRole("button", { name: "jump C" });
    const nav = screen.getByRole("navigation", { name: "series index" });
    const scrollArea = nav.firstElementChild as HTMLElement;
    const scrollToMock = vi.fn();

    setElementScrollMetrics(scrollArea, { clientHeight: 100, scrollHeight: 300 });
    Object.defineProperty(scrollArea, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => createRect({ top: 100, bottom: 200, height: 100 })),
    });
    Object.defineProperty(targetButton, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => createRect({ top: 180, bottom: 200, height: 20 })),
    });
    Object.defineProperty(scrollArea, "scrollTo", {
      configurable: true,
      value: scrollToMock,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "jump A" })).toHaveAttribute("aria-current", "location");
    });
    scrollToMock.mockClear();

    fireEvent.click(targetButton);

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 40,
        behavior: "auto",
      });
    });
  });

  it("scrollTo를 지원하지 않으면 scrollTop으로 활성 목차 위치를 맞춘다", async () => {
    renderLibraryPage();

    const targetButton = await screen.findByRole("button", { name: "jump C" });
    const nav = screen.getByRole("navigation", { name: "series index" });
    const scrollArea = nav.firstElementChild as HTMLElement;

    setElementScrollMetrics(scrollArea, { clientHeight: 100, scrollHeight: 300 });
    Object.defineProperty(scrollArea, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => createRect({ top: 100, bottom: 200, height: 100 })),
    });
    Object.defineProperty(targetButton, "getBoundingClientRect", {
      configurable: true,
      value: vi.fn(() => createRect({ top: 180, bottom: 200, height: 20 })),
    });
    Object.defineProperty(scrollArea, "scrollTo", {
      configurable: true,
      value: undefined,
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "jump A" })).toHaveAttribute("aria-current", "location");
    });
    scrollArea.scrollTop = 0;

    fireEvent.click(targetButton);

    await waitFor(() => {
      expect(scrollArea.scrollTop).toBe(40);
    });
  });

  it("목차 스크롤바는 사용자 조작에서만 표시된다", async () => {
    renderLibraryPage();

    await screen.findByRole("button", { name: "jump C" });
    const nav = screen.getByRole("navigation", { name: "series index" });
    const scrollArea = nav.firstElementChild as HTMLElement;

    setElementScrollMetrics(scrollArea, { clientHeight: 100, scrollHeight: 300 });
    MockResizeObserver.instances[0]?.trigger();

    await waitFor(() => {
      expect(nav.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    });

    fireEvent.mouseEnter(scrollArea);
    expect(nav.querySelector('[aria-hidden="true"]')).not.toHaveClass(styles.seriesIndexScrollbarVisible);

    fireEvent.wheel(scrollArea);

    await waitFor(() => {
      expect(nav.querySelector('[aria-hidden="true"]')).toHaveClass(styles.seriesIndexScrollbarVisible);
    });
  });

  it("중첩 경로가 있어도 시리즈 카드에는 권/화 수를 우선 표시한다", async () => {
    mocks.libraryGetSeriesMock.mockResolvedValueOnce({
      data: {
        series: [
          {
            id: "nested-series",
            library_id: "library-1",
            title: "가면라이더",
            path: "/library/1.단편/[ ㄱ ]/가면라이더",
            display_unit: "volume",
            volume_count: 3,
            chapter_count: 12,
            created_at: "2026-04-10T00:00:00Z",
            updated_at: "2026-04-10T00:00:00Z",
          },
        ],
      },
    });

    renderLibraryPage();

    expect(await screen.findByTestId("series-subtitle-nested-series")).toHaveTextContent("series.unit.total_volume 3");
    expect(screen.getByTestId("series-subtitle-nested-series")).not.toHaveTextContent("1.단편 / [ ㄱ ]");
  });
});
