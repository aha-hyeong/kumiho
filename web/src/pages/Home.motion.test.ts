import { describe, expect, it } from "vitest";
import homeCSS from "./Home.module.css?raw";
import thumbnailCSS from "../components/common/CardThumbnail.module.css?raw";

function motionRules(source = homeCSS) {
  const style = document.createElement("style");
  style.textContent = source;
  document.head.append(style);
  const rules = Array.from(style.sheet!.cssRules);
  style.remove();
  return rules;
}

// CSS policy tests; native timing and media-query behavior are verified in a browser.
describe("Home card entrance motion", () => {
  it("disables the thumbnail fade under reduced motion", () => {
    const media = motionRules(thumbnailCSS).find((rule) =>
      "conditionText" in rule && rule.conditionText === "(prefers-reduced-motion: reduce)",
    ) as CSSMediaRule | undefined;
    expect(media).toBeDefined();
    const image = Array.from(media!.cssRules).find((rule) =>
      "selectorText" in rule && rule.selectorText === ".thumbnail > .image",
    ) as CSSStyleRule;
    expect(image.style.getPropertyValue("transition")).toBe("none");
  });

  it("has no card entrance animation outside the no-preference media query", () => {
    for (const rule of motionRules()) {
      if ("conditionText" in rule && rule.conditionText === "(prefers-reduced-motion: no-preference)") continue;
      expect(rule.cssText).not.toContain("animation:");
    }
  });
  it("staggers from 0ms in 35ms steps and caps even the hundredth card at 175ms", () => {
    const media = motionRules().find((rule) =>
      "conditionText" in rule && rule.conditionText === "(prefers-reduced-motion: no-preference)",
    ) as CSSMediaRule;
    const rules = Array.from(media.cssRules).filter((rule) => "selectorText" in rule) as CSSStyleRule[];
    const row = document.createElement("div");
    row.className = "seriesGrid";
    for (let index = 0; index < 100; index++) row.append(document.createElement("div"));
    const delays = Array.from(row.children).map((card) => {
      let delay = "0ms";
      for (const rule of rules) if (card.matches(rule.selectorText)) {
        delay = rule.style.getPropertyValue("animation-delay") || delay;
      }
      return parseFloat(delay);
    });
    expect(delays.slice(0, 7)).toEqual([0, 35, 70, 105, 140, 175, 175]);
    expect(Math.max(...delays)).toBe(175);
    expect(delays[99]).toBe(175);
  });
  it("opts in only individual Home cards when the OS allows motion", () => {
    const media = motionRules().find((rule) =>
      "conditionText" in rule && rule.conditionText === "(prefers-reduced-motion: no-preference)",
    ) as CSSMediaRule | undefined;
    expect(media).toBeDefined();
    const card = Array.from(media!.cssRules).find((rule) =>
      "selectorText" in rule && rule.selectorText === ".seriesGrid > *",
    ) as CSSStyleRule;
    expect(card.style.getPropertyValue("animation")).toBe("homeCardEnter 220ms cubic-bezier(0.2, 0, 0, 1) backwards");
  });
});
