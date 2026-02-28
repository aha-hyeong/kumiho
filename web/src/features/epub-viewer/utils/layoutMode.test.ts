import { describe, expect, it } from "vitest";
import {
  detectLayoutFromDocument,
  detectLayoutFromPackageMetadata,
  detectLayoutFromSpine,
  resolveEffectiveLayout,
} from "./layoutMode";

describe("EPUB layout mode utilities", () => {
  it("detects comic layout from package metadata", () => {
    const result = detectLayoutFromPackageMetadata({
      package: {
        metadata: {
          "rendition:layout": "pre-paginated",
        },
      },
    });
    expect(result).toBe("comic");
  });

  it("detects book layout from package metadata", () => {
    const result = detectLayoutFromPackageMetadata({
      package: {
        metadata: {
          layout: "reflowable",
        },
      },
    });
    expect(result).toBe("book");
  });

  it("detects comic layout when most spine items are pre-paginated", () => {
    const result = detectLayoutFromSpine({
      spine: {
        spineItems: [
          { properties: "rendition:layout-pre-paginated" },
          { properties: ["layout-pre-paginated"] },
          { properties: "something-else" },
        ],
      },
    });
    expect(result).toBe("comic");
  });

  it("resolves effective layout by render mode", () => {
    expect(resolveEffectiveLayout("auto", "comic")).toBe("comic");
    expect(resolveEffectiveLayout("book", "comic")).toBe("book");
    expect(resolveEffectiveLayout("comic", "book")).toBe("comic");
  });

  it("detects comic layout from fixed-layout like document", () => {
    document.body.innerHTML = `
      <meta name="viewport" content="width=1024,height=768" />
      <div><img src="a.jpg" /></div>
      <p>Short text</p>
    `;
    const result = detectLayoutFromDocument(document);
    expect(result).toBe("comic");
  });

  it("does not classify as comic when images are present but text is sufficient", () => {
    document.body.innerHTML = `
      <meta name="viewport" content="width=1024,height=768" />
      <div><img src="a.jpg" /></div>
      <p>${"a ".repeat(120)}</p>
    `;
    const result = detectLayoutFromDocument(document);
    expect(result).toBe(null);
  });
});
