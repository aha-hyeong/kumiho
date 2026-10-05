import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import App from "./App";

const { auth, viewer, setup } = vi.hoisted(() => {
  let release!: () => void;
  return {
    auth: { isAuthenticated: true, isLoading: false, checkAuth: vi.fn() },
    setup: { get: vi.fn() },
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
vi.mock("./api/client", () => ({ api: { get: setup.get } }));
vi.mock("./pages/Viewer", async () => {
  await viewer.gate;
  return { ViewerPage: () => <div>Viewer route</div> };
});
vi.mock("./pages/Settings", () => ({ SettingsPage: () => <div>Settings route</div> }));

beforeEach(() => {
  auth.isAuthenticated = true; auth.isLoading = false; auth.checkAuth.mockReset();
  setup.get.mockReset().mockResolvedValue({ data: { needs_setup: false } });
});

function RouteControls() {
  const navigate = useNavigate();
  return <><button onClick={() => navigate("/settings")}>Go Settings</button><button onClick={() => navigate(-1)}>Go Back</button><button onClick={() => navigate("/setup")}>Go Setup</button><button onClick={() => navigate("/login")}>Go Login</button></>;
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

// The existing direct-viewer redirect already covers unauthenticated login + no setup.
it.each([
  ["/setup", true, "Setup route"],
  ["/setup", false, "Login route"],
  ["/login", true, "Setup route"],
])("checks setup policy for %s (needs setup: %s)", async (path, needsSetup, expected) => {
  auth.isAuthenticated = false;
  setup.get.mockResolvedValue({ data: { needs_setup: needsSetup } });
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(expected)).toBeInTheDocument());
  expect(setup.get).toHaveBeenCalledWith("/auth/setup");
});

it.each(["/setup", "/login"])("sends authenticated %s entry home before setup redirects", async (path) => {
  setup.get.mockResolvedValue({ data: { needs_setup: path === "/login" } });
  render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Home route")).toBeInTheDocument());
});

it.each(["/setup", "/login"])("waits for both setup and auth loading before redirecting %s home", async (path) => {
  let resolve!: (value: { data: { needs_setup: boolean } }) => void;
  setup.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const app = <MemoryRouter initialEntries={[path]}><App /></MemoryRouter>;
  const { rerender } = render(app);
  expect(document.querySelector(".loading-spinner")).toBeInTheDocument();
  expect(screen.queryByText("Home route")).not.toBeInTheDocument();
  auth.isLoading = true;
  await act(async () => { resolve({ data: { needs_setup: true } }); });
  expect(document.querySelector(".loading-spinner")).toBeInTheDocument();
  auth.isLoading = false;
  rerender(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText("Home route")).toBeInTheDocument());
});

it.each([
  ["/setup", "Setup route", "Go Login", "Login route"],
  ["/login", "Login route", "Go Setup", "Setup route"],
])("keeps %s after failure and resets failure/success state on each entry", async (path, firstScreen, goOther, otherScreen) => {
  auth.isAuthenticated = false;
  setup.get.mockRejectedValueOnce(new Error("setup unavailable"));
  render(<MemoryRouter initialEntries={[path]}><RouteControls /><App /></MemoryRouter>);
  await waitFor(() => expect(screen.getByText(firstScreen)).toBeInTheDocument());
  expect(setup.get).toHaveBeenCalledTimes(1);

  let resolve!: (value: { data: { needs_setup: boolean } }) => void;
  setup.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  act(() => screen.getByText(goOther).click());
  expect(document.querySelector(".loading-spinner")).toBeInTheDocument();
  expect(screen.queryByText(firstScreen)).not.toBeInTheDocument();
  expect(screen.queryByText(otherScreen)).not.toBeInTheDocument();
  expect(setup.get).toHaveBeenCalledTimes(2);
  await act(async () => { resolve({ data: { needs_setup: path === "/login" } }); });
  expect(screen.getByText(otherScreen)).toBeInTheDocument();

  setup.get.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  act(() => screen.getByText("Go Back").click());
  expect(document.querySelector(".loading-spinner")).toBeInTheDocument();
  expect(screen.queryByText(otherScreen)).not.toBeInTheDocument();
  expect(setup.get).toHaveBeenCalledTimes(3);
  await act(async () => { resolve({ data: { needs_setup: path === "/setup" } }); });
  expect(screen.getByText(firstScreen)).toBeInTheDocument();
});
