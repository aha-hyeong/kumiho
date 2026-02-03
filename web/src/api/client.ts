import axios from "axios";
import type { Chapter, Series, Volume } from "../types/series";
import type { User } from "../types/user";

// Docker 및 배포 환경에서 유연하게 대처하기 위해 기본값을 상대 경로로 설정합니다.
const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // 쿠키 자동 전송 (httpOnly 쿠키 인증용)
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache, no-store, must-revalidate",
    Pragma: "no-cache",
    Expires: "0",
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
  },
);

// Auth API
export const authAPI = {
  register: (data: { username: string; nickname: string; password: string }) => api.post("/auth/register", data),
  login: (data: { username: string; password: string }) => api.post("/auth/login", data),
  logout: () => api.post("/auth/logout"),
  refresh: () => api.post("/auth/refresh"), // 쿠키에서 refresh_token 자동 전송
  me: () => api.get("/auth/me"),
  updateProfile: (data: { nickname: string }) => api.put("/auth/me", data),
  changePassword: (data: { old_password: string; new_password: string }) => api.put("/auth/me/password", data),
};

// Users API (Master only)
export const usersAPI = {
  getAll: () => api.get<{ users: User[] }>("/users"),
  create: (data: {
    username: string;
    nickname: string;
    password: string;
    role: string;
    can_download?: boolean;
    library_ids?: string[];
  }) => api.post("/users", data),
  delete: (id: string) => api.delete(`/users/${id}`),
  update: (id: string, data: Partial<User>) => api.put(`/users/${id}`, data),
  updateLibraries: (id: string, library_ids: string[]) => api.put(`/users/${id}/libraries`, { library_ids }),
};

// Library API
export const libraryAPI = {
  getAll: () => api.get("/libraries"),
  get: (id: string) => api.get(`/libraries/${id}`),
  create: (data: { name: string; path: string; default_view_mode?: string; default_read_direction?: string }) =>
    api.post("/libraries", data),
  update: (
    id: string,
    data: { name?: string; default_view_mode?: string; default_read_direction?: string; is_visible?: boolean },
  ) => api.put(`/libraries/${id}`, data),
  scan: (id: string) => api.post(`/libraries/${id}/scan`),
  cancelScan: (id: string) => api.post(`/libraries/${id}/scan/cancel`),
  delete: (id: string) => api.delete(`/libraries/${id}`),
  updateOrder: (ids: string[]) => api.put("/libraries/order", ids),
  getSeries: (libraryId: string) => api.get(`/libraries/${libraryId}/series`),
};

// Series API
export const seriesAPI = {
  get: (id: string) => api.get(`/series/${id}`),
  getVolumes: (seriesId: string) => api.get(`/series/${seriesId}/volumes`),
  getProgress: (seriesId: string) => api.get(`/series/${seriesId}/progress`),
  update: (seriesId: string, data: Partial<Series>) => api.patch(`/series/${seriesId}`, data),
  updateProgress: (
    seriesId: string,
    data: {
      status?: string;
      chapter_id?: string;
      volume_id?: string;
      current_page?: number;
      total_pages?: number;
      progress_percent?: number;
      page?: number;
    },
  ) => api.patch(`/series/${seriesId}/progress`, data),
  compareProgress: (seriesId: string, data: { target_series_id: string }) =>
    api.post(`/series/${seriesId}/progress/compare`, data),
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
  // 시리즈 완독/초기화
  markComplete: (seriesId: string) => api.post(`/series/${seriesId}/complete`),
  resetProgress: (seriesId: string) => api.delete(`/series/${seriesId}/progress`),
  // 시리즈 검색
  search: (query: string) => api.get<{ series: Series[] }>(`/series/search?q=${encodeURIComponent(query)}`),
  // 뷰어 설정
  getViewerSettings: (seriesId: string) => api.get(`/series/${seriesId}/viewer-settings`).then((res) => res.data),
  updateViewerSettings: (seriesId: string, data: Record<string, unknown>) =>
    api.patch(`/series/${seriesId}/viewer-settings`, data).then((res) => res.data),
};

// Volume API
export const volumeAPI = {
  get: (id: string) => api.get<Volume>(`/volumes/${id}`),
  update: (id: string, data: Partial<Volume>) => api.patch<Volume>(`/volumes/${id}`, data),
  uploadThumbnail: (id: string, file: File) => {
    const formData = new FormData();
    formData.append("thumbnail", file);
    return api.post<Volume>(`/volumes/${id}/thumbnail`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },
  uploadThumbnailFromUrl: (id: string, url: string) => api.post<Volume>(`/volumes/${id}/thumbnail/url`, { url }),
  deleteThumbnail: (id: string) => api.delete<Volume>(`/volumes/${id}/thumbnail`),
  getChapters: (volumeId: string) => api.get<{ chapters: Chapter[] }>(`/volumes/${volumeId}/chapters`),
  getProgress: (volumeId: string) => api.get(`/volumes/${volumeId}/progress`),
  // 볼륨 완료 관련
  markComplete: (volumeId: string) => api.post(`/volumes/${volumeId}/complete`),
  getCompletion: (volumeId: string) => api.get(`/volumes/${volumeId}/completion`),
  deleteCompletion: (volumeId: string) => api.delete(`/volumes/${volumeId}/completion`),
  getBGM: (volumeId: string) => api.get<{ exists: boolean; url?: string }>(`/volumes/${volumeId}/bgm`),
};

// Chapter API
export const chapterAPI = {
  get: (id: string) => api.get(`/chapters/${id}`),
  getPages: (chapterId: string) => api.get(`/chapters/${chapterId}/pages`),
  getProgress: (chapterId: string) => api.get(`/chapters/${chapterId}/progress`),
  analyze: (chapterId: string) =>
    api.post<{ analyzed_count: number; total_pages: number; success: boolean }>(`/chapters/${chapterId}/analyze`),
};

// Reading Progress API
export const progressAPI = {
  getAll: () => api.get("/reading-progress"),
  getRecent: (limit = 10) => api.get(`/reading-progress/recent?limit=${limit}`),
  sync: (items: unknown[]) => api.post("/reading-progress/sync", { items }),
};

// Settings API
export const settingAPI = {
  list: () => api.get<Record<string, string>>("/settings").then((res) => res.data),
  update: (key: string, data: { value: string }) => api.put(`/settings/${key}`, data).then((res) => res.data),
};

// Download API
export const downloadAPI = {
  getSeriesUrl: (id: string) => `${API_BASE_URL}/download/series/${id}`,
  getVolumeUrl: (id: string) => `${API_BASE_URL}/download/volumes/${id}`,
};

// System API
export const systemAPI = {
  getVersion: (force = false) => api.get(`/system/version?force=${force}`).then((res) => res.data),
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
