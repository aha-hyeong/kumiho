import axios from "axios";
import type { Series } from "../types/series";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:8080/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // 쿠키 자동 전송 (httpOnly 쿠키 인증용)
  headers: {
    "Content-Type": "application/json",
  },
});

// 요청 인터셉터: 토큰 추가 (localStorage 폴백 - 모바일 앱 호환용)
api.interceptors.request.use((config) => {
  // 쿠키가 없을 때 localStorage 폴백 (모바일 앱 등)
  const token = localStorage.getItem("access_token");
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 응답 인터셉터: 토큰 갱신
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // auth 관련 요청이면 인터셉터 처리 skip (무한 루프 방지)
    const isAuthRequest = originalRequest.url?.includes("/api/v1/auth/") || originalRequest.url?.startsWith("/auth/");
    if (isAuthRequest) {
      return Promise.reject(error);
    }

    // 401 에러이고 재시도하지 않은 요청인 경우
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        // 쿠키 기반 refresh 시도 (refresh_token 쿠키가 자동으로 전송됨)
        const response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });

        const { access_token, refresh_token } = response.data;

        // localStorage에도 저장 (모바일 앱 호환용)
        localStorage.setItem("access_token", access_token);
        if (refresh_token) {
          localStorage.setItem("refresh_token", refresh_token);
        }

        // 원래 요청에 새 토큰 추가 후 재시도
        originalRequest.headers.Authorization = `Bearer ${access_token}`;
        return api(originalRequest);
      } catch {
        // refresh 실패 시 로그아웃 처리
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");

        // 이미 로그인 페이지에 있으면 리다이렉트 안함
        if (!window.location.pathname.includes("/login")) {
          window.location.href = "/login";
        }
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  register: (data: { username: string; email: string; password: string }) => api.post("/auth/register", data),
  login: (data: { email: string; password: string }) => api.post("/auth/login", data),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post("/auth/refresh"), // 쿠키에서 refresh_token 자동 전송
  me: () => api.get("/auth/me"),
};

// Library API
export const libraryAPI = {
  getAll: () => api.get("/libraries"),
  get: (id: string) => api.get(`/libraries/${id}`),
  create: (data: { name: string; path: string }) => api.post("/libraries", data),
  scan: (id: string) => api.post(`/libraries/${id}/scan`),
  delete: (id: string) => api.delete(`/libraries/${id}`),
  getSeries: (libraryId: string) => api.get(`/libraries/${libraryId}/series`),
};

// Series API
export const seriesAPI = {
  get: (id: string) => api.get(`/series/${id}`),
  getVolumes: (seriesId: string) => api.get(`/series/${seriesId}/volumes`),
  getProgress: (seriesId: string) => api.get(`/series/${seriesId}/progress`),
  update: (seriesId: string, data: any) => api.patch(`/series/${seriesId}`, data),
  updateProgress: (seriesId: string, data: any) => api.patch(`/series/${seriesId}/progress`, data),
  compareProgress: (seriesId: string, data: any) => api.post(`/series/${seriesId}/progress/compare`, data),
  uploadThumbnail: (seriesId: string, file: File) => {
    const formData = new FormData();
    formData.append("thumbnail", file);
    return api.post<Series>(`/series/${seriesId}/thumbnail`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  uploadThumbnailFromUrl: (seriesId: string, url: string) =>
    api.post<Series>(`/series/${seriesId}/thumbnail/url`, { url }),
  deleteThumbnail: (seriesId: string) => api.delete<Series>(`/series/${seriesId}/thumbnail`),
};

// Volume API
export const volumeAPI = {
  get: (id: string) => api.get(`/volumes/${id}`),
  getChapters: (volumeId: string) => api.get(`/volumes/${volumeId}/chapters`),
  getProgress: (volumeId: string) => api.get(`/volumes/${volumeId}/progress`),
  // 볼륨 완료 관련
  markComplete: (volumeId: string) => api.post(`/volumes/${volumeId}/complete`),
  getCompletion: (volumeId: string) => api.get(`/volumes/${volumeId}/completion`),
  deleteCompletion: (volumeId: string) => api.delete(`/volumes/${volumeId}/completion`),
};

// Chapter API
export const chapterAPI = {
  get: (id: string) => api.get(`/chapters/${id}`),
  getPages: (chapterId: string) => api.get(`/chapters/${chapterId}/pages`),
  getProgress: (chapterId: string) => api.get(`/chapters/${chapterId}/progress`),
};

// Reading Progress API
export const progressAPI = {
  getAll: () => api.get("/reading-progress"),
  getRecent: (limit = 10) => api.get(`/reading-progress/recent?limit=${limit}`),
  sync: (items: any[]) => api.post("/reading-progress/sync", { items }),
};

// Image URL 생성
export const getImageUrl = (pageId: string, width?: number) => {
  let url = `${API_BASE_URL}/pages/${pageId}/image`;
  if (width) url += `?width=${width}`;
  // Note: 이미지 요청에는 Authorization 헤더가 필요하므로,
  // 실제 구현에서는 Blob으로 가져오거나 서버에서 토큰 쿼리 파라미터 지원 필요
  return url;
};

export const getPageImageUrl = (chapterId: string, pageNumber: number, width?: number) => {
  let url = `${API_BASE_URL}/chapters/${chapterId}/pages/${pageNumber}/image`;
  if (width) url += `?width=${width}`;
  return url;
};
