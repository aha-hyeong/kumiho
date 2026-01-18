import { create } from "zustand";
import { persist } from "zustand/middleware";

// 보기 모드
export type ReadingMode = "single" | "double" | "vertical";

// 읽기 방향
export type ReadingDirection = "ltr" | "rtl";

// 이미지 맞춤 모드
export type FitMode = "screen" | "width" | "height" | "original";

// 뷰어 설정
interface ViewerSettings {
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  clickDirection: ReadingDirection; // 클릭 방향 (읽기 방향과 별도)
  pageOffset: 0 | 1;
  fitMode: FitMode;
  backgroundColor: string;
  preloadCount: number;
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

  // 액션
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
  initPage: (page: number, total: number) => void;

  // 설정 변경
  setReadingMode: (mode: ReadingMode) => void;
  setReadingDirection: (direction: ReadingDirection) => void;
  setClickDirection: (direction: ReadingDirection) => void;
  setPageOffset: (offset: 0 | 1) => void;
  togglePageOffset: () => void;
  setFitMode: (mode: FitMode) => void;
  setBackgroundColor: (color: string) => void;
}

const defaultSettings: ViewerSettings = {
  readingMode: "single",
  readingDirection: "ltr",
  clickDirection: "ltr",
  pageOffset: 0,
  fitMode: "screen",
  backgroundColor: "#000000",
  preloadCount: 3,
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
        const { isFullscreen } = get();
        if (!isFullscreen) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
        set({ isFullscreen: !isFullscreen });
      },

      // 설정 변경 액션
      setReadingMode: (mode) =>
        set((state) => ({
          settings: { ...state.settings, readingMode: mode },
        })),

      setReadingDirection: (direction) =>
        set((state) => ({
          settings: { ...state.settings, readingDirection: direction },
        })),

      setClickDirection: (direction) =>
        set((state) => ({
          settings: { ...state.settings, clickDirection: direction },
        })),

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
        set((state) => ({
          settings: { ...state.settings, fitMode: mode },
        })),

      setBackgroundColor: (color) =>
        set((state) => ({
          settings: { ...state.settings, backgroundColor: color },
        })),

      initPage: (page, total) =>
        set({
          currentPage: page,
          totalPages: total,
        }),
    }),
    {
      name: "kumiho-viewer-settings",
      partialize: (state) => ({ settings: state.settings }), // 설정만 저장
    },
  ),
);
