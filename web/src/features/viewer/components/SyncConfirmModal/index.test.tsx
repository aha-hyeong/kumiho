import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncConfirmModal } from ".";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  Trans: ({ values }: { values: { location: string } }) => <>{values.location}</>,
}));
afterEach(cleanup);
const progress = { volume_number: 4, chapter_number: 1, current_page: 5 };
const props = { show: true, serverProgress: progress, onClose: vi.fn(), onConfirm: vi.fn() };

describe("progress sync modal entry", () => {
  it("uses the shared reduced-motion-aware entry without moving the hit targets", () => {
    render(<SyncConfirmModal {...props} />);
    expect(screen.getByRole("dialog").parentElement?.className).toMatch(/contentEnter/);
  });

  it("does not render when hidden or without a server position", () => {
    const view = render(<SyncConfirmModal {...props} show={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    view.rerender(<SyncConfirmModal {...props} serverProgress={null} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["backdrop", "cancel", "confirm"])("handles %s immediately without waiting for animationend", (action) => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    render(<SyncConfirmModal {...props} onClose={onClose} onConfirm={onConfirm} />);
    const target = action === "backdrop"
      ? screen.getByRole("dialog").parentElement!
      : screen.getByRole("button", { name: `viewer.sync.${action}_btn` });
    fireEvent.click(target);
    expect(action === "confirm" ? onConfirm : onClose).toHaveBeenCalledTimes(1);
    expect(action === "confirm" ? onClose : onConfirm).not.toHaveBeenCalled();
  });

  it("keeps the open overlay on updates but remounts it for a new opening", () => {
    const view = render(<SyncConfirmModal {...props} />);
    const overlay = screen.getByRole("dialog").parentElement;
    view.rerender(<SyncConfirmModal {...props} serverProgress={{ ...progress, current_page: 6 }} />);
    expect(screen.getByRole("dialog").parentElement).toBe(overlay);
    view.rerender(<SyncConfirmModal {...props} show={false} />);
    view.rerender(<SyncConfirmModal {...props} />);
    expect(screen.getByRole("dialog").parentElement).not.toBe(overlay);
  });
});
