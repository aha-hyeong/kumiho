import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { enterFullscreen, exitFullscreen, isFullscreen } from "../utils/fullscreen";
import type { Chapter, Page, ViewerSwipeSettings } from "../types/series";
import { assertViewerSwipeSettings, ViewerSwipeContractError } from "../utils/viewerSwipeSettings";

// 보기 모드
export type ReadingMode = "single" | "double" | "vertical";

// 읽기 방향
export type ReadingDirection = "ltr" | "rtl";

// 이미지 맞춤 모드
export type FitMode = "screen" | "width" | "height" | "original";

// 페이지 전환 애니메이션 타입
export type PageTransitionType = "slide" | "fade" | "none";
export type ViewerFontFamily = "original" | "serif" | "sans-serif";

// 스프레드 분할 서브페이지
export type SubPage = "left" | "right" | null;

// 뷰어 설정
export interface ViewerSettings {
  readingMode: ReadingMode;
  readingDirection: ReadingDirection;
  clickDirection: ReadingDirection;
  keyboardDirection: ReadingDirection;
  wheelDirection: "down" | "up";
  fitMode: FitMode;
  preloadCount: number;
  pullThreshold: number; // 당기기 감도
  pullSensitivity: number; // 당기기 민감도
  showThreshold: number; // 당길 때 UI 표시 임계값
  backgroundColor: string; // 배경색
  pageOffset: number; // 페이지 오프셋 (0 또는 1)
  swipeDirection: ReadingDirection; // 스와이프 방향 (모바일/터치용)
  pageTransition: PageTransitionType; // 페이지 전환 애니메이션
  showPdfZoomControls: boolean; // PDF 상단 확대 버튼 표시 여부
  fontSize: number; // 글자 크기 % (50~150)
  fontFamily: ViewerFontFamily; // 글꼴
  lineHeight: number; // 줄 간격 (1.2~2.0)
}

// 뷰어 상태
export interface SwipeLoadToken {
  sessionEpoch: number;
  requestId: number;
  userDefaultRevision: number;
  seriesMutationRevisions: Readonly<Record<string, number>>;
}

export interface SwipeMutationToken {
  sessionEpoch: number;
  mutationId: number;
  seriesId: string;
  seriesRevision: number;
  userDefaultRevision: number;
  previousOverride: ReadingDirection | null;
  override: ReadingDirection | null;
}

interface SwipeDefaultMutationToken {
  sessionEpoch: number;
  mutationId: number;
}

interface ViewerState {
  // 현재 상태
  currentPage: number;
  totalPages: number;
  isUIVisible: boolean;
  isSettingsOpen: boolean;
  isFullscreen: boolean;
  isIncognito: boolean;
  subPage: SubPage;

  // 설정
  settings: ViewerSettings;
  seriesSettings: Record<string, Partial<ViewerSettings>>; // 시리즈별 개별 설정 저장
  currentSeriesId: string | null;
  swipeUserDefault: ReadingDirection;
  swipeSessionEpoch: number;
  swipeLoadId: number;
  userDefaultRevision: number;
  seriesMutationRevisions: Record<string, number>;
  swipeDefaultMutationId: number;
  pendingSwipeDefaultMutation: SwipeDefaultMutationToken | null;
  beginSwipeDefaultMutation: () => SwipeDefaultMutationToken | null;
  isSwipeDefaultMutationCurrent: (token: SwipeDefaultMutationToken) => boolean;
  finishSwipeDefaultMutation: (token: SwipeDefaultMutationToken) => void;
  beginSwipeLoad: () => SwipeLoadToken;
  isSwipeLoadCurrent: (token: SwipeLoadToken) => boolean;
  initializeSwipeSettings: (seriesId: string, swipeSettings: ViewerSwipeSettings, token?: SwipeLoadToken) => void;
  swipeMutationId: number;
  pendingSwipeMutation: SwipeMutationToken | null;
  beginSwipeMutation: (seriesId: string, override: ReadingDirection | null) => SwipeMutationToken;
  isSwipeMutationCurrent: (token: SwipeMutationToken) => boolean;
  commitSwipeMutation: (token: SwipeMutationToken, swipeSettings?: ViewerSwipeSettings) => void;
  rollbackSwipeMutation: (token: SwipeMutationToken) => void;
  finishSwipeMutation: (token: SwipeMutationToken) => void;

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
  setSubPage: (subPage: SubPage) => void;
  setIncognito: (isIncognito: boolean) => void;
  reset: () => void;

