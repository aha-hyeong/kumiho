export const SUPPORTED_EXTENSIONS = [
  "ZIP",
  "CBZ",
  "PDF",
  "EPUB",
  "TXT",
  "IMG",
  "MP3",
  "WAV",
  "OGG",
  "OGA",
  "FLAC",
  "M4A",
  "M4B",
  "AAC",
  "WMA",
  "OPUS",
  "MP4",
] as const;

export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number];
export type ExtensionBadge = SupportedExtension | "MIX";

const SUPPORTED_EXTENSION_SET = new Set<string>(SUPPORTED_EXTENSIONS);

export const parseSupportedExtension = (path?: string): SupportedExtension | null => {
  if (!path) return null;

  const cleanPath = path.split("?")[0].split("#")[0];
  const dotIndex = cleanPath.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === cleanPath.length - 1) return null;

  const ext = cleanPath.slice(dotIndex + 1).toUpperCase();
  return SUPPORTED_EXTENSION_SET.has(ext) ? (ext as SupportedExtension) : null;
};

export const normalizeExtensionBadge = (ext?: string | null): ExtensionBadge | null => {
  if (!ext) return null;
  const value = ext.trim().toUpperCase().replace(".", "");
  if (value === "MIX") return "MIX";
  return SUPPORTED_EXTENSION_SET.has(value) ? (value as SupportedExtension) : null;
};
