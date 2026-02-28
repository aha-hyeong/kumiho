import type { EpubRenderMode } from "../../../stores/epubViewerStore";

export type EpubRenderLayout = "book" | "comic";

type SpineItemProperties = string | string[] | Record<string, unknown> | undefined;

function parseLayoutSignal(value: unknown): EpubRenderLayout | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  if (
    normalized.includes("pre-paginated") ||
    normalized.includes("layout-pre-paginated") ||
    normalized.includes("fixed")
  ) {
    return "comic";
  }
  if (normalized.includes("reflowable") || normalized.includes("reflow")) {
    return "book";
  }
  return null;
}

export function detectLayoutFromPackageMetadata(book: unknown): EpubRenderLayout | null {
  const rawBook = book as {
    package?: { metadata?: Record<string, unknown> };
    packaging?: { metadata?: Record<string, unknown> };
  };
  const metadata = rawBook.package?.metadata || rawBook.packaging?.metadata;
  if (!metadata) return null;

  const directKeys = ["rendition:layout", "layout", "rendition_layout"];
  for (const key of directKeys) {
    const signal = parseLayoutSignal(metadata[key]);
    if (signal) return signal;
  }

  for (const [key, value] of Object.entries(metadata)) {
    const lowerKey = key.toLowerCase();
    if (!lowerKey.includes("layout")) continue;
    const signal = parseLayoutSignal(value);
    if (signal) return signal;
  }
  return null;
}

function includesPrePaginated(properties: SpineItemProperties): boolean {
  if (!properties) return false;
  if (typeof properties === "string") {
    const lower = properties.toLowerCase();
    return lower.includes("layout-pre-paginated") || lower.includes("pre-paginated");
  }
  if (Array.isArray(properties)) {
    return properties.some((item) => includesPrePaginated(item));
  }
  return Object.values(properties).some((value) => includesPrePaginated(value as SpineItemProperties));
}

export function detectLayoutFromSpine(book: unknown): EpubRenderLayout | null {
  const rawBook = book as {
    spine?: { spineItems?: Array<{ properties?: SpineItemProperties }> };
  };
  const items = rawBook.spine?.spineItems || [];
  if (items.length === 0) return null;

  const prePaginatedCount = items.reduce((count, item) => {
    return includesPrePaginated(item.properties) ? count + 1 : count;
  }, 0);

  const ratio = prePaginatedCount / items.length;
  if (ratio >= 0.5) return "comic";
  if (prePaginatedCount === 0) return "book";
  return null;
}

export function detectLayoutFromDocument(doc: Document): EpubRenderLayout | null {
  const hasViewportMeta = Boolean(doc.querySelector("meta[name='viewport']"));
  if (!hasViewportMeta) return null;

  const imageLikeCount = doc.querySelectorAll("img, svg, canvas, image").length;
  const textLength = (doc.body?.textContent || "").replace(/\s+/g, "").length;

  if (imageLikeCount > 0 && textLength < 100) {
    return "comic";
  }
  return null;
}

export function resolveEffectiveLayout(renderMode: EpubRenderMode, detectedLayout: EpubRenderLayout): EpubRenderLayout {
  if (renderMode === "auto") return detectedLayout;
  return renderMode;
}
