import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";

const { auth, viewer } = vi.hoisted(() => {
  let release!: () => void;
  return {
    auth: { isAuthenticated: true, isLoading: false, checkAuth: vi.fn() },
    viewer: { gate: new Promise<void>((resolve) => { release = resolve; }), release: () => release() },
  };
});
vi.mock("./stores/authStore", () => ({ useAuthStore: (select?: (state: typeof auth) => unknown) => select ? select(auth) : auth }));
vi.mock("./hooks/useScrollToTop", () => ({ useScrollToTop: () => {} }));
vi.mock("./features/audio-player/AudioProvider", () => ({ AudioProvider: () => null }));
vi.mock("./features/audio-player/AtmosphereProvider", () => ({ AtmosphereProvider: () => null }));
vi.mock("./features/audio-player/components/AudioFullscreenPlayer/AudioFullscreenPlayer", () => ({ AudioFullscreenPlayer: () => null }));
vi.mock("./features/audio-player/components/AudioMiniPlayer/AudioMiniPlayer", () => ({ AudioMiniPlayer: () => null }));
vi.mock("./features/audio-player/components/AudioSidebarPlayer/AudioSidebarPlayer", () => ({ AudioSidebarPlayer: () => null }));
vi.mock("./pages/Auth", () => ({ LoginPage: () => <div>Login route</div>, RegisterPage: () => <div>Setup route</div> }));
vi.mock("./pages/Home", () => ({ HomePage: () => <div>Home route</div> }));
vi.mock("./api/client", () => ({ api: { get: () => Promise.resolve({ data: { needs_setup: false } }) } }));
vi.mock("./pages/Viewer", async () => {
  await viewer.gate;
  return { ViewerPage: () => <div>Viewer route</div> };
});
vi.mock("./pages/Settings", () => ({ SettingsPage: () => <div>Settings route</div> }));

beforeEach(() => { auth.isAuthenticated = true; auth.isLoading = false; auth.checkAuth.mockReset(); });

function RouteControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/settings")}>Go Settings</button><button onClick={() => navigate(-1)}>Go Back</button></>;
}

it("loads direct viewer route behind a fallback and navigates to Settings", async () => {
  render(<MemoryRouter initialEntries={["/viewer/c1"]}><RouteControls /><App /></MemoryRouter>);
  expect(screen.queryByText("Viewer route")).not.toBeInTheDocument();
  expect(document.querySelector(".loading-spinner")).toBeInTheDocument();
  await act(async () => { viewer.release(); });
  await waitFor(() => expect(screen.getByText("Viewer route")).toBeInTheDocument());
  act(() => screen.getByText("Go Settings").click());
  await waitFor(() => expect(screen.getByText("Settings route")).toBeInTheDocument());
  act(() => screen.getByText("Go Back").click());
  await waitFor(() => expect(screen.getByText("Viewer route")).toBeInTheDocument());
});

it("redirects unauthenticated direct viewer URLs without mounting a viewer", async () => {
  auth.isAuthenticated = false;
  render(<MemoryRouter initialEntries={["/viewer/c2"]}><App /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Login route")).toBeInTheDocument());
  expect(screen.queryByText("Viewer route")).not.toBeInTheDocument();
});
