import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SeriesCard } from "./SeriesCard";

const { mocks } = vi.hoisted(() => {
  const navigateMock = vi.fn();
  const bootstrapAndPlayMock = vi.fn();
  const volumeGetProgressMock = vi.fn();
  const volumeFindFirstChapterRecursivelyMock = vi.fn();
  const seriesGetProgressMock = vi.fn();
  const seriesGetChaptersMock = vi.fn();
  const setIncognitoMock = vi.fn();

  return {
    mocks: {
      navigateMock,
      bootstrapAndPlayMock,
      volumeGetProgressMock,
      volumeFindFirstChapterRecursivelyMock,
      seriesGetProgressMock,
      seriesGetChaptersMock,
      setIncognitoMock,
    },
  };
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigateMock,
    useLocation: () => ({ pathname: "/series/series-1", search: "" }),
  };
});

vi.mock("../api/client", () => ({
  volumeAPI: {
    getProgress: (...args: unknown[]) => mocks.volumeGetProgressMock(...args),
    findFirstChapterRecursively: (...args: unknown[]) => mocks.volumeFindFirstChapterRecursivelyMock(...args),
  },
  seriesAPI: {
    getProgress: (...args: unknown[]) => mocks.seriesGetProgressMock(...args),
    getChapters: (...args: unknown[]) => mocks.seriesGetChaptersMock(...args),
  },
  chapterAPI: {
    markComplete: vi.fn(),
    deleteProgress: vi.fn(),
  },
}));

vi.mock("../stores/viewerStore", () => ({
  useViewerStore: () => mocks.setIncognitoMock,
}));

vi.mock("../stores/audioPlayerStore", () => ({
  useAudioPlayerStore: {
    getState: () => ({
      bootstrapAndPlay: mocks.bootstrapAndPlayMock,
    }),
  },
}));

vi.mock("./modals/AlertModal", () => ({
  AlertModal: () => null,
}));

