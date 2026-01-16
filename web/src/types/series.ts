export interface Series {
  id: string;
  library_id: string;
  title: string;
  path: string;
  thumbnail_url?: string;
  description?: string;
  status: "ONGOING" | "COMPLETED" | "HIATUS" | string;
  authors?: string;
  tags?: string;
  is_bookmarked?: boolean;
  publication_year?: string;
  total_page_count?: number;
  read_page_count?: number;
  created_at: string;
  updated_at: string;
}

export interface Volume {
  id: string;
  series_id: string;
  title: string;
  volume_number: number;
  path: string;
  thumbnail_url?: string;
  is_completed?: boolean;
  read_page_count?: number;
  total_page_count?: number;
  created_at: string;
}

export interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  path: string;
  page_count: number;
  thumbnail_url?: string;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  chapter_id: string;
  page_number: number;
  path: string;
}

export interface ReadingProgress {
  id: string;
  user_id: string;
  series_id: string;
  volume_id?: string;
  chapter_id?: string;
  current_page: number;
  total_pages: number;
  progress_percent: number;
  updated_at: string;
}

/**
 * 시리즈 읽기 진행도 요약 정보
 * 백엔드에서 계산된 권/화 단위 진행도를 담고 있습니다.
 */
export interface SeriesProgressSummary {
  /** 현재 읽고 있는 권 번호 */
  current_volume_number: number;
  /** 시리즈의 전체 권 수 */
  total_volumes: number;
  /** 현재 읽고 있는 화 번호 */
  current_chapter_number: number;
  /** 시리즈의 전체 화 수 */
  total_chapters: number;
}

export interface Library {
  id: string;
  name: string;
}
