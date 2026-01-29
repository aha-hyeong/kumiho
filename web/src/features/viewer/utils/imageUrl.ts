// 이미지 URL 생성 유틸리티

const API_BASE_URL = import.meta.env.VITE_API_URL || "/api/v1";

/**
 * 페이지 이미지 URL 생성 (토큰 포함)
 */
export const getPageImageUrl = (chapterId: string, pageNumber: number): string => {
  const token = localStorage.getItem("access_token");
  let url = `${API_BASE_URL}/chapters/${chapterId}/pages/${pageNumber}/image`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
  }
  return url;
};

/**
 * API 기본 URL 내보내기 (다른 곳에서 사용할 수 있도록)
 */
export { API_BASE_URL };