  // 설정 변경
  setReadingMode: (mode: ReadingMode) => void;
  setReadingDirection: (direction: ReadingDirection) => void;
  setClickDirection: (direction: ReadingDirection) => void;
  setPageOffset: (offset: 0 | 1) => void;
  togglePageOffset: () => void;
  setFitMode: (mode: FitMode) => void;
  setKeyboardDirection: (direction: ReadingDirection) => void;
  setWheelDirection: (direction: "down" | "up") => void;
  setSwipeUserDefault: (direction: ReadingDirection) => void;
  setSwipeOverride: (seriesId: string, override: ReadingDirection | null) => void;
  isSwipeSaving: boolean;

  setBackgroundColor: (color: string) => void;
  setPreloadCount: (count: number) => void;
  setPullThreshold: (threshold: number) => void;
  setPullSensitivity: (sensitivity: number) => void;
  setShowThreshold: (threshold: number) => void;
  setPageTransition: (transition: PageTransitionType) => void;
  setShowPdfZoomControls: (show: boolean) => void;
  setFontSize: (size: number) => void;
  setFontFamily: (family: ViewerFontFamily) => void;
  setLineHeight: (lineHeight: number) => void;

  // 다음 챕터 데이터 캐시
  nextChapterData: {
    chapterId: string;
    chapter: Chapter;
    pages: Page[];
    seriesId?: string | null;
  } | null;
  setNextChapterData: (data: { chapterId: string; chapter: Chapter; pages: Page[]; seriesId?: string | null } | null) => void;
}

const defaultSettings: ViewerSettings = {
  readingMode: "vertical",
  readingDirection: "ltr",
  clickDirection: "ltr",
  keyboardDirection: "ltr",
  wheelDirection: "down",
  pageOffset: 0,
  fitMode: "screen",
  backgroundColor: "#000000",
  preloadCount: 6,
  pullThreshold: 80,
  pullSensitivity: 1.0,
  showThreshold: 10,
  swipeDirection: "ltr",
  pageTransition: "slide",
  showPdfZoomControls: true,
  fontSize: 100,
  fontFamily: "original",
  lineHeight: 1.6,
};

function swipeOverrideUpdate(state: ViewerState, seriesId: string, override: ReadingDirection | null, userDefault = state.swipeUserDefault): Partial<ViewerState> {
  const seriesOverride = { ...state.seriesSettings[seriesId] };
  if (override === null) delete seriesOverride.swipeDirection;
  else seriesOverride.swipeDirection = override;
  return {
    seriesSettings: { ...state.seriesSettings, [seriesId]: seriesOverride },
    seriesMutationRevisions: {
      ...state.seriesMutationRevisions,
      [seriesId]: (state.seriesMutationRevisions[seriesId] ?? 0) + 1,
    },
    ...(state.currentSeriesId === seriesId
      ? { settings: { ...state.settings, swipeDirection: override ?? userDefault } }
      : {}),
  };
}

