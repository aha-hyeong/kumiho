import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { HomePage } from "./Home";

const { mocks } = vi.hoisted(() => ({ mocks: {
  getRecent: vi.fn(), fetchLibraries: vi.fn(), refreshKey: 0,
  libraries: [{ id: "library-1", type: "LOCAL" }],
} }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../stores/libraryStore", () => ({ useLibraryStore: () => ({
  libraries: mocks.libraries, fetchLibraries: mocks.fetchLibraries, refreshKey: mocks.refreshKey,
}) }));
vi.mock("../api/client", () => ({
  progressAPI: { getRecent: (...args: unknown[]) => mocks.getRecent(...args) },
  settingAPI: { list: async () => ({ home_layout_order: "default" }) },
  seriesAPI: { getHome: async () => ({ data: { updated_series: [], liked_series: [] } }) },
  volumeAPI: {}, chapterAPI: {},
}));
vi.mock("../components/headers/Header", () => ({ Header: () => null }));
vi.mock("../components/Sidebar", () => ({ Sidebar: () => null }));
vi.mock("../components/common/HorizontalDragScroll", () => ({
  HorizontalDragScroll: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../components/modals/AlertModal", () => ({ AlertModal: () => null }));
vi.mock("../components/modals/EditSeriesModal", () => ({ EditSeriesModal: () => null }));
vi.mock("../components/modals/EditVolumeModal", () => ({ EditVolumeModal: () => null }));
vi.mock("../stores/audioPlayerStore", () => ({ useAudioPlayerStore: { getState: () => ({}) } }));
vi.mock("../stores/authStore", () => ({ useAuthStore: () => null }));

// Keep the real Home -> SeriesCard -> CardThumbnail flow, including progress.updated_at mapping.
describe("Home recent-progress thumbnail identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.removeItem("access_token");
    mocks.refreshKey = 0;
    mocks.fetchLibraries.mockResolvedValue(undefined);
  });

  it.each(["series", "volume"] as const)("keeps the loaded %s thumbnail when progress and its timestamp change", async (type) => {
    const thumbnailURL = `/api/v1/${type === "series" ? "series" : "volumes"}/book-1/thumbnail?t=123456`;
    let recent = {
      id: "recent-1", series_id: "series-1", series_title: "계속 읽기 책",
      current_page: 1, total_pages: 10, progress_percent: 10,
      updated_at: "2026-03-21T00:00:00Z", thumbnail_url: thumbnailURL,
      ...(type === "volume" ? { volume_id: "volume-1", volume_number: 1, volume_title: "계속 읽기 책", volume_unit: "volume" } : {}),
    };
    mocks.getRecent.mockImplementation(async () => ({ data: { recent_progress: [recent] } }));
    const home = () => <MemoryRouter><HomePage /></MemoryRouter>;
    const view = render(home());
    const title = await screen.findByText("계속 읽기 책");
    const card = title.closest('[role="button"]')!;
    const image = card.querySelector("img")!;
    const thumbnail = image.parentElement!;
    const initialSrc = image.getAttribute("src");
    fireEvent.load(image);
    expect(thumbnail).toHaveAttribute("data-thumbnail-state", "loaded");
    const loadedClass = image.className;

    recent = { ...recent, progress_percent: 42, current_page: 4, updated_at: "2026-03-22T00:00:00Z" };
    mocks.refreshKey += 1;
    view.rerender(home());
    await waitFor(() => expect(card.querySelector('[class*="seriesProgressFill"]')).toHaveStyle({ width: "42%" }));

    expect(screen.getByText("계속 읽기 책").closest('[role="button"]')).toBe(card);
    expect(card.querySelector("img")).toBe(image);
    expect(image.parentElement).toBe(thumbnail);
    expect(thumbnail).toHaveAttribute("data-thumbnail-state", "loaded");
    expect(image).toHaveAttribute("src", initialSrc);
    expect(image).toHaveAttribute("src", thumbnailURL);
    expect(image.className).toBe(loadedClass);
    expect(card.querySelector("[data-thumbnail-placeholder]")).toBeNull();
    expect(mocks.getRecent).toHaveBeenCalledTimes(2);
  });
});
