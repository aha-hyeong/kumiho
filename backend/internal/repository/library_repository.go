package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type LibraryRepository struct{}

func NewLibraryRepository() *LibraryRepository {
	return &LibraryRepository{}
}

// Create 새 라이브러리 생성
func (r *LibraryRepository) Create(library *model.Library) error {
	library.ID = uuid.New().String()
	now := time.Now()
	library.CreatedAt = now
	library.UpdatedAt = now

	_, err := database.DB.Exec(
		`INSERT INTO libraries (id, name, path, default_view_mode, default_read_direction, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		library.ID, library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.CreatedAt, library.UpdatedAt,
	)
	return err
}

// FindAll 모든 라이브러리 조회
func (r *LibraryRepository) FindAll() ([]model.Library, error) {
	rows, err := database.DB.Query(
		`SELECT id, name, path, default_view_mode, default_read_direction, created_at, updated_at, last_scanned_at FROM libraries ORDER BY name`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var libraries []model.Library
	for rows.Next() {
		var lib model.Library
		var lastScanned sql.NullTime
		if err := rows.Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned); err != nil {
			return nil, err
		}
		if lastScanned.Valid {
			lib.LastScannedAt = &lastScanned.Time
		}
		libraries = append(libraries, lib)
	}
	return libraries, nil
}

// FindByID ID로 라이브러리 조회
func (r *LibraryRepository) FindByID(id string) (*model.Library, error) {
	var lib model.Library
	var lastScanned sql.NullTime
	err := database.DB.QueryRow(
		`SELECT id, name, path, default_view_mode, default_read_direction, created_at, updated_at, last_scanned_at FROM libraries WHERE id = ?`,
		id,
	).Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lastScanned.Valid {
		lib.LastScannedAt = &lastScanned.Time
	}
	return &lib, nil
}

// FindByPath 경로로 라이브러리 조회
func (r *LibraryRepository) FindByPath(path string) (*model.Library, error) {
	var lib model.Library
	var lastScanned sql.NullTime
	err := database.DB.QueryRow(
		`SELECT id, name, path, default_view_mode, default_read_direction, created_at, updated_at, last_scanned_at FROM libraries WHERE path = ?`,
		path,
	).Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lastScanned.Valid {
		lib.LastScannedAt = &lastScanned.Time
	}
	return &lib, nil
}

// UpdateLastScanned 마지막 스캔 시간 업데이트
func (r *LibraryRepository) UpdateLastScanned(id string) error {
	now := time.Now()
	_, err := database.DB.Exec(
		`UPDATE libraries SET last_scanned_at = ?, updated_at = ? WHERE id = ?`,
		now, now, id,
	)
	return err
}

// Update 라이브러리 수정
func (r *LibraryRepository) Update(library *model.Library) error {
	library.UpdatedAt = time.Now()
	_, err := database.DB.Exec(
		`UPDATE libraries SET name = ?, path = ?, default_view_mode = ?, default_read_direction = ?, updated_at = ? WHERE id = ?`,
		library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.UpdatedAt, library.ID,
	)
	return err
}

// Delete 라이브러리 삭제
func (r *LibraryRepository) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM libraries WHERE id = ?`, id)
	return err
}
