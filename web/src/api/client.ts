import axios from "axios";
import type {
  Chapter,
  Series,
  UpdateSeriesRequest,
  Volume,
  Library,
  ReadingProgress,
  Page,
  UserSeriesSetting,
  LibraryType,
  SeriesCharacter,
} from "../types/series";
import type { User } from "../types/user";
import type { Session } from "../types/session";
import type {
  MetadataApplyResponse,
  MetadataCharacter,
  MetadataFetchResponse,
  MetadataResult,
  MetadataSearchRequest,
  MetadataSearchResult,
  SeriesCharacterImportResponse,
  PluginAuthActionResponse,
  PluginAuthDeleteResponse,
  PluginCatalogResponse,
  PluginConfigStatus,
  PluginConfigUpdateResponse,
  PluginInstallResponse,
  PluginRecord,
  PluginUninstallResponse,
  PluginUpdateSummary,
} from "../types/plugin";

// Docker 및 배포 환경에서 유연하게 대처하기 위해 기본값을 상대 경로로 설정합니다.
const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

export async function refreshAccessTokenForNonAxiosFlow(): Promise<{ accessToken: string; refreshToken?: string }> {
  let response;
  try {
    // 1차: 쿠키 기반 refresh 시도
    response = await axios.post(`${API_BASE_URL}/auth/refresh`, {}, { withCredentials: true });
  } catch (cookieError) {
    // 2차: 쿠키 실패 시 localStorage의 refresh_token 폴백
    const storedRefreshToken = localStorage.getItem("refresh_token");
    if (!storedRefreshToken) throw cookieError;
    response = await axios.post(
      `${API_BASE_URL}/auth/refresh`,
      { refresh_token: storedRefreshToken },
      { withCredentials: true },
    );
  }

  const { access_token, refresh_token } = response.data ?? {};
  if (!access_token || typeof access_token !== "string") {
    throw new Error("missing access_token in refresh response");
  }

  localStorage.setItem("access_token", access_token);
  if (refresh_token && typeof refresh_token === "string") {
    localStorage.setItem("refresh_token", refresh_token);
  }

  return { accessToken: access_token, refreshToken: refresh_token };
}

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

    // 인증 흐름 자체의 요청은 인터셉터 처리 skip (무한 루프 방지)
    // /auth/me, /auth/sessions 등은 skip하지 않아 Access Token 만료 후 자동 갱신 가능
    const skipRefreshPaths = ["/auth/login", "/auth/register", "/auth/refresh", "/auth/logout", "/auth/setup"];
    const shouldSkipRefresh = skipRefreshPaths.some((path) => originalRequest.url?.endsWith(path));
    if (shouldSkipRefresh) {
      return Promise.reject(error);
    }

    // 401 에러이고 재시도하지 않은 요청인 경우
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        const { accessToken } = await refreshAccessTokenForNonAxiosFlow();

        // 원래 요청에 새 토큰 추가 후 재시도
        originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        return api(originalRequest);
      } catch {
        // refresh 실패 시 로그아웃 처리
        localStorage.removeItem("access_token");
        localStorage.removeItem("refresh_token");

        // 로그인/초기설정 페이지에서는 강제 리다이렉트 반복 방지
        if (!window.location.pathname.includes("/login") && !window.location.pathname.includes("/setup")) {
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
  create: (data: {
    name: string;
    paths: string[];
    default_view_mode?: string;
    default_read_direction?: string;
    default_page_transition?: string;
    default_epub_render_mode?: string;
    default_epub_theme?: string;
    default_epub_spread?: string;
    default_epub_wheel_direction?: string;
    default_epub_keyboard_direction?: string;
    default_epub_click_direction?: string;
    library_type?: LibraryType;
    original_title_override?: boolean;
  }) => api.post("/libraries", data),
  update: (
    id: string,
    data: {
      name?: string;
      paths?: string[];
      default_view_mode?: string;
      default_read_direction?: string;
      default_page_transition?: string;
      default_epub_render_mode?: string;
      default_epub_theme?: string;
      default_epub_spread?: string;
      default_epub_wheel_direction?: string;
      default_epub_keyboard_direction?: string;
      default_epub_click_direction?: string;
      library_type?: LibraryType;
      is_visible?: boolean;
      original_title_override?: boolean;
    },
  ) => api.put(`/libraries/${id}`, data),
  scan: (id: string) => api.post(`/libraries/${id}/scan`),
  scanAll: () => api.post("/libraries/scan"),
  cancelScan: (id: string) => api.post(`/libraries/${id}/scan/cancel`),
  resetMetadata: (id: string) =>
    api
      .post<{
        library_id: string;
        library_name: string;
        reset_count: number;
        reset_at: string;
      }>(`/libraries/${id}/metadata/reset`)
      .then((res) => res.data),
  delete: (id: string) => api.delete(`/libraries/${id}`),
  updateOrder: (ids: string[]) => api.put("/libraries/order", ids),
  getSeries: (libraryId: string) => api.get(`/libraries/${libraryId}/series`),
};

// Series API
export const seriesAPI = {
  getHome: (section: "updated" | "liked") => api.get<{ updated_series: Series[]; liked_series: Series[] }>("/series/home", { params: { section } }),
  get: (id: string) => api.get(`/series/${id}`),
  getVolumes: (seriesId: string) => api.get(`/series/${seriesId}/volumes`),
  getChapters: (seriesId: string) => api.get<{ chapters: Chapter[] }>(`/series/${seriesId}/chapters`),
  getProgress: (seriesId: string) => api.get(`/series/${seriesId}/progress`),
  getProgressList: (seriesId: string) =>
    api.get<{ progress_list: ReadingProgress[] }>(`/series/${seriesId}/progress-list`),
  update: (seriesId: string, data: UpdateSeriesRequest) => api.patch(`/series/${seriesId}`, data),
  resetMetadata: (seriesId: string) =>
    api.post<{ series: Series; warnings?: string[] }>(`/series/${seriesId}/reset-metadata`).then((res) => res.data),
  translateDescription: (seriesId: string, targetLang?: string) =>
    api
      .post<{
        series: Series;
        target_lang: string;
        translated_text: string;
      }>(`/series/${seriesId}/translate-description`, targetLang ? { target_lang: targetLang } : {})
      .then((res) => res.data),
  updateProgress: (
    seriesId: string,
    data: {
      status?: string;
      chapter_id?: string;
      volume_id?: string;
      current_page?: number;
      anchor_page?: number;
      offset_ratio?: number;
      total_pages?: number;
      current_position?: number;
      total_positions?: number;
      current_time?: number;
      duration?: number;
      progress_percent?: number;
      page?: number;
      current_cfi?: string;
    },
  ) => api.patch(`/series/${seriesId}/progress`, data),
  compareProgress: (
    seriesId: string,
    data: {
      volume_number: number;
      chapter_number: number;
      current_page: number;
      anchor_page?: number;
      offset_ratio?: number;
    },
  ) => api.post(`/series/${seriesId}/progress/compare`, data),
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
  markPreviousComplete: (seriesId: string, volumeId: string) =>
    api.post(`/series/${seriesId}/volumes/${volumeId}/complete-previous`),
  resetProgress: (seriesId: string) => api.delete(`/series/${seriesId}/progress`),
  // 시리즈 검색
  search: (query: string) => api.get<{ series: Series[] }>(`/series/search?q=${encodeURIComponent(query)}`),
  // 확장자 배치 조회
  getExtensionsBatch: (seriesIds: string[]) =>
    api.post<{ extensions: Record<string, string> }>("/series/extensions/batch", { series_ids: seriesIds }),
  // 뷰어 설정
  getViewerSettings: (seriesId: string) =>
    api.get<Partial<UserSeriesSetting>>(`/series/${seriesId}/viewer-settings`).then((res) => res.data),
  updateViewerSettings: (seriesId: string, data: Partial<UserSeriesSetting>) =>
    api.patch(`/series/${seriesId}/viewer-settings`, data).then((res) => res.data),
  metadataSearch: (seriesId: string, data?: MetadataSearchRequest) =>
    api.post<MetadataSearchResult>(`/series/${seriesId}/metadata/search`, data ?? {}).then((res) => res.data),
  metadataFetch: (seriesId: string, data: { plugin_id: string; source: { id: string; name: string; url?: string } }) =>
    api.post<MetadataFetchResponse>(`/series/${seriesId}/metadata/fetch`, data).then((res) => res.data),
  metadataApply: (seriesId: string, result: MetadataResult) =>
    api.post<MetadataApplyResponse>(`/series/${seriesId}/metadata/apply`, { result }).then((res) => res.data),
  getCharacters: (seriesId: string) =>
    api.get<{ characters: SeriesCharacter[] }>(`/series/${seriesId}/characters`).then((res) => res.data),
  createCharacter: (seriesId: string, data: { name: string; role?: string; image_url?: string }) =>
    api.post<SeriesCharacter>(`/series/${seriesId}/characters`, data).then((res) => res.data),
  updateCharacter: (
    seriesId: string,
    characterId: string,
    data: { name?: string; role?: string; image_url?: string },
  ) => api.patch<SeriesCharacter>(`/series/${seriesId}/characters/${characterId}`, data).then((res) => res.data),
  deleteCharacter: (seriesId: string, characterId: string) =>
    api
      .delete<{ deleted: boolean; id: string }>(`/series/${seriesId}/characters/${characterId}`)
      .then((res) => res.data),
  reorderCharacters: (seriesId: string, orderedIds: string[]) =>
    api
      .post<{ characters: SeriesCharacter[] }>(`/series/${seriesId}/characters/reorder`, { ordered_ids: orderedIds })
      .then((res) => res.data),
  importCharacters: (seriesId: string, characters: MetadataCharacter[], sourceProvider?: string) =>
    api
      .post<SeriesCharacterImportResponse>(`/series/${seriesId}/characters/import`, {
        characters,
        source_provider: sourceProvider,
      })
      .then((res) => res.data),
  uploadCharacterImage: (seriesId: string, characterId: string, file: File) => {
    const formData = new FormData();
    formData.append("image", file);
    return api
      .post<SeriesCharacter>(`/series/${seriesId}/characters/${characterId}/image`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((res) => res.data);
  },
  updateCharacterImageUrl: (seriesId: string, characterId: string, url: string) =>
    api
      .post<SeriesCharacter>(`/series/${seriesId}/characters/${characterId}/image/url`, { url })
      .then((res) => res.data),
  deleteCharacterImage: (seriesId: string, characterId: string) =>
    api.delete<SeriesCharacter>(`/series/${seriesId}/characters/${characterId}/image`).then((res) => res.data),
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
  /**
   * 볼륨 내의 첫 번째 읽을 수 있는 챕터를 재귀적으로 탐색 (통합 API 사용 버전)
   */
  findFirstChapterRecursively: async (
    volumeId: string,
    context?: { seriesId?: string; allVolumes?: Volume[]; allChapters?: Chapter[] },
  ): Promise<Chapter | null> => {
    try {
      let seriesId = context?.seriesId;
      let allChapters = context?.allChapters;
      let allVolumes = context?.allVolumes;

      if (!seriesId) {
        // 볼륨 정보 먼저 가져오기 (series_id 확인용)
        const volRes = await volumeAPI.get(volumeId);
        const volume = volRes.data;
        seriesId = volume?.series_id;
      }
      if (!seriesId) return null;

      if (!allChapters) {
        const chaptersRes = await seriesAPI.getChapters(seriesId);
        allChapters = chaptersRes.data.chapters || [];
      }
      if (!allVolumes) {
        const volumesRes = await seriesAPI.getVolumes(seriesId);
        allVolumes = volumesRes.data.volumes || [];
      }
      const resolvedVolumes = allVolumes ?? [];
      const resolvedChapters = allChapters ?? [];
      const childrenByParentId = new Map<string, Volume[]>();
      for (const volume of resolvedVolumes) {
        if (!volume.parent_id) continue;
        const children = childrenByParentId.get(volume.parent_id);
        if (children) {
          children.push(volume);
        } else {
          childrenByParentId.set(volume.parent_id, [volume]);
        }
      }

      // 해당 볼륨과 그 모든 자식 볼륨의 ID 수집
      const targetVolumeIds = new Set<string>();
      const collectIds = (vId: string) => {
        if (targetVolumeIds.has(vId)) return;
        targetVolumeIds.add(vId);
        const children = childrenByParentId.get(vId);
        if (!children) return;
        children.forEach((v: Volume) => collectIds(v.id));
      };
      collectIds(volumeId);

      // 백엔드의 시리즈 챕터 정렬(volume_number, chapter_number)을 그대로 사용
      // 대상 볼륨(및 하위 볼륨)에 속하는 첫 챕터를 순서 보존 상태에서 찾는다.
      const firstChapter = resolvedChapters.find((c) => targetVolumeIds.has(c.volume_id));
      return firstChapter ?? null;
    } catch (error) {
      console.error("Failed to find first chapter recursively:", error);
      return null;
    }
  },
};

// Chapter API
export const chapterAPI = {
  get: (id: string) => api.get(`/chapters/${id}`),
  getPages: (chapterId: string) => api.get(`/chapters/${chapterId}/pages`),
  getProgress: (chapterId: string) => api.get(`/chapters/${chapterId}/progress`),
  analyze: (chapterId: string) =>
    api.post<{ analyzed_count: number; total_pages: number; success: boolean }>(`/chapters/${chapterId}/analyze`),
  markComplete: (chapterId: string) => api.post(`/chapters/${chapterId}/complete`),
  markPreviousComplete: (seriesId: string, chapterId: string) =>
    api.post(`/series/${seriesId}/chapters/${chapterId}/complete-previous`),
  deleteProgress: (chapterId: string) => api.delete(`/chapters/${chapterId}/progress`),
  getBGM: (chapterId: string) => api.get<{ exists: boolean; url?: string }>(`/chapters/${chapterId}/bgm`),
  getAudioUrl: (chapterId: string) => `${API_BASE_URL}/chapters/${chapterId}/audio`,
};

// Bookmark API
export const bookmarkAPI = {
  getAll: (seriesId: string) => api.get(`/bookmarks/series/${seriesId}`),
  create: (data: {
    series_id: string;
    volume_id?: string;
    chapter_id?: string;
    title: string;
    description?: string;
    page_number?: number;
    current_position?: number;
    current_cfi?: string;
    current_time?: number;
  }) => api.post("/bookmarks", data),
  delete: (id: string) => api.delete(`/bookmarks/${id}`),
};

// EPUB Progress API (EPUB 전용)
export const epubProgressAPI = {
  get: (chapterId: string) => api.get(`/chapters/${chapterId}/epub-progress`),
  update: (
    chapterId: string,
    data: {
      current_page: number;
      total_pages: number;
      current_position: number;
      total_positions: number;
      progress_percent: number;
      current_cfi: string;
    },
  ) => api.patch(`/chapters/${chapterId}/epub-progress`, data),
};

// Reading Progress API
export const progressAPI = {
  getAll: () => api.get("/reading-progress"),
  getRecent: (limit = 10) => api.get(`/reading-progress/recent?limit=${limit}`),
  sync: (items: unknown[]) => api.post("/reading-progress/sync", { items }),
  update: (data: { series_id: string; chapter_id: string; current_page: number }) =>
    api.post("/reading-progress/update", data),
};

// Viewer API
export interface ViewerInitResponse {
  chapter: Chapter;
  volume: Volume;
  series: Series;
  library: Library;
  progress: ReadingProgress | null;
  user_settings: UserSeriesSetting | null;
  pages: Page[];
  server_settings: Record<string, string>;
}

export const viewerAPI = {
  getInitData: (chapterId: string) => api.get<ViewerInitResponse>(`/viewer/init/${chapterId}`),
  start: (data: { series_id: string; chapter_id: string }) => api.post("/viewer/start", data),
  resumeCheck: (data: { series_id: string; chapter_id: string; current_page: number }) =>
    api.post("/viewer/resume-check", data),
};

// Settings API
export const settingAPI = {
  list: () => api.get<Record<string, string>>("/settings").then((res) => res.data),
  update: (key: string, data: { value: string; locale?: string }) =>
    api.put(`/settings/${key}`, data).then((res) => res.data),
};

// Download API
export const downloadAPI = {
  getSeriesUrl: (id: string) => `${API_BASE_URL}/download/series/${id}`,
  getVolumeUrl: (id: string) => `${API_BASE_URL}/download/volumes/${id}`,
  getChapterUrl: (id: string) => `${API_BASE_URL}/download/chapters/${id}`,
};

// System API
export const systemAPI = {
  getVersion: (force = false) => api.get(`/system/version?force=${force}`).then((res) => res.data),
  getPluginKeyStatus: () => api.get<{ auto_generated: boolean }>("/system/plugin-key-status").then((res) => res.data),
};

export const pluginAPI = {
  list: () => api.get<{ plugins: PluginRecord[] }>("/plugins").then((res) => res.data),
  catalog: () => api.get<PluginCatalogResponse>("/plugins/catalog").then((res) => res.data),
  getUpdates: (force = false) =>
    api.get<PluginUpdateSummary>(`/plugins/updates?force=${force}`).then((res) => res.data),
  install: (pluginId: string) =>
    api.post<PluginInstallResponse>("/plugins/install", { plugin_id: pluginId }).then((res) => res.data),
  uninstall: (pluginId: string) => api.delete<PluginUninstallResponse>(`/plugins/${pluginId}`).then((res) => res.data),
  getConfig: (pluginId: string) => api.get<PluginConfigStatus>(`/plugins/${pluginId}/config`).then((res) => res.data),
  updateConfig: (pluginId: string, field: string, value: string) =>
    api.put<PluginConfigUpdateResponse>(`/plugins/${pluginId}/config`, { field, value }).then((res) => res.data),
  runAuthAction: (pluginId: string, actionId: string, values: Record<string, string>) =>
    api.post<PluginAuthActionResponse>(`/plugins/${pluginId}/auth/${actionId}`, { values }).then((res) => res.data),
  deleteAuthAction: (pluginId: string, actionId: string) =>
    api.delete<PluginAuthDeleteResponse>(`/plugins/${pluginId}/auth/${actionId}`).then((res) => res.data),
  deleteConfig: (pluginId: string, field: string) =>
    api.delete<PluginConfigUpdateResponse>(`/plugins/${pluginId}/config/${field}`).then((res) => res.data),
  activate: (pluginId: string) => api.post<PluginRecord>(`/plugins/${pluginId}/activate`).then((res) => res.data),
  deactivate: (pluginId: string) => api.post<PluginRecord>(`/plugins/${pluginId}/deactivate`).then((res) => res.data),
  health: (pluginId: string) =>
    api
      .get<{ status: string; version?: string; message?: string }>(`/plugins/${pluginId}/health`)
      .then((res) => res.data),
  batchTranslate: (targetLang?: string) =>
    api
      .post<{
        total_processed: number;
        total_targets?: number;
        total_success: number;
        total_failed: number;
        cancelled?: boolean;
      }>("/translations/batch", targetLang ? { target_lang: targetLang } : {})
      .then((res) => res.data),
};

// Session API
export const sessionAPI = {
  getMySessions: () => api.get<{ sessions: Session[] }>("/auth/sessions").then((res) => res.data),
  revokeSession: (sessionId: string) => api.delete(`/auth/sessions/${sessionId}`).then((res) => res.data),
  revokeOtherSessions: () => api.delete("/auth/sessions").then((res) => res.data),
  // 관리자용
  getAllSessions: () => api.get<{ sessions: Session[] }>("/users/sessions").then((res) => res.data),
  revokeSessionByAdmin: (userId: string, sessionId: string) =>
    api.delete(`/users/${userId}/sessions/${sessionId}`).then((res) => res.data),
};

// Statistics API
export const statsAPI = {
  getPersonal: () => api.get("/stats/personal").then((res) => res.data),
  heartbeat: (seriesId: string, seconds: number, chapterId?: string) =>
    api.post("/stats/heartbeat", { series_id: seriesId, seconds, chapter_id: chapterId }),
};

// Filesystem API
export const filesystemAPI = {
  browse: (path = "/") =>
    api.get<{
      current: string;
      parent: string | null;
      quick_paths: { name: string; path: string }[];
      directories: { name: string; path: string }[];
    }>(`/filesystem?path=${encodeURIComponent(path)}`),
};

// EPUB API
export const epubAPI = {
  getEpubUrl: (chapterId: string) => `${API_BASE_URL}/chapters/${chapterId}/epub`,
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
