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
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Library 라이브러리 모델
type Library struct {
	ID                   string     `json:"id"`
	Name                 string     `json:"name"`
	Path                 string     `json:"path"`
	DefaultViewMode      string     `json:"default_view_mode" db:"default_view_mode"`
	DefaultReadDirection string     `json:"default_read_direction" db:"default_read_direction"`
	SortOrder            int        `json:"sort_order" db:"sort_order"`
	CreatedAt            time.Time  `json:"created_at"`
	UpdatedAt            time.Time  `json:"updated_at"`
	LastScannedAt        *time.Time `json:"last_scanned_at,omitempty"`
	ScanStatus           string     `json:"scan_status" db:"scan_status"`           // "IDLE", "SCANNING", "ERROR"
	LastScanResult       string     `json:"last_scan_result" db:"last_scan_result"` // 스캔 결과 요약
	Type                 string     `json:"type" db:"type"`                         // "LOCAL", "SYSTEM"
	IsVisible            bool       `json:"is_visible" db:"is_visible"`
	ScanExcludes         string     `json:"scan_excludes" db:"scan_excludes"`       // comma-separated patterns
}

// Series 시리즈 모델 (범용 컨테이너)
type Series struct {
	ID            string    `json:"id"`
	LibraryID     string    `json:"library_id"`
	Title         string    `json:"title"`
	Path          string    `json:"path"`
	ThumbnailPath *string   `json:"thumbnail_path,omitempty"`
	ThumbnailURL  *string   `json:"thumbnail_url,omitempty" db:"-"`
	Description   string    `json:"description" db:"description"`
	IsBookmarked  bool      `json:"is_bookmarked" db:"is_bookmarked"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`

	// 시리즈 부가 메타데이터 (필요 시 로드)
	Metadata *SeriesMetadata `json:"metadata,omitempty" db:"-"`

	// 진행도 정보 (계산 필드)
	TotalPageCount int `json:"total_page_count" db:"-"`
	ReadPageCount  int `json:"read_page_count" db:"-"`
}

// SeriesMetadata 시리즈 부가 메타데이터
type SeriesMetadata struct {
	SeriesID        string `json:"series_id" db:"series_id"`
	Description     string `json:"description" db:"description"`
	IsBookmarked    bool   `json:"is_bookmarked" db:"is_bookmarked"`
	Status          string `json:"status" db:"status"`   // "ONGOING", "COMPLETED", "HIATUS"
	Authors         string `json:"authors" db:"authors"` // JSON string or comma-separated
	Tags            string `json:"tags" db:"tags"`       // JSON string or comma-separated
	PublicationYear string `json:"publication_year" db:"publication_year"`
}

// Volume 볼륨(권) 모델
type Volume struct {
	ID            string    `json:"id"`
	SeriesID      string    `json:"series_id"`
	Title         string    `json:"title"`
	VolumeNumber  int       `json:"volume_number"`
	Path          string    `json:"path"`
	ThumbnailPath *string   `json:"thumbnail_path,omitempty"`
	ThumbnailURL  *string   `json:"thumbnail_url,omitempty" db:"-"`
	TotalPageCount int       `json:"total_page_count" db:"-"`
	ReadPageCount  int       `json:"read_page_count" db:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Chapter 챕터 모델
type Chapter struct {
	ID            string    `json:"id"`
	VolumeID      string    `json:"volume_id"`
	Title         string    `json:"title"`
	ChapterNumber int       `json:"chapter_number"`
	Path          string    `json:"path"`
	PageCount     int       `json:"page_count"`
	ThumbnailURL  *string   `json:"thumbnail_url,omitempty" db:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

// Page 페이지 모델
type Page struct {
	ID         string `json:"id"`
	ChapterID  string `json:"chapter_id"`
	PageNumber int    `json:"page_number"`
	Path       string `json:"path"`
}

// ReadingProgress 읽기 진행도 모델
type ReadingProgress struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	SeriesID        string    `json:"series_id"`
	VolumeID        *string   `json:"volume_id,omitempty"`
	ChapterID       *string   `json:"chapter_id,omitempty"`
	CurrentPage     int       `json:"current_page"`
	TotalPages      int       `json:"total_pages"`
	ProgressPercent float64   `json:"progress_percent"`
	DeviceID        *string   `json:"device_id,omitempty"`
	DeviceName      *string   `json:"device_name,omitempty"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// VolumeCompletion 볼륨 완료 기록 모델
type VolumeCompletion struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id"`
	VolumeID    string    `json:"volume_id"`
	CompletedAt time.Time `json:"completed_at"`
}

// Setting 서버 설정 모델
type Setting struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}
