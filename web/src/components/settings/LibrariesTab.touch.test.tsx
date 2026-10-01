import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibrariesTab } from "./LibrariesTab";
import styles from "./LibrariesTab.module.css";
import stylesheet from "./LibrariesTab.module.css?raw";
import { useLibraryStore, type Library } from "../../stores/libraryStore";

const api = vi.hoisted(() => ({
  getAll: vi.fn(), update: vi.fn(), scan: vi.fn(), delete: vi.fn(), updateOrder: vi.fn(),
  settings: vi.fn(), startPolling: vi.fn(), stopPolling: vi.fn(),
}));
vi.mock("../../api/client", () => ({
  libraryAPI: { getAll: api.getAll, update: api.update, scan: api.scan, delete: api.delete, updateOrder: api.updateOrder },
  settingAPI: { list: api.settings }, filesystemAPI: {},
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("../../stores/authStore", () => {
  const state = { user: { role: "MASTER" } };
  return { useAuthStore: Object.assign((selector: (value: typeof state) => unknown) => selector(state), { getState: () => state }) };
});
vi.mock("../../stores/scanStore", () => ({ useScanStore: () => ({ startPolling: api.startPolling, stopPolling: api.stopPolling }) }));
vi.mock("../common/Toast", () => ({ Toast: () => null }));
vi.mock("../modals/AlertModal", () => ({ AlertModal: ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) => isOpen ? <button onClick={onConfirm}>Confirm delete</button> : null }));

const local: Library = {
  id: "local", name: "Comic library", paths: ["/fixture/comics"], default_view_mode: "single",
  default_read_direction: "rtl", default_page_transition: "slide", default_epub_render_mode: "auto",
  default_epub_theme: "light", default_epub_spread: "none", default_epub_wheel_direction: "down",
  default_epub_keyboard_direction: "right", default_epub_click_direction: "right", sort_order: 0,
  scan_status: "IDLE", last_scan_result: "", type: "LOCAL", library_type: "comic", is_visible: true,
};
const system: Library = { ...local, id: "system", name: "System library", type: "SYSTEM", sort_order: 1 };

beforeEach(() => {
  vi.clearAllMocks();
  useLibraryStore.setState({ libraries: [], isLoading: false, error: null, fetchRequestId: 0 });
  api.getAll.mockResolvedValue({ data: { libraries: [local, system] } });
  api.settings.mockResolvedValue({});
  api.update.mockResolvedValue({}); api.scan.mockResolvedValue({}); api.delete.mockResolvedValue({});
});
afterEach(cleanup);

// jsdom cannot perform native touch scrolling. Guard the CSS policy here;
// verify actual pan and drag behavior separately in a touch-capable browser.
function rule(selector: string) {
  const match = stylesheet.match(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`));
  expect(match, `missing .${selector} CSS rule`).not.toBeNull();
  return match![1];
}

describe("library list touch policy", () => {
  it("does not suppress native pan or pinch gestures on the entire library card", () => {
    expect(rule("libraryItemContainer")).not.toMatch(/touch-action\s*:\s*(?:none|pan-x)\s*;/);
  });

  it("reserves touch gestures for sorting only on the drag handle", () => {
    expect(rule("dragHandle")).toMatch(/touch-action\s*:\s*none\s*;/);
  });

  it("keeps sortable keyboard and pointer activators on handles, not card surfaces", async () => {
    const { container } = render(<LibrariesTab />);
    await screen.findByText(local.name);
    const handles = container.querySelectorAll(`.${styles.dragHandle}`);
    expect(handles).toHaveLength(2);
    for (const handle of handles) {
      expect(handle).toHaveAttribute("role", "button");
      expect(handle).toHaveAttribute("tabindex", "0");
      expect(handle).toHaveAttribute("aria-roledescription", "sortable");
    }
    for (const card of container.querySelectorAll(`.${styles.libraryItemContainer}`)) {
      expect(card).not.toHaveAttribute("role", "button");
      expect(card).not.toHaveAttribute("tabindex");
    }
  });

  it("keeps editing available without starting a reorder", async () => {
    render(<LibrariesTab />);
    await screen.findByText(local.name);
    fireEvent.click(screen.getByTitle("설정 수정"));
    expect(screen.getByDisplayValue(local.name)).toBeInTheDocument();
    expect(api.updateOrder).not.toHaveBeenCalled();
  });

  it("keeps the scan button targeting its library without starting a reorder", async () => {
    render(<LibrariesTab />);
    await screen.findByText(local.name);
    fireEvent.click(screen.getByTitle("sidebar.scan_tooltip"));
    await waitFor(() => expect(api.scan).toHaveBeenCalledWith(local.id));
    expect(api.startPolling).toHaveBeenCalledTimes(1);
    expect(api.updateOrder).not.toHaveBeenCalled();
  });

  it("keeps deletion behind confirmation and targets only its library", async () => {
    render(<LibrariesTab />);
    await screen.findByText(local.name);
    fireEvent.click(screen.getByTitle("삭제"));
    expect(api.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(local.id));
    expect(api.updateOrder).not.toHaveBeenCalled();
  });

  it("keeps the system-library visibility button working without a reorder", async () => {
    render(<LibrariesTab />);
    await screen.findByText(system.name);
    fireEvent.click(screen.getByTitle("common.hide"));
    await waitFor(() => expect(api.update).toHaveBeenCalledWith(system.id, { is_visible: false }));
    expect(api.updateOrder).not.toHaveBeenCalled();
  });
});
