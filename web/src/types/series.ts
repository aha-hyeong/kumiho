import type { ExtensionBadge } from "../utils/extension";

export type LibraryType = "book" | "audiobook" | "comic" | "novel";

export interface EbookMetadata {
  series_id: string;
  status: string;
  authors: string;
  tags: string;
  publication_year: string;
  original_title: string;
  original_titles?: string;
  publisher: string;
  published_at: string;
  isbn: string;
  description_translated?: string;
}

export interface SeriesCharacter {
  id: string;
  series_id: string;
  name: string;
  sort_order: number;
  role: string;
  image_url: string;
  source_provider: string;
  source_character_id: string;
  source_relation_id: string;
  created_at: string;
  updated_at: string;
}

export interface Series {
  id: string;
  library_id: string;
  title: string;
  display_title?: string;
  display_unit?: "volume" | "chapter";
  path?: string;
  author?: string;
  thumbnail_url?: string;
  description?: string;
  is_bookmarked?: boolean;
  metadata?: EbookMetadata;
  total_page_count?: number;
  read_page_count?: number;
  volume_count?: number;
  chapter_count?: number;
  created_at: string;
  updated_at: string;
  last_content_updated_at?: string;
  extension?: ExtensionBadge | "";
  library_type?: LibraryType;
  has_audio?: boolean;
}

export interface UpdateSeriesRequest {
  title?: string;
  description?: string;
  description_translated?: string;
  status?: string;
  authors?: string;
  tags?: string;
  is_bookmarked?: boolean;
  publication_year?: string;
  original_title?: string;
  publisher?: string;
  published_at?: string;
  isbn?: string;
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
  progress_percent?: number;
  chapter_count?: number;
  sub_volume_count?: number;
  parent_id?: string;
  extension?: ExtensionBadge | "";
  created_at: string;
  updated_at?: string;
  library_type?: LibraryType;
}

export interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  path: string;
  render_mode?: "pdf" | "image" | "text" | "audio";
  page_count: number;
  total_bytes?: number;
  total_positions?: number;
  duration?: number;
  has_audio?: boolean;
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
  anchor_page?: number;
  offset_ratio?: number;
  total_pages: number;
  current_position?: number;
  total_positions?: number;
  current_time?: number;
  duration?: number;
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
  /** 오디오북 전체 재생 시간 (초) */
  total_duration?: number;
  /** 오디오북 들은 시간 (초) */
  listened_duration?: number;
}

export interface UserSeriesSetting {
  user_id: string;
  series_id: string;
  reading_mode?: string;
  epub_render_mode?: string;
  epub_theme?: string;
  epub_flow?: "paginated" | "scrolled";
  epub_spread?: string;
  epub_wheel_direction?: string;
  epub_keyboard_direction?: string;
  epub_click_direction?: string;
  reading_direction?: string;
  wheel_direction?: string;
  swipe_direction?: string;
  click_direction?: string;
  keyboard_direction?: string;
  fit_mode?: string;
  background_color?: string;
  updated_at: string;
}

export interface Library {
  id: string;
  name: string;
  paths?: string[];
  type?: string;
  default_view_mode?: string;
  default_read_direction?: string;
  default_page_transition?: string;
  library_type?: LibraryType;
  is_visible?: boolean;
  scan_excludes?: string;
  original_title_override?: boolean;
}
