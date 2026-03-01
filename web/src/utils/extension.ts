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

interface SeriesExtensionTarget {
  id: string;
  path?: string;
}

interface ResolveSeriesExtensionMapOptions {
  seriesList: SeriesExtensionTarget[];
  cache: Map<string, ExtensionBadge | "">;
  fetchVolumePaths: (seriesId: string) => Promise<Array<string | undefined>>;
  concurrency?: number;
  onError?: (seriesId: string, error: unknown) => void;
}

export const resolveSeriesExtensionMapWithCache = async ({
  seriesList,
  cache,
  fetchVolumePaths,
  concurrency = 4,
  onError,
}: ResolveSeriesExtensionMapOptions): Promise<Partial<Record<string, ExtensionBadge>>> => {
  const missingSeries = seriesList.filter((series) => !cache.has(series.id));
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, missingSeries.length) }, async () => {
    while (cursor < missingSeries.length) {
      const index = cursor;
      cursor += 1;
      const series = missingSeries[index];
      try {
        const volumePaths = await fetchVolumePaths(series.id);
        const badge = resolveExtensionFromVolumePaths(series.path, volumePaths);
        cache.set(series.id, badge);
      } catch (error) {
        onError?.(series.id, error);
        cache.set(series.id, "");
      }
    }
  });
  await Promise.all(workers);

  const extensionMap: Partial<Record<string, ExtensionBadge>> = {};
  seriesList.forEach((series) => {
    const ext = cache.get(series.id) ?? "";
    if (ext) extensionMap[series.id] = ext;
  });

  return extensionMap;
};
