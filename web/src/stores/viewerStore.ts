import { create } from "zustand";
import { persist } from "zustand/middleware";

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
  clickDirection: ReadingDirection; // 클릭 방향 (읽기 방향과 별도)
  keyboardDirection: ReadingDirection; // 키보드 방향 (추가)
  pageOffset: 0 | 1;
  fitMode: FitMode;
  backgroundColor: string;
  preloadCount: number;
  pullThreshold: number;
  pullSensitivity: number;
  showThreshold: number;
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
  persist(
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
          const isActuallyFullscreen = !!(
            document.fullscreenElement ||
            (document as any).webkitFullscreenElement ||
            (document as any).mozFullScreenElement ||
            (document as any).msFullscreenElement
          );

          if (!isActuallyFullscreen) {
            const docEl = document.documentElement as any;
            if (docEl.requestFullscreen) docEl.requestFullscreen().catch(() => {});
            else if (docEl.webkitRequestFullscreen) docEl.webkitRequestFullscreen();
            else if (docEl.mozRequestFullScreen) docEl.mozRequestFullScreen();
            else if (docEl.msRequestFullscreen) docEl.msRequestFullscreen();
          } else {
            const doc = document as any;
            if (doc.exitFullscreen) doc.exitFullscreen().catch(() => {});
            else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
            else if (doc.mozCancelFullScreen) doc.mozCancelFullScreen();
            else if (doc.msExitFullscreen) doc.msExitFullscreen();
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
      partialize: () => ({
        // 로컬 스토리지 데이터 격리를 위해 설정을 비움 (서버 데이터 우선)
      }),
    },
  ),
);
