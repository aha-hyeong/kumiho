import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Series } from "../types/series";
import { SeriesInfoCard } from "./SeriesInfoCard";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { numbers?: string }) => {
      if (options?.numbers) return `${key}:${options.numbers}`;
      if (key === "series.action.more") return "더보기";
      if (key === "series.action.less") return "접기";
      if (key === "series.missing_number_unit.volume") return "권";
      return key;
    },
    i18n: { language: "ko" },
  }),
}));

vi.mock("../stores/authStore", () => ({
  useAuthStore: () => ({ role: "USER" }),
}));

vi.mock("../api/client", () => ({
  seriesAPI: {},
  volumeAPI: {},
}));

const series: Series = {
  id: "series-1",
  library_id: "library-1",
  title: "테스트 시리즈",
  description: "가".repeat(151),
  created_at: "2026-07-18T00:00:00Z",
  updated_at: "2026-07-18T00:00:00Z",
};

describe("SeriesInfoCard description", () => {
  it("세 줄 안에 표시되는 설명에는 더보기 버튼을 표시하지 않는다", () => {
    render(<SeriesInfoCard series={series} onPlay={vi.fn()} />);

    expect(screen.queryByRole("button", { name: "더보기" })).not.toBeInTheDocument();
  });

  it("display_unit이 없으면 누락 번호를 권으로 표시한다", () => {
    render(<SeriesInfoCard series={series} missingNumberRanges={[{ start: 2, end: 2 }]} onPlay={vi.fn()} />);

    expect(screen.getByRole("button", { name: "series.missing_volumes:2권" })).toBeInTheDocument();
  });

  it("표시할 수 없는 빈 누락 범위는 안내를 렌더링하지 않는다", () => {
    render(<SeriesInfoCard series={series} missingNumberRanges={[{ start: 3, end: 2 }]} onPlay={vi.fn()} />);

    expect(screen.queryByRole("button", { name: /series\.missing_/ })).not.toBeInTheDocument();
  });

  it("누락 회차 안내는 기본으로 접혀 있고 클릭하면 내용을 펼친다", () => {
    render(
      <SeriesInfoCard
        series={{ ...series, display_unit: "volume" }}
        missingNumberRanges={[
          { start: 9, end: 9 },
          { start: 12, end: 12 },
        ]}
        onPlay={vi.fn()}
      />,
    );

    const notice = screen.getByRole("button", { name: "series.missing_volumes:9권, 12권" });
    expect(notice).toHaveAttribute("aria-pressed", "true");
    expect(notice).not.toHaveTextContent("series.missing_volumes:9권, 12권");

    fireEvent.click(notice);

    expect(notice).toHaveAttribute("aria-pressed", "false");
    expect(notice).toHaveTextContent("series.missing_volumes:9권, 12권");

    fireEvent.click(notice);
    expect(notice).toHaveAttribute("aria-pressed", "true");
    expect(notice).not.toHaveTextContent("series.missing_volumes:9권, 12권");
  });
});
