import { StrictMode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "./Header";
import { useAuthStore } from "../../stores/authStore";

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(), getUpdates: vi.fn(), subscribe: vi.fn(() => vi.fn()),
  translate: (key: string) => key,
}));
vi.mock("../../api/client", () => ({
  systemAPI: { getVersion: mocks.getVersion },
  pluginAPI: { getUpdates: mocks.getUpdates },
  seriesAPI: { search: vi.fn() },
}));
vi.mock("../../hooks/useSSE", () => ({ useSSE: () => ({ subscribe: mocks.subscribe }), disconnectSSE: vi.fn() }));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: mocks.translate }) }));
vi.mock("../ScanProgressBar", () => ({ ScanProgressBar: () => null }));
vi.mock("../Atmosphere/AtmosphereSettings", () => ({ AtmosphereSettings: () => null }));

const master = { id: "master-1", username: "admin", nickname: "admin", role: "MASTER" as const,
  can_download: true, created_at: "", updated_at: "" };
let userCounter = 0;
function showHeader() { return render(<MemoryRouter><Header /></MemoryRouter>); }
async function idle() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); }); }

beforeEach(() => {
  mocks.getVersion.mockReset().mockResolvedValue({ needs_update: true });
  mocks.getUpdates.mockReset().mockResolvedValue({ has_updates: false, count: 0, plugins: [] });
  useAuthStore.setState({ user: { ...master, id: `master-${++userCounter}` }, isAuthenticated: true });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); useAuthStore.setState({ user: null, isAuthenticated: false });
});

describe("Header automatic update checks", () => {
  it("shares badge state and avoids repeat calls on route remount", async () => {
    const first = showHeader(); await idle();
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    expect(mocks.getUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("header.new_update_available")).toBeInTheDocument();
    first.unmount();
    const second = showHeader(); await idle();
    second.unmount();
    showHeader(); await idle();
    expect(screen.getByLabelText("header.new_update_available")).toBeInTheDocument();
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    expect(mocks.getUpdates).toHaveBeenCalledTimes(1);
  });
  it("does not query as USER", async () => {
    useAuthStore.setState({ user: { ...master, role: "USER" } });
    showHeader(); await idle();
    expect(mocks.getVersion).not.toHaveBeenCalled();
    expect(mocks.getUpdates).not.toHaveBeenCalled();
  });
  it("shares plugin badge across simultaneous Headers under StrictMode", async () => {
    mocks.getVersion.mockResolvedValue({ needs_update: false });
    mocks.getUpdates.mockResolvedValue({ has_updates: true, count: 1, plugins: [] });
    render(<StrictMode><MemoryRouter><Header /><Header /></MemoryRouter></StrictMode>);
    await idle();
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    expect(mocks.getUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getAllByLabelText("header.new_update_available")).toHaveLength(2);
  });
  it("polls once for the whole SPA after 30 minutes", async () => {
    let poll: (() => void) | undefined;
    const realSetInterval = window.setInterval;
    vi.spyOn(window, "setInterval").mockImplementation(((callback: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 30 * 60 * 1000) poll = callback as () => void;
      return realSetInterval(callback, delay, ...args);
    }) as typeof window.setInterval);
    const now = vi.spyOn(Date, "now");
    now.mockReturnValue(2_000_000_000_000);
    showHeader(); await idle();
    expect(mocks.getVersion).toHaveBeenCalledTimes(1);
    now.mockReturnValue(2_000_000_000_000 + 30 * 60 * 1000);
    await act(async () => { poll?.(); await Promise.resolve(); });
    expect(mocks.getVersion).toHaveBeenCalledTimes(2);
    expect(mocks.getUpdates).toHaveBeenCalledTimes(2);
  });
});
