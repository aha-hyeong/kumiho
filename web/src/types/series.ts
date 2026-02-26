export interface EbookMetadata {
  series_id: string;
  status: string;
  authors: string;
  tags: string;
  publication_year: string;
}

export interface Series {
  id: string;
  library_id: string;
  title: string;
  path?: string;
  thumbnail_url?: string;
  description?: string;
  is_bookmarked?: boolean;
  metadata?: EbookMetadata;
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
  has_audio?: boolean;
  unit?: string; // "volume" | "chapter"
  description?: string;
  authors?: string;
  publication_year?: string;
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
  total_bytes?: number;
  total_positions?: number;
  thumbnail_url?: string;
  is_read?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  chapter_id: string;
  page_number: number;
  path: string;
  width?: number;
  height?: number;
}

export interface ReadingProgress {
  id: string;
  user_id: string;
  series_id: string;
  volume_id?: string;
  chapter_id?: string;
  current_page: number;
  total_pages: number;
  current_position?: number;
  total_positions?: number;
  progress_percent: number;
  current_cfi?: string;
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
  /** 시리즈의 전체 페이지 수 */
  total_pages?: number;
  /** 시리즈에서 읽은 전체 페이지 수 */
  read_pages?: number;
}

export interface Library {
  id: string;
  name: string;
}
