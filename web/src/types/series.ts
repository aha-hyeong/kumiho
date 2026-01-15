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
  created_at: string;
}

export interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  path: string;
  page_count: number;
  created_at: string;
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

export interface Library {
  id: string;
  name: string;
}
