import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Series } from "../types/series";
import type { MetadataSearchResult } from "../types/plugin";
import { seriesAPI } from "../api/client";
import { SeriesMetadataPanel } from "./SeriesMetadataPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "ko" } }),
}));
vi.mock("../api/client", () => ({ seriesAPI: { metadataSearch: vi.fn() } }));

const series: Series = {
  id: "series-1", library_id: "library-1", title: "기본 제목",
  created_at: "2026-07-18T00:00:00Z", updated_at: "2026-07-18T00:00:00Z",
};
const search = vi.mocked(seriesAPI.metadataSearch);
const emptyResult: MetadataSearchResult = { query: {}, candidates: [], failures: [] };

function mount() {
  const submit = vi.fn((event: React.FormEvent) => event.preventDefault());
  render(<form onSubmit={submit}><SeriesMetadataPanel series={series} onApplied={vi.fn()} /></form>);
  return { input: screen.getByPlaceholderText(series.title), submit };
}

describe("SeriesMetadataPanel inside edit form", () => {
  beforeEach(() => { vi.clearAllMocks(); search.mockResolvedValue(emptyResult); });

  it("Enter searches once with the typed query without submitting the edit form", async () => {
    const { input, submit } = mount();
    fireEvent.change(input, { target: { value: "검색어" } });
    const accepted = fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(accepted).toBe(false); // preventDefault blocks the native parent form submit
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith("series-1", { title: "검색어" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("the search button still searches once", async () => {
    const { input, submit } = mount();
    fireEvent.change(input, { target: { value: "버튼 검색" } });
    fireEvent.click(screen.getByRole("button", { name: "series.metadata.search" }));
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
    expect(search).toHaveBeenCalledWith("series-1", { title: "버튼 검색" });
    expect(submit).not.toHaveBeenCalled();
  });

  it("composing Enter prevents parent submit without searching", () => {
    const { input, submit } = mount();
    fireEvent.change(input, { target: { value: "한글" } });
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(false);
    expect(search).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it("does not start a second search while one is pending", async () => {
    let complete!: (value: MetadataSearchResult) => void;
    search.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const { input } = mount();
    fireEvent.change(input, { target: { value: "한번" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "series.metadata.search" }));
    expect(search).toHaveBeenCalledTimes(1);
    complete(emptyResult);
    await waitFor(() => expect(screen.getByRole("button", { name: "series.metadata.search" })).not.toBeDisabled());
  });
});
