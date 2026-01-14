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
	Username     string    `json:"username"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         Role      `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// Library 라이브러리 모델
type Library struct {
	ID            string     `json:"id"`
	Name          string     `json:"name"`
	Path          string     `json:"path"`
	CreatedAt     time.Time  `json:"created_at"`
	UpdatedAt     time.Time  `json:"updated_at"`
	LastScannedAt *time.Time `json:"last_scanned_at,omitempty"`
}

// Series 시리즈 모델
type Series struct {
	ID            string    `json:"id"`
	LibraryID     string    `json:"library_id"`
	Title         string    `json:"title"`
	Path          string    `json:"path"`
	ThumbnailPath *string   `json:"thumbnail_path,omitempty"`
	ThumbnailURL  *string   `json:"thumbnail_url,omitempty" db:"-"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
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
