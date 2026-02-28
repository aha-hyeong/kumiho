import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { enterFullscreen, exitFullscreen, isFullscreen } from "../utils/fullscreen";

// EPUB 테마
export type EpubTheme = "light" | "dark" | "sepia";

// EPUB 레이아웃
export type EpubFlow = "paginated" | "scrolled";
export type EpubRenderMode = "auto" | "book" | "comic";

// EPUB 뷰어 설정 (이미지/PDF 뷰어와 완전히 분리)
export interface EpubViewerSettings {
  fontSize: number; // 폰트 크기 % (100 = 기본, 80~200)
  fontFamily: string; // "default" | "serif" | "sans-serif"
  lineHeight: number; // 줄 간격 (1.2 ~ 2.0)
  theme: EpubTheme; // 테마
  renderMode: EpubRenderMode; // EPUB 렌더 모드 ("auto" = 자동 감지)
  flow: EpubFlow; // 레이아웃 방식
  spread: "auto" | "none"; // 1페이지/2페이지 ('auto'=2p if wide, 'none'=1p)
  wheelDirection: "down" | "up"; // 다음 페이지 이동 마우스 휠 방향
  keyboardDirection: "right" | "left"; // 다음 페이지 이동 키보드 방향
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

  // 설정
  settings: EpubViewerSettings;

  // 액션
  setCurrentCFI: (cfi: string | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (total: number) => void;
  setGlobalProgress: (progress: number) => void;
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
  setFontFamily: (family: string) => void;
  setLineHeight: (height: number) => void;
  setTheme: (theme: EpubTheme) => void;
  setRenderMode: (mode: EpubRenderMode) => void;
  setFlow: (flow: EpubFlow) => void;
  setSpread: (spread: "auto" | "none") => void;
  setWheelDirection: (direction: "down" | "up") => void;
  setKeyboardDirection: (direction: "right" | "left") => void;
}

const defaultSettings: EpubViewerSettings = {
  fontSize: 100,
  fontFamily: "original",
  lineHeight: 1.6,
  theme: "light",
  renderMode: "auto",
  flow: "paginated",
  spread: "auto",
  wheelDirection: "down",
  keyboardDirection: "right",
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
      settings: defaultSettings,

      setCurrentCFI: (cfi) => set({ currentCFI: cfi }),
      setCurrentPage: (page) => set({ currentPage: page }),
      setTotalPages: (total) => set({ totalPages: total }),
      setGlobalProgress: (progress) => set({ globalProgress: progress }),

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
          settings: defaultSettings,
        }),

      setFontSize: (size) =>
        set((state) => ({
          settings: { ...state.settings, fontSize: size },
        })),

      setFontFamily: (family) =>
        set((state) => ({
          settings: { ...state.settings, fontFamily: family },
        })),

      setLineHeight: (height) =>
        set((state) => ({
          settings: { ...state.settings, lineHeight: height },
        })),

      setTheme: (theme) =>
        set((state) => ({
          settings: { ...state.settings, theme },
        })),

      setRenderMode: (mode) =>
        set((state) => ({
          settings: { ...state.settings, renderMode: mode },
        })),

      setFlow: (flow) =>
        set((state) => ({
          settings: { ...state.settings, flow },
        })),

      setSpread: (spread) =>
        set((state) => ({
          settings: { ...state.settings, spread },
        })),

      setWheelDirection: (direction) =>
        set((state) => ({
          settings: { ...state.settings, wheelDirection: direction },
        })),

      setKeyboardDirection: (direction) =>
        set((state) => ({
          settings: { ...state.settings, keyboardDirection: direction },
        })),
    }),
    {
      name: "kumiho-epub-viewer-settings",
      enabled: true,
    },
  ),
);
