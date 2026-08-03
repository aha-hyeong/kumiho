package model

import (
	"time"
)

// Role 사용자 권한
type Role string

const (
	RoleMaster Role = "MASTER"
	RoleUser   Role = "USER"
)

// User 사용자 모델
type User struct {
	ID           string    `json:"id"`
	Username     string    `json:"username"` // 로그인 ID
	Nickname     string    `json:"nickname"` // 사용자명
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	CanDownload  bool      `json:"can_download" db:"can_download"` // 다운로드 권한
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Library 라이브러리 모델
type Library struct {
	ID                     string     `json:"id"`
	Name                   string     `json:"name"`
	Paths                  []string   `json:"paths"`
	DefaultViewMode        string     `json:"default_view_mode" db:"default_view_mode"`
	DefaultReadDirection   string     `json:"default_read_direction" db:"default_read_direction"`
	DefaultPageTransition  string     `json:"default_page_transition" db:"default_page_transition"`
	DefaultEpubRenderMode  string     `json:"default_epub_render_mode" db:"default_epub_render_mode"`
	DefaultEpubTheme       string     `json:"default_epub_theme" db:"default_epub_theme"`
	DefaultEpubSpread      string     `json:"default_epub_spread" db:"default_epub_spread"`
	DefaultEpubWheelDir    string     `json:"default_epub_wheel_direction" db:"default_epub_wheel_direction"`
	DefaultEpubKeyboardDir string     `json:"default_epub_keyboard_direction" db:"default_epub_keyboard_direction"`
	DefaultEpubClickDir    string     `json:"default_epub_click_direction" db:"default_epub_click_direction"`
	SortOrder              int        `json:"sort_order" db:"sort_order"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
	LastScannedAt          *time.Time `json:"last_scanned_at,omitempty"`
	ScanStatus             string     `json:"scan_status" db:"scan_status"`           // "IDLE", "SCANNING", "ERROR"
	LastScanResult         string     `json:"last_scan_result" db:"last_scan_result"` // 스캔 결과 요약
	WarningCount           int        `json:"warning_count" db:"warning_count"`        // 손상된 파일 경고 개수
	Type                   string     `json:"type" db:"type"`                         // "LOCAL", "SYSTEM"
	LibraryType            string     `json:"library_type" db:"library_type"`         // "book", "audiobook"
	IsVisible              bool       `json:"is_visible" db:"is_visible"`
	ScanExcludes           string     `json:"scan_excludes" db:"scan_excludes"`                     // comma-separated patterns
	OriginalTitleOverride  bool       `json:"original_title_override" db:"original_title_override"` // 원제 덮어쓰기 옵션
}

// Series 시리즈 모델 (범용 컨테이너)
type Series struct {
	ID            string    `json:"id"`
	LibraryID     string    `json:"library_id"`
	Title         string    `json:"title"`
	DisplayTitle  string    `json:"display_title,omitempty" db:"-"`
	DisplayUnit   string    `json:"display_unit,omitempty" db:"-"`
	Path          string    `json:"path"`
	ThumbnailPath *string   `json:"thumbnail_path,omitempty"`
	ThumbnailURL  *string   `json:"thumbnail_url,omitempty" db:"-"`
	Description   string    `json:"description" db:"description"`
	IsBookmarked  bool      `json:"is_bookmarked" db:"is_bookmarked"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	LastContentUpdatedAt time.Time `json:"last_content_updated_at"`
	Extension     string    `json:"extension" db:"extension"` // 시리즈 대표 확장자
	LibraryType   string    `json:"library_type" db:"-"`      // "book", "audiobook" (JOIN으로 채움)

	// 시리즈 부가 메타데이터 (필요 시 로드)
	Metadata *SeriesMetadata `json:"metadata,omitempty" db:"-"`

	// 진행도 정보 (계산 필드)
	TotalPageCount int `json:"total_page_count" db:"-"`
	ReadPageCount  int `json:"read_page_count" db:"-"`
	VolumeCount    int `json:"volume_count" db:"-"`
	ChapterCount   int `json:"chapter_count" db:"-"`
}

// SeriesMetadata 시리즈 부가 메타데이터
type SeriesMetadata struct {
	SeriesID              string `json:"series_id" db:"series_id"`
	Description           string `json:"description" db:"description"`
	DescriptionTranslated string `json:"description_translated" db:"description_translated"`
	IsBookmarked          bool   `json:"is_bookmarked" db:"is_bookmarked"`
	Status                string `json:"status" db:"status"`   // "ONGOING", "COMPLETED", "HIATUS"
	Authors               string `json:"authors" db:"authors"` // JSON string or comma-separated
	Tags                  string `json:"tags" db:"tags"`       // JSON string or comma-separated
	PublicationYear       string `json:"publication_year" db:"publication_year"`
	OriginalTitle         string `json:"original_title" db:"original_title"`
	OriginalTitles        string `json:"original_titles" db:"original_titles"`
	Publisher             string `json:"publisher" db:"publisher"`
	PublishedAt           string `json:"published_at" db:"published_at"`
	ISBN                  string `json:"isbn" db:"isbn"`
}

// SeriesCharacter 시리즈 등장인물 모델
type SeriesCharacter struct {
	ID                string    `json:"id" db:"id"`
	SeriesID          string    `json:"series_id" db:"series_id"`
	Name              string    `json:"name" db:"name"`
	NormalizedName    string    `json:"-" db:"normalized_name"`
	SortOrder         int       `json:"sort_order" db:"sort_order"`
	Role              string    `json:"role" db:"role"`
	ExternalImageURL  string    `json:"-" db:"external_image_url"`
	ImagePath         string    `json:"-" db:"image_path"`
	ImageURL          string    `json:"image_url" db:"-"`
	SourceProvider    string    `json:"source_provider" db:"source_provider"`
	SourceCharacterID string    `json:"source_character_id" db:"source_character_id"`
	SourceRelationID  string    `json:"source_relation_id" db:"source_relation_id"`
	CreatedAt         time.Time `json:"created_at" db:"created_at"`
	UpdatedAt         time.Time `json:"updated_at" db:"updated_at"`
}

// Volume 볼륨(권) 모델
type Volume struct {
	ID              string    `json:"id"`
	SeriesID        string    `json:"series_id"`
	LibraryType     string    `json:"library_type,omitempty" db:"-"`
	IsBookmarked    bool      `json:"is_bookmarked" db:"-"` // 시리즈의 북마크 상태를 볼륨 응답에 전파하기 위한 UI용 가상 필드 (DB 비매핑)
	Title           string    `json:"title"`
	VolumeNumber    int       `json:"volume_number"`
	Path            string    `json:"path"`
	ThumbnailPath   *string   `json:"thumbnail_path,omitempty"`
	ThumbnailURL    *string   `json:"thumbnail_url,omitempty" db:"-"`
	HasAudio        bool      `json:"has_audio" db:"has_audio"`
	Unit            string    `json:"unit" db:"unit"` // "volume" or "chapter"
	Description     string    `json:"description" db:"description"`
	Authors         string    `json:"authors" db:"authors"`
	PublicationYear string    `json:"publication_year" db:"publication_year"`
	TotalPageCount  int       `json:"total_page_count" db:"-"`
	ReadPageCount   int       `json:"read_page_count" db:"-"`
	ProgressPercent float64   `json:"progress_percent" db:"-"`
	ChapterCount    int       `json:"chapter_count"`
	SubVolumeCount  int       `json:"sub_volume_count" db:"-"`
	ParentID        *string   `json:"parent_id" db:"parent_id"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	Extension       string    `json:"extension" db:"extension"` // 확장자 ( ZIP, EPUB, PDF 등)
}

// Chapter 챕터 모델
type Chapter struct {
	ID             string    `json:"id"`
	VolumeID       string    `json:"volume_id"`
	Title          string    `json:"title"`
	ChapterNumber  int       `json:"chapter_number"`
	Path           string    `json:"path"`
	PageCount      int       `json:"page_count"`
	TotalBytes     int64     `json:"total_bytes" db:"total_bytes"`         // EPUB 등에서 가상 포지션 계산용 (HTML 합계)
	TotalPositions int       `json:"total_positions" db:"total_positions"` // 가상 포지션 총수 (6KB = 1포지션)
	HasAudio       bool      `json:"has_audio" db:"has_audio"`
	Duration       *float64  `json:"duration,omitempty" db:"duration"` // 오디오 길이 (초)
	RenderMode     *string   `json:"render_mode,omitempty" db:"-"`
	ThumbnailURL   *string   `json:"thumbnail_url,omitempty" db:"-"`
	IsRead         bool      `json:"is_read" db:"-"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// Page 페이지 모델
type Page struct {
	ID         string `json:"id"`
	ChapterID  string `json:"chapter_id"`
	PageNumber int    `json:"page_number"`
	Path       string `json:"path"`
	Width      int    `json:"width"`  // 이미지 너비 (px)
	Height     int    `json:"height"` // 이미지 높이 (px)
}

// ReadingProgress 읽기 진행도 모델
type ReadingProgress struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	SeriesID        string    `json:"series_id"`
	VolumeID        *string   `json:"volume_id,omitempty"`
	ChapterID       *string   `json:"chapter_id,omitempty"`
	CurrentPage     int       `json:"current_page"`
	AnchorPage      int       `json:"anchor_page" db:"anchor_page"`
	OffsetRatio     float64   `json:"offset_ratio" db:"offset_ratio"`
	TotalPages      int       `json:"total_pages"`
	CurrentPosition int       `json:"current_position" db:"current_position"`   // 가상 포지션 중심 위치
	TotalPositions  int       `json:"total_positions" db:"total_positions"`     // 가상 포지션 총수
	CurrentTime     *float64  `json:"current_time,omitempty" db:"current_time"` // 오디오 재생 위치 (초)
	Duration        *float64  `json:"duration,omitempty" db:"duration"`         // 오디오 전체 길이 (초)
	ProgressPercent float64   `json:"progress_percent"`
	DeviceID        *string   `json:"device_id,omitempty"`
	DeviceName      *string   `json:"device_name,omitempty"`
	CurrentCFI      *string   `json:"current_cfi,omitempty"`
	ReadTimeSeconds int       `json:"read_time_seconds"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// Bookmark 범용 북마크 모델
type Bookmark struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	SeriesID        string    `json:"series_id"`
	VolumeID        *string   `json:"volume_id,omitempty"`
	ChapterID       *string   `json:"chapter_id,omitempty"`
	Title           string    `json:"title"`                  // 사용자 지정 제목
	Description     string    `json:"description"`            // 메모
	PageNumber      int       `json:"page_number"`            // 이미지/PDF 용
	CurrentPosition int       `json:"current_position"`       // EPUB 가상 포지션
	CurrentCFI      *string   `json:"current_cfi,omitempty"`  // EPUB CFI
	CurrentTime     *float64  `json:"current_time,omitempty"` // 오디오 시간
	CreatedAt       time.Time `json:"created_at"`
}

// VolumeCompletion 볼륨 완료 기록 모델
type VolumeCompletion struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	VolumeID    string    `json:"volume_id"`
	CompletedAt time.Time `json:"completed_at"`
}

// Session 세션 모델 (기기별 로그인 정보)
type Session struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	RefreshTokenHash string    `json:"-"`
	DeviceName       string    `json:"device_name"`
	DeviceType       string    `json:"device_type"` // desktop, tablet, mobile, unknown
	Browser          string    `json:"browser"`
	OS               string    `json:"os"`
	IPAddress        string    `json:"ip_address"`
	IsCurrent        bool      `json:"is_current" db:"-"`
	LastActiveAt     time.Time `json:"last_active_at"`
	CreatedAt        time.Time `json:"created_at"`
	ExpiresAt        time.Time `json:"expires_at"`

	// 관리자 조회 시 사용
	Username string `json:"username,omitempty" db:"-"`
	Nickname string `json:"nickname,omitempty" db:"-"`
}

// Setting 서버 설정 모델
type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UserSetting 사용자별 설정 모델
type UserSetting struct {
	UserID    string    `json:"user_id"`
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}

// PluginSecret 플러그인별 비밀 설정 저장 모델
type PluginSecret struct {
	PluginID       string    `json:"plugin_id"`
	FieldKey       string    `json:"field_key"`
	ValueEncrypted string    `json:"-"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// UserSeriesSetting 사용자별 시리즈 개별 설정 모델
type UserSeriesSetting struct {
	UserID                string    `json:"user_id"`
	SeriesID              string    `json:"series_id"`
	ReadingMode           *string   `json:"reading_mode,omitempty"`
	EpubRenderMode        *string   `json:"epub_render_mode,omitempty"`        // "auto" | "book" | "comic"
	EpubTheme             *string   `json:"epub_theme,omitempty"`              // "light" | "dark" | "sepia"
	EpubFlow              *string   `json:"epub_flow,omitempty"`               // "paginated" | "scrolled"
	EpubSpread            *string   `json:"epub_spread,omitempty"`             // "auto" | "none"
	EpubWheelDirection    *string   `json:"epub_wheel_direction,omitempty"`    // "down" | "up"
	EpubKeyboardDirection *string   `json:"epub_keyboard_direction,omitempty"` // "right" | "left"
	EpubClickDirection    *string   `json:"epub_click_direction,omitempty"`    // "right" | "left"
	EpubFontSize          *int      `json:"epub_font_size,omitempty"`
	EpubFontFamily        *string   `json:"epub_font_family,omitempty"`
	EpubLineHeight        *float64  `json:"epub_line_height,omitempty"`
	ReadingDirection      *string   `json:"reading_direction,omitempty"`
	WheelDirection        *string   `json:"wheel_direction,omitempty"` // "down" | "up"
	SwipeDirection        *string   `json:"swipe_direction,omitempty"`
	ClickDirection        *string   `json:"click_direction,omitempty"`
	KeyboardDirection     *string   `json:"keyboard_direction,omitempty"`
	FitMode               *string   `json:"fit_mode,omitempty"`
	BackgroundColor       *string   `json:"background_color,omitempty"`
	UpdatedAt             time.Time `json:"updated_at"`
}
