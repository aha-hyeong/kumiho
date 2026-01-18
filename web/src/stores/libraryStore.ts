import { create } from "zustand";
import { libraryAPI } from "../api/client";

export interface Library {
  id: string;
  name: string;
  path: string;
  default_view_mode: string;
  default_read_direction: string;
  sort_order: number;
}

interface LibraryState {
  libraries: Library[];
  isLoading: boolean;
  fetchLibraries: () => Promise<void>;
  setLibraries: (libraries: Library[]) => void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  libraries: [],
  isLoading: false,
  fetchLibraries: async () => {
    set({ isLoading: true });
    try {
      const response = await libraryAPI.getAll();
      set({ libraries: response.data.libraries || [], isLoading: false });
    } catch (error) {
      console.error("Failed to fetch libraries:", error);
      set({ isLoading: false });
    }
  },
  setLibraries: (libraries) => set({ libraries }),
}));
