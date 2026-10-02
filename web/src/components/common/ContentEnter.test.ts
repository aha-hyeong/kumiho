import { describe, expect, it } from "vitest";
import home from "../../pages/Home.module.css";
import library from "../../pages/Library.module.css";
import series from "../../pages/Series.module.css";
import volume from "../../pages/Volume.module.css";
import header from "../headers/Header.module.css";
import sidebar from "../Sidebar.module.css";
import pressSource from "./PressFeedback.module.css?raw";

// Native timing, fixed positioning and reduced-motion are covered by the browser fixture.
describe("navigation motion scope", () => {
  it("enters ready content, not Home's still-loading shell or navigation controls", () => {
    for (const className of [home.seriesGrid, home.emptySection, home.emptyLibraryState,
      library.libraryMain, series.seriesMain, volume.volumeMain]) {
      expect(className).toMatch(/contentEnter/);
    }
    for (const className of [home.homeMain, home.section, header.appHeader, sidebar.sidebar,
      library.seriesIndex, volume.chapterItem]) {
      expect(className).not.toMatch(/contentEnter/);
    }
  });

  it("responds faster on press than on release without delaying actions", () => {
    expect(pressSource).toMatch(/:where\(\.pressable\)\s*\{[^}]*--press-transition: scale 120ms ease-out;/);
    expect(pressSource).toMatch(/scale: 0\.98;\s*--press-transition: scale 60ms ease-out;/);
  });
});
