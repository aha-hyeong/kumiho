import styles from "./PressFeedback.module.css";

/** Supplements native :active on touch browsers without owning their gestures. */
export function initPressFeedback() {
  // ponytail: one pressed surface; use per-pointer tracking if multi-touch controls are added.
  let pressed: HTMLElement | null = null;
  const clear = () => {
    pressed?.removeAttribute("data-pressed");
    pressed = null;
  };
  const down = (event: PointerEvent) => {
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    clear();
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(':disabled, [aria-disabled="true"], [inert]')) return;
    const surface = event.target.closest<HTMLElement>(`.${styles.pressable}`);
    const control = event.target.closest('button, a[href], [role="button"], [role="dialog"]');
    if (!surface || (control && control !== surface && surface.contains(control))) return;
    pressed = surface;
    pressed.setAttribute("data-pressed", "");
  };
  const leave = (event: PointerEvent) => {
    if (event.target === pressed) clear();
  };
  document.addEventListener("pointerdown", down, { passive: true });
  document.addEventListener("pointerup", clear, { passive: true });
  document.addEventListener("pointercancel", clear, { passive: true });
  document.addEventListener("pointerleave", leave, true);
  window.addEventListener("blur", clear);
  return () => {
    clear();
    document.removeEventListener("pointerdown", down);
    document.removeEventListener("pointerup", clear);
    document.removeEventListener("pointercancel", clear);
    document.removeEventListener("pointerleave", leave, true);
    window.removeEventListener("blur", clear);
  };
}
