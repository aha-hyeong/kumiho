// 뷰어 관련 타입 정의

// 챕터 정보
export interface Chapter {
  id: string;
  volume_id: string;
  title: string;
  chapter_number: number;
  page_count: number;
  path?: string;
}

// 볼륨 정보
export interface Volume {
  id: string;
  volume_number: number;
  title: string;
  series_id: string;
  is_completed: boolean;
}

// 페이지 메타데이터 (두 페이지 모드용)
export interface PageMeta {
  pageNumber: number;
  width: number;
  height: number;
  isWide: boolean; // width > height * 1.3
}

// 인접 챕터 정보
export interface AdjacentChapterInfo {
  nextChapterId: string | null;
  prevChapterId: string | null;
  nextChapterTitle: string | null;
  prevChapterTitle: string | null;
  isLastChapterOfVolume: boolean;
}

// BGM 정보
export interface BGMInfo {
  exists: boolean;
  url?: string;
}

// 애니메이션 핸들
export interface ViewerAnimationHandles {
  animateNext: () => void;
  animatePrev: () => void;
  zoomIn?: () => void;
  zoomOut?: () => void;
  resetZoom?: () => void;
  getZoomScale?: () => number;
}
