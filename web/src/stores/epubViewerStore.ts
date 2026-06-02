import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { enterFullscreen, exitFullscreen, isFullscreen } from "../utils/fullscreen";

// EPUB 테마
export type EpubTheme = "light" | "dark" | "sepia";
export type EpubFontFamily = "original" | "serif" | "sans-serif";

// EPUB 레이아웃
export type EpubFlow = "paginated" | "scrolled";
export type EpubRenderMode = "auto" | "book" | "comic";

export const EPUB_FONT_SIZE_DEFAULT = 100;
export const EPUB_LINE_HEIGHT_SCALE_DEFAULT = 1;
export const EPUB_LINE_HEIGHT_SCALE_MIN = 0.75;
export const EPUB_LINE_HEIGHT_SCALE_MAX = 1.25;
const LEGACY_EPUB_LINE_HEIGHT_DEFAULT = 1.6;

export const normalizeEpubLineHeightScale = (value: number): number | null => {
  if (!Number.isFinite(value)) return null;
  if (value >= EPUB_LINE_HEIGHT_SCALE_MIN && value <= EPUB_LINE_HEIGHT_SCALE_MAX) {
    return value;
  }
  if (value > EPUB_LINE_HEIGHT_SCALE_MAX && value <= 2.0) {
    const normalized = value / LEGACY_EPUB_LINE_HEIGHT_DEFAULT;
    return Math.max(EPUB_LINE_HEIGHT_SCALE_MIN, Math.min(EPUB_LINE_HEIGHT_SCALE_MAX, normalized));
  }
  return null;
};

// EPUB 뷰어 설정 (이미지/PDF 뷰어와 완전히 분리)
export interface EpubViewerSettings {
  fontSize: number; // 폰트 크기 % (100 = 기본, 50~150)
  fontFamily: EpubFontFamily;
  lineHeight: number; // 줄 간격 배율 (1 = 원본, 0.75 ~ 1.25)
  theme: EpubTheme; // 테마
  renderMode: EpubRenderMode; // EPUB 렌더 모드 ("auto" = 자동 감지)
  flow: EpubFlow; // 레이아웃 방식
  spread: "auto" | "none"; // 1페이지/2페이지 ('auto'=2p if wide, 'none'=1p)
  wheelDirection: "down" | "up"; // 다음 페이지 이동 마우스 휠 방향
  keyboardDirection: "right" | "left"; // 다음 페이지 이동 키보드 방향
  clickDirection: "right" | "left"; // 다음 페이지 이동 클릭 영역 방향
}

interface EpubViewerState {
  // 현재 상태
  currentCFI: string | null; // 현재 위치 (EPUB CFI)
  currentPage: number; // 현재 페이지 (추정)
  totalPages: number; // 전체 페이지 (추정)
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isTOCOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  globalProgress: number; // 전체 도서 기준 진행률 (0~100)
  isAtFirstPage: boolean;
  isAtLastPage: boolean;

  // 설정
  settings: EpubViewerSettings;
  seriesSettings: Record<string, Partial<EpubViewerSettings>>; // 시리즈별 개별 설정 저장
  currentSeriesId: string | null;