describe("SeriesCard audiobook bootstrap guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bootstrapAndPlayMock.mockResolvedValue({ ok: true });
    mocks.volumeGetProgressMock.mockResolvedValue({ data: { progress_list: [] } });
    mocks.volumeFindFirstChapterRecursivelyMock.mockResolvedValue(null);
    mocks.seriesGetProgressMock.mockResolvedValue({ data: { progress: null } });
    mocks.seriesGetChaptersMock.mockResolvedValue({ data: { chapters: [] } });
  });

  it("일반 도서 볼륨은 has_audio=true 여도 오디오 부트스트랩을 호출하지 않는다", async () => {
    mocks.volumeGetProgressMock.mockResolvedValue({
      data: {
        progress_list: [{ chapter_id: "chapter-14", updated_at: "2026-03-21T00:00:00Z" }],
      },
    });

    render(
      <SeriesCard
        type="volume"
        item={{
          id: "volume-1",
          series_id: "series-1",
          title: "볼륨 1",
          volume_number: 1,
          path: "/books/volume-1.zip",
          has_audio: true,
          library_type: "book",
          chapter_count: 10,
          created_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("series.action.read_now"));

    await waitFor(() => {
      expect(mocks.navigateMock).toHaveBeenCalledWith("/viewer/chapter-14", {
        state: { from: "/series/series-1" },
      });
    });
    expect(mocks.bootstrapAndPlayMock).not.toHaveBeenCalled();
  });

  it("오디오북 시리즈는 오디오 부트스트랩을 호출한다", async () => {
    render(
      <SeriesCard
        type="series"
        item={{
          id: "series-audio",
          library_id: "library-1",
          title: "오디오북 시리즈",
          path: "/audio/book",
          library_type: "audiobook",
          has_audio: true,
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    fireEvent.click(screen.getByTitle("series.action.read_now"));

    await waitFor(() => {
      expect(mocks.bootstrapAndPlayMock).toHaveBeenCalledWith({
        source: "series",
        seriesId: "series-audio",
        series: expect.objectContaining({
          id: "series-audio",
          library_type: "audiobook",
        }),
      });
    });
  });

  it("일반 도서 볼륨은 has_audio=true 여도 오디오북 썸네일 레이아웃을 사용하지 않는다", () => {
    const { container } = render(
      <SeriesCard
        type="volume"
        item={{
          id: "volume-2",
          series_id: "series-1",
          title: "볼륨 2",
          volume_number: 2,
          path: "/books/volume-2.zip",
          thumbnail_url: "/api/v1/volumes/volume-2/thumbnail",
          has_audio: true,
          library_type: "book",
          chapter_count: 8,
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    const images = container.querySelectorAll("img");
    expect(images.length).toBe(1);
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull();
    expect(images[0]).toHaveAttribute("alt", "볼륨 2");
  });

  it("오디오북 시리즈는 메타 영역에 음표 아이콘을 유지한다", () => {
    const { container } = render(
      <SeriesCard
        type="series"
        item={{
          id: "series-audio-icon",
          library_id: "library-1",
          title: "오디오북 시리즈",
          path: "/audio/series",
          library_type: "audiobook",
          has_audio: true,
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    const meta = container.querySelector("h3")?.nextElementSibling as HTMLElement | null;
    expect(meta?.querySelector("svg")).not.toBeNull();
  });

  it("일반 도서 볼륨은 has_audio=true 이면 음표 아이콘을 표시한다", () => {
    const { container } = render(
      <SeriesCard
        type="volume"
        item={{
          id: "volume-audio-icon",
          series_id: "series-1",
          title: "배경음 볼륨",
          volume_number: 3,
          path: "/books/volume-3.zip",
          has_audio: true,
          library_type: "book",
          chapter_count: 6,
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    const meta = container.querySelector("h3")?.nextElementSibling as HTMLElement | null;
    expect(meta?.querySelector("svg")).not.toBeNull();
  });

  it("일반 시리즈는 has_audio=true 여도 음표 아이콘을 표시하지 않는다", () => {
    const { container } = render(
      <SeriesCard
        type="series"
        item={{
          id: "series-book-audio",
          library_id: "library-1",
          title: "배경음 포함 시리즈",
          path: "/books/series-audio",
          library_type: "book",
          has_audio: true,
          chapter_count: 12,
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    const meta = container.querySelector("h3")?.nextElementSibling as HTMLElement | null;
    expect(meta?.querySelector("svg")).toBeNull();
  });

  it("시리즈 display_unit이 volume이면 볼륨 개수를 우선 표시한다", () => {
    render(
      <SeriesCard
        type="series"
        item={{
          id: "series-volume-unit",
          library_id: "library-1",
          title: "볼륨형 시리즈",
          display_unit: "volume",
          volume_count: 13,
          chapter_count: 13,
          path: "/books/series",
          created_at: "2026-03-21T00:00:00Z",
          updated_at: "2026-03-21T00:00:00Z",
        }}
      />,
    );

    expect(screen.getByText("series.unit.volume")).toBeInTheDocument();
    expect(screen.queryByText("series.unit.chapter_count")).toBeNull();
  });

});

describe("SeriesCard navigateTo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigateTo가 있으면 카드 클릭 시 기본 볼륨 경로 대신 지정 경로로 이동한다", () => {
    render(
      <SeriesCard
        type="volume"
        item={{
          id: "volume-3",
          series_id: "series-3",
          title: "볼륨 3",
          volume_number: 3,
          path: "/books/volume-3.zip",
          library_type: "book",
          chapter_count: 5,
          created_at: "2026-03-21T00:00:00Z",
        }}
        navigateTo="/series/series-3"
      />,
    );

    const card = screen.getByText("볼륨 3").closest('[role="button"]');
    fireEvent.click(card!);

    expect(mocks.navigateMock).toHaveBeenCalledWith("/series/series-3");
  });
});