export const useViewerStore = create<ViewerState>()(
  devtools(
    (set, get) => ({
      // 초기 상태
      currentPage: 1,
      totalPages: 0,
      isUIVisible: true,
      isSettingsOpen: false,
      isFullscreen: false,
      isIncognito: false,
      subPage: null,
      settings: defaultSettings,
      seriesSettings: {},
      currentSeriesId: null,
      swipeUserDefault: "ltr",
      swipeSessionEpoch: 0,
      swipeLoadId: 0,
      userDefaultRevision: 0,
      swipeDefaultMutationId: 0,
      pendingSwipeDefaultMutation: null,
      seriesMutationRevisions: {},
      swipeMutationId: 0,
      pendingSwipeMutation: null,
      isSwipeSaving: false,
      nextChapterData: null,

      beginSwipeLoad: () => {
        const state = get();
        const token: SwipeLoadToken = {
          sessionEpoch: state.swipeSessionEpoch,
          requestId: state.swipeLoadId + 1,
          userDefaultRevision: state.userDefaultRevision,
          seriesMutationRevisions: state.seriesMutationRevisions,
        };
        set({ swipeLoadId: token.requestId });
        return token;
      },
      isSwipeLoadCurrent: (token) =>
        get().swipeSessionEpoch === token.sessionEpoch && get().swipeLoadId === token.requestId,
      initializeSwipeSettings: (seriesId, swipeSettings, token) =>
        set((state) => {
          if (token && !get().isSwipeLoadCurrent(token)) return state;
          assertViewerSwipeSettings(swipeSettings);
          const userDefault = token && (token.userDefaultRevision !== state.userDefaultRevision || state.pendingSwipeDefaultMutation !== null)
            ? state.swipeUserDefault
            : swipeSettings.user_default;
          const override = token && (
            (token.seriesMutationRevisions[seriesId] ?? 0) !== (state.seriesMutationRevisions[seriesId] ?? 0) ||
            state.pendingSwipeMutation?.seriesId === seriesId
          )
            ? state.seriesSettings[seriesId]?.swipeDirection ?? null
            : swipeSettings.series_override;
          const seriesOverride = { ...state.seriesSettings[seriesId] };
          if (override === null) delete seriesOverride.swipeDirection;
          else seriesOverride.swipeDirection = override;
          return {
            currentSeriesId: seriesId,
            swipeUserDefault: userDefault,
            userDefaultRevision: state.userDefaultRevision + (userDefault !== state.swipeUserDefault ? 1 : 0),
            seriesSettings: { ...state.seriesSettings, [seriesId]: seriesOverride },
            settings: { ...state.settings, swipeDirection: override ?? userDefault },
          };
        }),

      beginSwipeDefaultMutation: () => {
        const state = get();
        if (state.pendingSwipeDefaultMutation !== null) return null;
        const token = { sessionEpoch: state.swipeSessionEpoch, mutationId: state.swipeDefaultMutationId + 1 };
        set({ swipeDefaultMutationId: token.mutationId, pendingSwipeDefaultMutation: token });
        return token;
      },
      isSwipeDefaultMutationCurrent: (token) =>
        get().swipeSessionEpoch === token.sessionEpoch && get().pendingSwipeDefaultMutation?.mutationId === token.mutationId,
      finishSwipeDefaultMutation: (token) =>
        set((state) => get().isSwipeDefaultMutationCurrent(token) ? { pendingSwipeDefaultMutation: null } : state),

      beginSwipeMutation: (seriesId, override) => {
        const state = get();
        const token: SwipeMutationToken = {
          sessionEpoch: state.swipeSessionEpoch,
          mutationId: state.swipeMutationId + 1,
          seriesId,
          seriesRevision: (state.seriesMutationRevisions[seriesId] ?? 0) + 1,
          userDefaultRevision: state.userDefaultRevision,
          previousOverride: state.seriesSettings[seriesId]?.swipeDirection ?? null,
          override,
        };
        set({
          ...swipeOverrideUpdate(state, seriesId, override),
          swipeMutationId: token.mutationId,
          pendingSwipeMutation: token,
          isSwipeSaving: true,
        });
        return token;
      },
      isSwipeMutationCurrent: (token) => {
        const state = get();
        return state.swipeSessionEpoch === token.sessionEpoch &&
          state.pendingSwipeMutation?.mutationId === token.mutationId &&
          state.seriesMutationRevisions[token.seriesId] === token.seriesRevision;
      },
      commitSwipeMutation: (token, swipeSettings) =>
        set((state) => {
          if (!get().isSwipeMutationCurrent(token)) return state;
          if (swipeSettings !== undefined) {
            assertViewerSwipeSettings(swipeSettings);
            if (token.override !== null || swipeSettings.series_override !== null) throw new ViewerSwipeContractError();
          } else if (token.override === null) {
            throw new ViewerSwipeContractError();
          }
          // Reset refreshes the default only in its original Viewer and only
          // when no newer default was committed while it was in flight.
          const userDefault = swipeSettings && state.currentSeriesId === token.seriesId &&
            state.userDefaultRevision === token.userDefaultRevision && state.pendingSwipeDefaultMutation === null
            ? swipeSettings.user_default
            : state.swipeUserDefault;
          return {
            ...swipeOverrideUpdate(state, token.seriesId, token.override, userDefault),
            swipeUserDefault: userDefault,
            userDefaultRevision: state.userDefaultRevision + (userDefault !== state.swipeUserDefault ? 1 : 0),
          };
        }),
      rollbackSwipeMutation: (token) =>
        set((state) => get().isSwipeMutationCurrent(token)
          ? swipeOverrideUpdate(state, token.seriesId, token.previousOverride)
          : state),
      finishSwipeMutation: (token) =>
        set((state) => state.swipeSessionEpoch === token.sessionEpoch && state.pendingSwipeMutation?.mutationId === token.mutationId
          ? { pendingSwipeMutation: null, isSwipeSaving: false }
          : state),

      // 기초 액션
      setCurrentSeriesId: (id) => set({ currentSeriesId: id }),
      setNextChapterData: (data) => set({ nextChapterData: data }),

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
          const seriesSettingsUpdate: Partial<ViewerSettings> = { readingMode: mode };

          // 1페이지/세로 모드에서 2페이지 모드로 전환 시,
          // 보던 페이지가 항상 좌측(시작점)에 오도록 pageOffset을 동적으로 조정합니다.
          if (mode === "double" && state.settings.readingMode !== "double") {
            const newPageOffset = state.currentPage % 2 === 0 ? 1 : 0;
            newSettings.pageOffset = newPageOffset;
            seriesSettingsUpdate.pageOffset = newPageOffset;
          }

          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                ...seriesSettingsUpdate,
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

      setWheelDirection: (direction) =>
        set((state) => {
          const newSettings = { ...state.settings, wheelDirection: direction };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                wheelDirection: direction,
              },
            };
          }
          return updates;
        }),

      setSwipeUserDefault: (direction) =>
        set((state) => ({
          swipeUserDefault: direction,
          userDefaultRevision: state.userDefaultRevision + 1,
          pendingSwipeDefaultMutation: null,
          settings: {
            ...state.settings,
            swipeDirection: (state.currentSeriesId && state.seriesSettings[state.currentSeriesId]?.swipeDirection) || direction,
          },
        })),
      setSwipeOverride: (seriesId, override) =>
        set((state) => swipeOverrideUpdate(state, seriesId, override)),

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

      setPageTransition: (transition) =>
        set((state) => {
          const newSettings = { ...state.settings, pageTransition: transition };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                pageTransition: transition,
              },
            };
          }
          return updates;
        }),

      setShowPdfZoomControls: (show) =>
        set((state) => ({
          settings: { ...state.settings, showPdfZoomControls: show },
        })),

      setFontSize: (size) =>
        set((state) => {
          const clampedSize = Math.max(50, Math.min(size, 150));
          const newSettings = { ...state.settings, fontSize: clampedSize };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                fontSize: clampedSize,
              },
            };
          }
          return updates;
        }),

      setFontFamily: (family) =>
        set((state) => {
          const newSettings = { ...state.settings, fontFamily: family };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                fontFamily: family,
              },
            };
          }
          return updates;
        }),

      setLineHeight: (lineHeight) =>
        set((state) => {
          const clampedLineHeight = Math.max(1.2, Math.min(lineHeight, 2.0));
          const newSettings = { ...state.settings, lineHeight: clampedLineHeight };
          const updates: Partial<ViewerState> = { settings: newSettings };

          if (state.currentSeriesId) {
            updates.seriesSettings = {
              ...state.seriesSettings,
              [state.currentSeriesId]: {
                ...(state.seriesSettings[state.currentSeriesId] || {}),
                lineHeight: clampedLineHeight,
              },
            };
          }
          return updates;
        }),

      initPage: (page, total) =>
        set({
          currentPage: page,
          totalPages: total,
        }),

      initializeSettings: (newSettings) =>
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        })),

      setSubPage: (subPage) => {
        if (get().subPage === subPage) return;
        set({ subPage });
      },
      setIncognito: (isIncognito) => set({ isIncognito }),

      reset: () =>
        set((state) => ({
          currentPage: 1,
          totalPages: 0,
          isUIVisible: true,
          isSettingsOpen: false,
          isFullscreen: false,
          isIncognito: false,
          subPage: null,
          settings: defaultSettings,
          seriesSettings: {},
          currentSeriesId: null,
          swipeUserDefault: "ltr",
          swipeSessionEpoch: state.swipeSessionEpoch + 1,
          swipeLoadId: 0,
          userDefaultRevision: 0,
          swipeDefaultMutationId: 0,
          pendingSwipeDefaultMutation: null,
          seriesMutationRevisions: {},
          swipeMutationId: 0,
          pendingSwipeMutation: null,
          isSwipeSaving: false,
          nextChapterData: null,
        })),
    }),
    {
      name: "kumiho-viewer-settings",
      enabled: true,
    },
  ),
);
