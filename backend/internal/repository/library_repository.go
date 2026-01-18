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

	// Get max sort_order
	var maxOrder sql.NullInt64
	err := database.DB.QueryRow("SELECT MAX(sort_order) FROM libraries").Scan(&maxOrder)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if maxOrder.Valid {
		library.SortOrder = int(maxOrder.Int64) + 1
	} else {
		library.SortOrder = 0
	}

	_, err = database.DB.Exec(
		`INSERT INTO libraries (id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		library.ID, library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.SortOrder, library.CreatedAt, library.UpdatedAt,
	)
	return err
}

// FindAll 모든 라이브러리 조회
func (r *LibraryRepository) FindAll() ([]model.Library, error) {
	rows, err := database.DB.Query(
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at FROM libraries ORDER BY sort_order ASC, name ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var libraries []model.Library
	for rows.Next() {
		var lib model.Library
		var lastScanned sql.NullTime
		if err := rows.Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned); err != nil {
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
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at FROM libraries WHERE id = ?`,
		id,
	).Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned)

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
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at FROM libraries WHERE path = ?`,
		path,
	).Scan(&lib.ID, &lib.Name, &lib.Path, &lib.DefaultViewMode, &lib.DefaultReadDirection, &lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned)

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
		`UPDATE libraries SET name = ?, path = ?, default_view_mode = ?, default_read_direction = ?, sort_order = ?, updated_at = ? WHERE id = ?`,
		library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.SortOrder, library.UpdatedAt, library.ID,
	)
	return err
}

// UpdateOrder 여러 라이브러리의 정렬 순서 업데이트
func (r *LibraryRepository) UpdateOrder(orders map[string]int) error {
	tx, err := database.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	now := time.Now()
	stmt, err := tx.Prepare(`UPDATE libraries SET sort_order = ?, updated_at = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for id, order := range orders {
		if _, err := stmt.Exec(order, now, id); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// Delete 라이브러리 삭제
func (r *LibraryRepository) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM libraries WHERE id = ?`, id)
	return err
}
