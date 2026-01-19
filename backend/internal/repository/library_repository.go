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
func (r *LibraryRepository) Create(db database.Queryer, library *model.Library) error {
	db = database.GetQueryer(db)
	library.ID = uuid.New().String()
	now := time.Now()
	library.CreatedAt = now
	library.UpdatedAt = now

	// Get max sort_order
	var maxOrder sql.NullInt64
	err := db.QueryRow("SELECT MAX(sort_order) FROM libraries").Scan(&maxOrder)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if maxOrder.Valid {
		library.SortOrder = int(maxOrder.Int64) + 1
	} else {
		library.SortOrder = 0
	}

	_, err = db.Exec(
		`INSERT INTO libraries (id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, type, is_visible)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL', 1)`,
		library.ID, library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.SortOrder, library.CreatedAt, library.UpdatedAt,
	)
	return err
}

// FindAll 모든 라이브러리 조회
func (r *LibraryRepository) FindAll(db database.Queryer) ([]model.Library, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at, scan_status, last_scan_result, type, is_visible FROM libraries ORDER BY sort_order ASC, name ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var libraries []model.Library
	for rows.Next() {
		var lib model.Library
		var lastScanned sql.NullTime
		var viewMode, readDirection, libType, scanStatus, scanResult sql.NullString
		var isVisible sql.NullBool
		if err := rows.Scan(
			&lib.ID, &lib.Name, &lib.Path, &viewMode, &readDirection,
			&lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned, &scanStatus, &scanResult, &libType, &isVisible,
		); err != nil {
			return nil, err
		}
		if lastScanned.Valid {
			lib.LastScannedAt = &lastScanned.Time
		}
		if viewMode.Valid {
			lib.DefaultViewMode = viewMode.String
		}
		if readDirection.Valid {
			lib.DefaultReadDirection = readDirection.String
		}
		if libType.Valid {
			lib.Type = libType.String
		}
		if scanStatus.Valid {
			lib.ScanStatus = scanStatus.String
		}
		if scanResult.Valid {
			lib.LastScanResult = scanResult.String
		}
		if isVisible.Valid {
			lib.IsVisible = isVisible.Bool
		}

		// 기본값 보장
		if lib.DefaultViewMode == "" {
			lib.DefaultViewMode = "single"
		}
		if lib.DefaultReadDirection == "" {
			lib.DefaultReadDirection = "ltr"
		}
		libraries = append(libraries, lib)
	}
	return libraries, nil
}

// FindByID ID로 라이브러리 조회
func (r *LibraryRepository) FindByID(db database.Queryer, id string) (*model.Library, error) {
	db = database.GetQueryer(db)
	var lib model.Library
	var lastScanned sql.NullTime
	var viewMode, readDirection, libType, scanStatus, scanResult sql.NullString
	var isVisible sql.NullBool
	err := db.QueryRow(
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at, scan_status, last_scan_result, type, is_visible FROM libraries WHERE id = ?`,
		id,
	).Scan(
		&lib.ID, &lib.Name, &lib.Path, &viewMode, &readDirection,
		&lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned, &scanStatus, &scanResult, &libType, &isVisible,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lastScanned.Valid {
		lib.LastScannedAt = &lastScanned.Time
	}
	if viewMode.Valid {
		lib.DefaultViewMode = viewMode.String
	}
	if readDirection.Valid {
		lib.DefaultReadDirection = readDirection.String
	}
	if libType.Valid {
		lib.Type = libType.String
	}
	if scanStatus.Valid {
		lib.ScanStatus = scanStatus.String
	}
	if scanResult.Valid {
		lib.LastScanResult = scanResult.String
	}
	if isVisible.Valid {
		lib.IsVisible = isVisible.Bool
	}

	// 기본값 보장
	if lib.DefaultViewMode == "" {
		lib.DefaultViewMode = "single"
	}
	if lib.DefaultReadDirection == "" {
		lib.DefaultReadDirection = "ltr"
	}

	return &lib, nil
}

// FindByPath 경로로 라이브러리 조회
func (r *LibraryRepository) FindByPath(db database.Queryer, path string) (*model.Library, error) {
	db = database.GetQueryer(db)
	var lib model.Library
	var lastScanned sql.NullTime
	var viewMode, readDirection, libType, scanStatus, scanResult sql.NullString
	var isVisible sql.NullBool
	err := db.QueryRow(
		`SELECT id, name, path, default_view_mode, default_read_direction, sort_order, created_at, updated_at, last_scanned_at, scan_status, last_scan_result, type, is_visible FROM libraries WHERE path = ?`,
		path,
	).Scan(
		&lib.ID, &lib.Name, &lib.Path, &viewMode, &readDirection,
		&lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned, &scanStatus, &scanResult, &libType, &isVisible,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if lastScanned.Valid {
		lib.LastScannedAt = &lastScanned.Time
	}
	if viewMode.Valid {
		lib.DefaultViewMode = viewMode.String
	}
	if readDirection.Valid {
		lib.DefaultReadDirection = readDirection.String
	}
	if libType.Valid {
		lib.Type = libType.String
	}
	if scanStatus.Valid {
		lib.ScanStatus = scanStatus.String
	}
	if scanResult.Valid {
		lib.LastScanResult = scanResult.String
	}
	if isVisible.Valid {
		lib.IsVisible = isVisible.Bool
	}

	// 기본값 보장
	if lib.DefaultViewMode == "" {
		lib.DefaultViewMode = "single"
	}
	if lib.DefaultReadDirection == "" {
		lib.DefaultReadDirection = "ltr"
	}

	return &lib, nil
}

// UpdateLastScanned 마지막 스캔 시간 업데이트
func (r *LibraryRepository) UpdateLastScanned(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	now := time.Now()
	_, err := db.Exec(
		`UPDATE libraries SET last_scanned_at = ?, updated_at = ? WHERE id = ?`,
		now, now, id,
	)
	return err
}

// UpdateScanStatus 스캔 상태 업데이트
func (r *LibraryRepository) UpdateScanStatus(db database.Queryer, id string, status string, result string) error {
	db = database.GetQueryer(db)
	now := time.Now()
	_, err := db.Exec(
		`UPDATE libraries SET scan_status = ?, last_scan_result = ?, updated_at = ? WHERE id = ?`,
		status, result, now, id,
	)
	return err
}

// Update 라이브러리 수정
func (r *LibraryRepository) Update(db database.Queryer, library *model.Library) error {
	db = database.GetQueryer(db)
	library.UpdatedAt = time.Now()
	_, err := db.Exec(
		`UPDATE libraries SET name = ?, path = ?, default_view_mode = ?, default_read_direction = ?, sort_order = ?, is_visible = ?, updated_at = ? WHERE id = ?`,
		library.Name, library.Path, library.DefaultViewMode, library.DefaultReadDirection, library.SortOrder, library.IsVisible, library.UpdatedAt, library.ID,
	)
	return err
}

// UpdateOrder 여러 라이브러리의 정렬 순서 업데이트
func (r *LibraryRepository) UpdateOrder(db database.Queryer, orders map[string]int) error {
	db = database.GetQueryer(db)
	now := time.Now()
	stmt, err := db.Prepare(`UPDATE libraries SET sort_order = ?, updated_at = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for id, order := range orders {
		if _, err := stmt.Exec(order, now, id); err != nil {
			return err
		}
	}

	return nil
}

// Delete 라이브러리 삭제
func (r *LibraryRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM libraries WHERE id = ?`, id)
	return err
}
