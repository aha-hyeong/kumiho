import { create } from "zustand";
import { persist } from "zustand/middleware";
import { authAPI } from "../api/client";
import type { User } from "../types/user";
import { useViewerStore } from "./viewerStore";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (username: string, password: string) => {
        const response = await authAPI.login({ username, password });
        const { access_token, refresh_token, user } = response.data;

        // localStorage에 저장 (모바일 앱 호환용)
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", refresh_token);

        useViewerStore.getState().reset();
        set({ user, isAuthenticated: true });
      },

      register: async (username: string, nickname: string, password: string) => {
        const response = await authAPI.register({ username, nickname, password });
        const { access_token, refresh_token, user } = response.data;

        // localStorage에 저장 (모바일 앱 호환용)
        localStorage.setItem("access_token", access_token);
        localStorage.setItem("refresh_token", refresh_token);

        set({ user, isAuthenticated: true });
      },

      logout: async () => {
        try {
          // 서버에 로그아웃 요청 (쿠키 삭제)
          await authAPI.logout();
        } catch (err) {
          // 로그아웃 API 실패해도 로컬 상태는 정리
          console.error("Logout API failed:", err);
        }
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");
        useViewerStore.getState().reset();
        set({ user: null, isAuthenticated: false });
      },

      checkAuth: async () => {
        try {
          // 쿠키 또는 localStorage 토큰으로 인증 확인
          const response = await authAPI.me();
          set({ user: response.data, isAuthenticated: true, isLoading: false });
        } catch {
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },
    }),
    {
      name: "auth-storage",
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    },
  ),
);
