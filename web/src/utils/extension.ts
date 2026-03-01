export const SUPPORTED_EXTENSIONS = ["ZIP", "CBZ", "PDF", "EPUB"] as const;

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

const toExtensionBadge = (extensionSet: Set<string>): ExtensionBadge | "" => {
  if (extensionSet.size > 1) return "MIX";
  const [single] = extensionSet;
  return single && SUPPORTED_EXTENSION_SET.has(single) ? (single as SupportedExtension) : "";
};

export const resolveExtensionFromVolumePaths = (
  seriesPath: string | undefined,
  volumePaths: Array<string | undefined>,
): ExtensionBadge | "" => {
  const extensionSet = new Set<string>();
  const seriesExt = parseSupportedExtension(seriesPath);
  if (seriesExt) extensionSet.add(seriesExt);

  for (const path of volumePaths) {
    const ext = parseSupportedExtension(path);
    if (!ext) continue;
    extensionSet.add(ext);
    if (extensionSet.size > 1) {
      return "MIX";
    }
  }

  return toExtensionBadge(extensionSet);
};

