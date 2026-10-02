import { describe, expect, it } from "vitest";
import pressSource from "./PressFeedback.module.css?raw";
import press from "./PressFeedback.module.css";
import { initPressFeedback } from "./pressFeedback";
import card from "../SeriesCard.module.css";
import info from "../SeriesInfoCard.module.css";
import header from "../headers/Header.module.css";
import subHeader from "../headers/SubHeader.module.css";
import sidebar from "../Sidebar.module.css";
import library from "../../pages/Library.module.css";
import volume from "../../pages/Volume.module.css";

// Native :active, touch scrolling and transition timing require a real browser.
describe("press feedback opt-in", () => {
  it("tracks only opted-in touch controls without preventing native events", () => {
    const parent = document.createElement("div");
    parent.className = press.pressable;
    parent.setAttribute("role", "button");
    const button = document.createElement("button");
    button.className = press.pressable;
    const unmarked = document.createElement("button");
    parent.append(button, unmarked);
    document.body.append(parent);
    const dispose = initPressFeedback();
    const pointer = (target: Element, type: string, pointerType = "touch") => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, "pointerType", { value: pointerType });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    };
    try {
      pointer(button, "pointerdown", "mouse");
      expect(button).not.toHaveAttribute("data-pressed");
      for (const end of ["pointerup", "pointercancel", "pointerleave"]) {
        pointer(button, "pointerdown");
        expect(button).toHaveAttribute("data-pressed");
        expect(parent).not.toHaveAttribute("data-pressed");
        pointer(button, end);
        expect(button).not.toHaveAttribute("data-pressed");
      }
      button.disabled = true;
      pointer(button, "pointerdown");
      expect(document.querySelector("[data-pressed]")).toBeNull();
      pointer(unmarked, "pointerdown");
      expect(parent).not.toHaveAttribute("data-pressed");
      button.disabled = false;
      button.setAttribute("aria-disabled", "true");
      pointer(button, "pointerdown");
      expect(button).not.toHaveAttribute("data-pressed");
      button.removeAttribute("aria-disabled");
      pointer(button, "pointerdown");
      window.dispatchEvent(new Event("blur"));
      expect(button).not.toHaveAttribute("data-pressed");
    } finally {
      dispose();
      parent.remove();
    }
  });

  it("keeps the fallback transition less specific than component styles", () => {
    expect(pressSource).toMatch(/:where\(\.pressable\)\s*\{/);
  });

  it("shares press feedback only across the selected interactive surfaces", () => {
    const interactive = [
      card.seriesCard, card.seriesPlayButton, card.seriesMenuButton, card.seriesMenuItem,
      info.thumbnailPlayOverlay, info.characterAvatarMore, info.btnMore, info.missingNumberNotice,
      info.btnAction, info.btnIcon, info.btnSplitMain, info.btnSplitArrow, info.dropdownItem,
      header.menuBtn, header.clearBtn, header.userDropdownTrigger, header.dropdownItem,
      header.searchResultItem, header.allResultsBtn, subHeader.backButton,
      sidebar.closeBtn, sidebar.libraryNavItem, sidebar.libraryScanBtn,
      library.seriesIndexButton, library.scanBtn,
      volume.chapterItem, volume.chapterActionButton, volume.chapterMenuButton, volume.chapterMenuItem,
    ];
    for (const className of interactive) expect(className).toMatch(/pressable/);
    const excluded = [
      info.seriesInfoCard, info.characterAvatar, info.characterModalBox, info.characterModalClose,
      info.splitButtonGroup, info.tagChip, header.appHeader, header.logoLink, header.searchWrapper,
      subHeader.subHeader, subHeader.breadcrumbItem, sidebar.sidebar, sidebar.sidebarOverlay,
      library.seriesIndexScrollArea, library.seriesIndexScrollbarThumb, volume.chapterThumbnailWrapper,
    ];
    for (const className of excluded) expect(className).not.toMatch(/pressable/);
  });
});
