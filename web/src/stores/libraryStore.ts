import { create } from "zustand";
import { libraryAPI } from "../api/client";

export interface Library {
  id: string;
  name: string;
  path: string;
  default_view_mode: string;
  default_read_direction: string;
  default_page_transition: string;
  sort_order: number;
  scan_status: "IDLE" | "SCANNING" | "ERROR";
  last_scan_result: string;
  type?: "LOCAL" | "SYSTEM";
  is_visible?: boolean;
  scan_excludes?: string;
}

interface LibraryState {
  libraries: Library[];
  isLoading: boolean;
  error: string | null;
  refreshKey: number;
  fetchLibraries: () => Promise<void>;
  setLibraries: (libraries: Library[]) => void;
  triggerRefresh: () => void;
  clearError: () => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  libraries: [],
  isLoading: false,
  error: null,
  refreshKey: 0,
  fetchLibraries: async () => {
    set({ isLoading: true, error: null });
    try {
      const response = await libraryAPI.getAll();
      set({ libraries: response.data.libraries || [], isLoading: false });
    } catch (error: unknown) {
      console.error("Failed to fetch libraries:", error);
      const errorMessage = error instanceof Error ? error.message : "라이브러리 목록을 가져오는 데 실패했습니다.";
      set({
        isLoading: false,
        error: errorMessage,
      });
    }
  },
  setLibraries: (libraries) => set({ libraries }),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),
  clearError: () => set({ error: null }),
}));