  // 액션
  setCurrentSeriesId: (id: string | null) => void;
  updateSeriesSetting: (seriesId: string, newSettings: Partial<EpubViewerSettings>) => void;
  setCurrentCFI: (cfi: string | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setGlobalProgress: (progress: number) => void;
  setIsAtFirstPage: (isAtFirst: boolean) => void;
  setIsAtLastPage: (isAtLast: boolean) => void;
  toggleUI: () => void;
  showUI: () => void;
  hideUI: () => void;
  toggleSettings: () => void;
  closeSettings: () => void;
  toggleTOC: () => void;
  closeTOC: () => void;
  toggleFullscreen: () => void;
  setFullscreen: (value: boolean) => void;
  setIncognito: (value: boolean) => void;
  reset: () => void;

  // 설정 변경
  setFontSize: (size: number) => void;
  setFontFamily: (family: EpubFontFamily) => void;
  setLineHeight: (height: number) => void;
  setTheme: (theme: EpubTheme) => void;
  setRenderMode: (mode: EpubRenderMode) => void;
  setFlow: (flow: EpubFlow) => void;
  setSpread: (spread: "auto" | "none") => void;
  setWheelDirection: (direction: "down" | "up") => void;
  setKeyboardDirection: (direction: "right" | "left") => void;
  setClickDirection: (direction: "right" | "left") => void;
}

const defaultSettings: EpubViewerSettings = Object.freeze({
  fontSize: EPUB_FONT_SIZE_DEFAULT,
  fontFamily: "original",
  lineHeight: EPUB_LINE_HEIGHT_SCALE_DEFAULT,
  theme: "light",
  renderMode: "auto",
  flow: "paginated",
  spread: "auto",
  wheelDirection: "down",
  keyboardDirection: "right",
  clickDirection: "right",
});
const MAX_SERIES_SETTINGS = 50;

// Write-LRU: 저장/갱신 시점만 추적하여 evict 순서를 결정한다.
const enforceSeriesSettingsLimit = (
  settings: Record<string, Partial<EpubViewerSettings>>,
): Record<string, Partial<EpubViewerSettings>> => {
  const keys = Object.keys(settings);
  if (keys.length <= MAX_SERIES_SETTINGS) {
    return settings;
  }
  const rest = { ...settings };
  delete rest[keys[0]];
  return rest;
};

const buildSettingUpdate = <K extends keyof EpubViewerSettings>(
  state: EpubViewerState,
  key: K,
  value: EpubViewerSettings[K],
): Partial<EpubViewerState> => {
  const updates: Partial<EpubViewerState> = {
    settings: { ...state.settings, [key]: value },
  };
  if (state.currentSeriesId) {
    const nextSettings = { ...state.seriesSettings };
    const existing = nextSettings[state.currentSeriesId] || {};
    // delete and re-insert to move key to the end of insertion order (LRU)
    delete nextSettings[state.currentSeriesId];
    nextSettings[state.currentSeriesId] = {
      ...existing,
      [key]: value,
    };
    updates.seriesSettings = enforceSeriesSettingsLimit(nextSettings);
  }
  return updates;
};

export const useEpubViewerStore = create<EpubViewerState>()(
  devtools(
    (set) => ({
      currentCFI: null,
      currentPage: 1,
      totalPages: 0,
      isUIVisible: true,
      isSettingsOpen: false,
      isTOCOpen: false,
      isFullscreen: false,
      isIncognito: false,
      globalProgress: 0,
      isAtFirstPage: false,
      isAtLastPage: false,
      settings: defaultSettings,
      seriesSettings: {},
      currentSeriesId: null,

      setCurrentSeriesId: (id) => set({ currentSeriesId: id }),
      updateSeriesSetting: (seriesId, newSettings) =>
        set((state) => {
          const nextSettings = { ...state.seriesSettings };
          const existing = nextSettings[seriesId] || {};
          // delete and re-insert to move key to the end of insertion order (LRU)
          delete nextSettings[seriesId];
          nextSettings[seriesId] = {
            ...existing,
            ...newSettings,
          };
          return { seriesSettings: enforceSeriesSettingsLimit(nextSettings) };
        }),

      setCurrentCFI: (cfi) => set({ currentCFI: cfi }),
      setCurrentPage: (page) => set({ currentPage: page }),
      setTotalPages: (total) => set({ totalPages: total }),
      setGlobalProgress: (progress) => set({ globalProgress: progress }),
      setIsAtFirstPage: (isAtFirst) => set({ isAtFirstPage: isAtFirst }),
      setIsAtLastPage: (isAtLast) => set({ isAtLastPage: isAtLast }),

      toggleUI: () => set((state) => ({ isUIVisible: !state.isUIVisible })),
      showUI: () => set({ isUIVisible: true }),
      hideUI: () => set({ isUIVisible: false }),
      toggleSettings: () =>
        set((state) => {
          const nextSettingsOpen = !state.isSettingsOpen;
          return {
            isSettingsOpen: nextSettingsOpen,
            isTOCOpen: nextSettingsOpen ? false : state.isTOCOpen,
          };
        }),
      closeSettings: () => set({ isSettingsOpen: false }),
      toggleTOC: () => set((state) => ({ isTOCOpen: !state.isTOCOpen, isSettingsOpen: false })),
      closeTOC: () => set({ isTOCOpen: false }),

      toggleFullscreen: () => {
        try {
          if (!isFullscreen()) {
            enterFullscreen().catch((err) => console.error("[EpubViewerStore] Failed to enter fullscreen:", err));
          } else {
            exitFullscreen().catch((err) => console.error("[EpubViewerStore] Failed to exit fullscreen:", err));
          }
        } catch (err) {
          console.error("Fullscreen toggle error:", err);
        }
      },

      setFullscreen: (value) => set({ isFullscreen: value }),
      setIncognito: (value) => set({ isIncognito: value }),

      reset: () =>
        set({
          currentCFI: null,
          currentPage: 1,
          totalPages: 0,
          isUIVisible: true,
          isSettingsOpen: false,
          isTOCOpen: false,
          isFullscreen: false,
          isIncognito: false,
          globalProgress: 0,
          isAtFirstPage: false,
          isAtLastPage: false,
          settings: defaultSettings,
          currentSeriesId: null,
        }),

      setFontSize: (size) =>
        set((state) => buildSettingUpdate(state, "fontSize", size)),

      setFontFamily: (family) =>
        set((state) => buildSettingUpdate(state, "fontFamily", family)),

      setLineHeight: (height) =>
        set((state) => buildSettingUpdate(state, "lineHeight", height)),

      setTheme: (theme) =>
        set((state) => buildSettingUpdate(state, "theme", theme)),

      setRenderMode: (mode) =>
        set((state) => buildSettingUpdate(state, "renderMode", mode)),

      setFlow: (flow) =>
        set((state) => buildSettingUpdate(state, "flow", flow)),

      setSpread: (spread) =>
        set((state) => buildSettingUpdate(state, "spread", spread)),

      setWheelDirection: (direction) =>
        set((state) => buildSettingUpdate(state, "wheelDirection", direction)),

      setKeyboardDirection: (direction) =>
        set((state) => buildSettingUpdate(state, "keyboardDirection", direction)),

      setClickDirection: (direction) =>
        set((state) => buildSettingUpdate(state, "clickDirection", direction)),
    }),
    {
      name: "kumiho-epub-viewer-settings",
      enabled: true,
    },
  ),
);
