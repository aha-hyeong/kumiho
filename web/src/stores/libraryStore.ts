import { create } from "zustand";
import { libraryAPI } from "../api/client";
import { useAuthStore } from "./authStore";
import type { LibraryType } from "../types/series";

export interface Library {
  id: string;
  name: string;
  paths: string[];
  default_view_mode: string;
  default_read_direction: string;
  default_page_transition: string;
  default_epub_render_mode: string;
  default_epub_theme: string;
  default_epub_spread: string;
  default_epub_wheel_direction: string;
  default_epub_keyboard_direction: string;
  default_epub_click_direction: string;
  sort_order: number;
  scan_status: "IDLE" | "SCANNING" | "ERROR";
  last_scan_result: string;
  type?: "LOCAL" | "SYSTEM";
  is_visible?: boolean;
  library_type?: LibraryType;
  scan_excludes?: string;
}

interface LibraryState {
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
  refreshKey: number;
  fetchRequestId: number;
  fetchLibraries: (showLoading?: boolean) => Promise<void>;
  setLibraries: (libraries: Library[]) => void;
  triggerRefresh: () => void;
  clearError: () => void;
}

let pendingLibraries: Promise<void> | null = null;
let pendingRefreshKey = -1;
let pendingUser: object | null = null;

export const useLibraryStore = create<LibraryState>((set, get) => ({
  libraries: [],
  isLoading: false,
  error: null,
  refreshKey: 0,
  fetchRequestId: 0,
  fetchLibraries: (showLoading = true) => {
    const user = useAuthStore.getState().user;
    if (pendingLibraries && pendingRefreshKey === get().refreshKey && pendingUser === user) {
      if (showLoading) set({ isLoading: true });
      return pendingLibraries;
    }
    if (pendingUser !== user) set({ libraries: [] });
    pendingUser = user;
    pendingRefreshKey = get().refreshKey;
    const request = (async () => {
      let currentRequestId = 0;
      set((state) => {
        currentRequestId = state.fetchRequestId + 1;
        return {
          fetchRequestId: currentRequestId,
          isLoading: showLoading ? true : state.isLoading,
          error: null,
        };
      });

      try {
        const response = await libraryAPI.getAll();
        set((state) => {
          if (state.fetchRequestId === currentRequestId && useAuthStore.getState().user === user) {
            return { libraries: response.data.libraries || [], isLoading: false };
          }
          return {};
        });
      } catch (error: unknown) {
        console.error("Failed to fetch libraries:", error);
        const errorMessage = error instanceof Error ? error.message : "라이브러리 목록을 가져오는 데 실패했습니다.";
        set((state) => {
          if (state.fetchRequestId === currentRequestId && useAuthStore.getState().user === user) {
            return { isLoading: false, error: errorMessage };
          }
          return {};
        });
      }
    })();
    pendingLibraries = request;
    void request.finally(() => {
      if (pendingLibraries === request) pendingLibraries = null;
    });
    return request;
  },
  setLibraries: (libraries) => set({ libraries }),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
  clearError: () => set({ error: null }),
}));
