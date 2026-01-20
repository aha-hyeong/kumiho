import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { enterFullscreen, exitFullscreen, isFullscreen } from "../utils/fullscreen";

// 보기 모드
export type ReadingMode = "single" | "double" | "vertical";

// 읽기 방향
export type ReadingDirection = "ltr" | "rtl";

// 이미지 맞춤 모드
export type FitMode = "screen" | "width" | "height" | "original";

// 뷰어 설정
export interface ViewerSettings {
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  clickDirection: ReadingDirection;
  keyboardDirection: ReadingDirection;
  fitMode: FitMode;
  preloadCount: number;
  pullThreshold: number; // 당기기 감도
  pullSensitivity: number; // 당기기 민감도
  showThreshold: number; // 당길 때 UI 표시 임계값
  backgroundColor: string; // 배경색
  pageOffset: number; // 페이지 오프셋 (0 또는 1)
}

// 뷰어 상태
interface ViewerState {
  // 현재 상태
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isFullscreen: boolean;

  // 설정
  settings: ViewerSettings;
  seriesSettings: Record<string, Partial<ViewerSettings>>; // 시리즈별 개별 설정 저장
  currentSeriesId: string | null;

  // 액션
  setCurrentSeriesId: (id: string | null) => void;
  updateSeriesSetting: (seriesId: string, settings: Partial<ViewerSettings>) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  toggleUI: () => void;
  showUI: () => void;
  hideUI: () => void;
  toggleSettings: () => void;
  closeSettings: () => void;
  toggleFullscreen: () => void;
  setFullscreen: (isFullscreen: boolean) => void;
  initPage: (page: number, total: number) => void;
  initializeSettings: (settings: Partial<ViewerSettings>) => void;
  reset: () => void;

  // 설정 변경
  setReadingMode: (mode: ReadingMode) => void;
  setReadingDirection: (direction: ReadingDirection) => void;
  setClickDirection: (direction: ReadingDirection) => void;
  setPageOffset: (offset: 0 | 1) => void;
  togglePageOffset: () => void;
  setFitMode: (mode: FitMode) => void;
  setKeyboardDirection: (direction: ReadingDirection) => void;
  setBackgroundColor: (color: string) => void;
  setPreloadCount: (count: number) => void;
  setPullThreshold: (threshold: number) => void;
  setPullSensitivity: (sensitivity: number) => void;
  setShowThreshold: (threshold: number) => void;
}

const defaultSettings: ViewerSettings = {
  readingMode: "single",
  readingDirection: "ltr",
  clickDirection: "ltr",
  keyboardDirection: "ltr",
  pageOffset: 0,
  fitMode: "screen",
  backgroundColor: "#000000",
  preloadCount: 6,
  pullThreshold: 120,
  pullSensitivity: 0.5,
  showThreshold: 10,
};

export const useViewerStore = create<ViewerState>()(
  devtools(
    (set, get) => ({
      // 초기 상태
      currentPage: 1,
      totalPages: 0,
      isUIVisible: true,
      isSettingsOpen: false,
      isFullscreen: false,
      settings: defaultSettings,
      seriesSettings: {},
      currentSeriesId: null,

      // 기초 액션
      setCurrentSeriesId: (id) => set({ currentSeriesId: id }),

      updateSeriesSetting: (seriesId, newSettings) =>
        set((state) => ({
          seriesSettings: {
            ...state.seriesSettings,
            [seriesId]: {
              ...(state.seriesSettings[seriesId] || {}),
              ...newSettings,
            },
          },
        })),

      // 페이지 관련 액션
      setCurrentPage: (page) => set({ currentPage: page }),
      setTotalPages: (total) => set({ totalPages: total }),

      nextPage: () => {
        const { currentPage, totalPages, settings } = get();
        const step = settings.readingMode === "double" ? 2 : 1;
        const newPage = Math.min(currentPage + step, totalPages);
        set({ currentPage: newPage });
      },

      prevPage: () => {
        const { currentPage, settings } = get();
        const step = settings.readingMode === "double" ? 2 : 1;
        const newPage = Math.max(currentPage - step, 1);
        set({ currentPage: newPage });
      },

      goToPage: (page) => {
        const { totalPages } = get();
        const clampedPage = Math.max(1, Math.min(page, totalPages));
        set({ currentPage: clampedPage });
      },

      // UI 관련 액션
      toggleUI: () => set((state) => ({ isUIVisible: !state.isUIVisible })),
      showUI: () => set({ isUIVisible: true }),
      hideUI: () => set({ isUIVisible: false }),
      toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
      closeSettings: () => set({ isSettingsOpen: false }),

      toggleFullscreen: () => {
        try {
          if (!isFullscreen()) {
            enterFullscreen().catch(() => {});
          } else {
            exitFullscreen().catch(() => {});
          }
        } catch (err) {
          console.error("Fullscreen toggle error:", err);
        }
      },

      setFullscreen: (isFullscreen) => set({ isFullscreen }),

      // 설정 변경 액션 (현재 상태 + 시리즈별 설정 동시 업데이트)
      setReadingMode: (mode) =>
        set((state) => {
          const newSettings = { ...state.settings, readingMode: mode };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                readingMode: mode,
              },
            };
          }
          return updates;
        }),

      setReadingDirection: (direction) =>
        set((state) => {
          const newSettings = { ...state.settings, readingDirection: direction };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                readingDirection: direction,
              },
            };
          }
          return updates;
        }),

      setClickDirection: (direction) =>
        set((state) => {
          const newSettings = { ...state.settings, clickDirection: direction };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                clickDirection: direction,
              },
            };
          }
          return updates;
        }),

      setPageOffset: (offset) =>
        set((state) => ({
          settings: { ...state.settings, pageOffset: offset },
        })),

      togglePageOffset: () =>
        set((state) => ({
          settings: {
            ...state.settings,
            pageOffset: state.settings.pageOffset === 0 ? 1 : 0,
          },
        })),

      setFitMode: (mode) =>
        set((state) => {
          const newSettings = { ...state.settings, fitMode: mode };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                fitMode: mode,
              },
            };
          }
          return updates;
        }),

      setKeyboardDirection: (direction) =>
        set((state) => {
          const newSettings = { ...state.settings, keyboardDirection: direction };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                keyboardDirection: direction,
              },
            };
          }
          return updates;
        }),

      setBackgroundColor: (color) =>
        set((state) => {
          const newSettings = { ...state.settings, backgroundColor: color };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                backgroundColor: color,
              },
            };
          }
          return updates;
        }),

      setPreloadCount: (count) =>
        set((state) => ({
          settings: { ...state.settings, preloadCount: count },
        })),

      setPullThreshold: (threshold) =>
        set((state) => ({
          settings: { ...state.settings, pullThreshold: threshold },
        })),

      setPullSensitivity: (sensitivity) =>
        set((state) => ({
          settings: { ...state.settings, pullSensitivity: sensitivity },
        })),

      setShowThreshold: (threshold) =>
        set((state) => ({
          settings: { ...state.settings, showThreshold: threshold },
        })),

      initPage: (page, total) =>
        set({
          currentPage: page,
          totalPages: total,
        }),

      initializeSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      reset: () =>
        set({
          currentPage: 1,
          totalPages: 0,
          isUIVisible: true,
          isSettingsOpen: false,
          isFullscreen: false,
          settings: defaultSettings,
          seriesSettings: {},
          currentSeriesId: null,
        }),
    }),
    {
      name: "kumiho-viewer-settings",
      enabled: true,
    },
  ),
);
