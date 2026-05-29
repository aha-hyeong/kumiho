import { describe, expect, it } from "vitest";
import { isFullscreenToggleShortcut } from "./fullscreen";

describe("isFullscreenToggleShortcut", () => {
  it("returns true for single f, F, and ㄹ key presses", () => {
    const eventF = new KeyboardEvent("keydown", { key: "f" });
    const eventFUpper = new KeyboardEvent("keydown", { key: "F" });
    const eventKorean = new KeyboardEvent("keydown", { key: "ㄹ" });

    expect(isFullscreenToggleShortcut(eventF)).toBe(true);
    expect(isFullscreenToggleShortcut(eventFUpper)).toBe(true);
    expect(isFullscreenToggleShortcut(eventKorean)).toBe(true);
  });

  it("returns false if modifier keys are pressed", () => {
    const eventCtrl = new KeyboardEvent("keydown", { key: "f", ctrlKey: true });
    const eventAlt = new KeyboardEvent("keydown", { key: "f", altKey: true });
    const eventMeta = new KeyboardEvent("keydown", { key: "f", metaKey: true });

    expect(isFullscreenToggleShortcut(eventCtrl)).toBe(false);
    expect(isFullscreenToggleShortcut(eventAlt)).toBe(false);
    expect(isFullscreenToggleShortcut(eventMeta)).toBe(false);
  });

  it("returns false if event is repeated", () => {
    const eventRepeat = new KeyboardEvent("keydown", { key: "f", repeat: true });

    expect(isFullscreenToggleShortcut(eventRepeat)).toBe(false);
  });

  it("returns false for other keys", () => {
    const eventA = new KeyboardEvent("keydown", { key: "a" });
    const eventArrow = new KeyboardEvent("keydown", { key: "ArrowLeft" });
    const eventEscape = new KeyboardEvent("keydown", { key: "Escape" });

    expect(isFullscreenToggleShortcut(eventA)).toBe(false);
    expect(isFullscreenToggleShortcut(eventArrow)).toBe(false);
    expect(isFullscreenToggleShortcut(eventEscape)).toBe(false);
  });

  it("returns false when focus is on editable elements", () => {
    const testCases = ["input", "textarea", "select"];

    testCases.forEach((tagName) => {
      const element = document.createElement(tagName);
      const event = new KeyboardEvent("keydown", { key: "f" });
      Object.defineProperty(event, "target", { value: element, enumerable: true });

      expect(isFullscreenToggleShortcut(event)).toBe(false);
    });
  });

  it("returns false when focus is on a contentEditable element", () => {
    const element = document.createElement("div");
    Object.defineProperty(element, "isContentEditable", { value: true, configurable: true });

    const event = new KeyboardEvent("keydown", { key: "f" });
    Object.defineProperty(event, "target", { value: element, enumerable: true });

    expect(isFullscreenToggleShortcut(event)).toBe(false);
  });

  it("returns true when focus is on a non-editable element", () => {
    const element = document.createElement("div");
    const event = new KeyboardEvent("keydown", { key: "f" });
    Object.defineProperty(event, "target", { value: element, enumerable: true });

    expect(isFullscreenToggleShortcut(event)).toBe(true);
  });
});
