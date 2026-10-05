package repository

import (
	"database/sql"
	"fmt"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"

	"github.com/google/uuid"
)

type LibraryRepository struct{}

func NewLibraryRepository() *LibraryRepository {
	return &LibraryRepository{}
}

// loadLibraryPaths library_paths 테이블에서 라이브러리 경로 목록 조회
func (r *LibraryRepository) loadLibraryPaths(db database.Queryer, libraryID string) ([]string, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT path FROM library_paths WHERE library_id = ? ORDER BY sort_order ASC, created_at ASC`,
		libraryID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	paths := make([]string, 0)
	for rows.Next() {
		var path string
		if err := rows.Scan(&path); err != nil {
			return nil, err
		}
		paths = append(paths, path)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return paths, nil
}

func (r *LibraryRepository) loadLibraryPathsMap(db database.Queryer, libraryIDs []string) (map[string][]string, error) {
	pathMap := make(map[string][]string, len(libraryIDs))
	if len(libraryIDs) == 0 {
		return pathMap, nil
	}

	for _, libraryID := range libraryIDs {
		pathMap[libraryID] = make([]string, 0)
	}

	db = database.GetQueryer(db)
	placeholders := make([]string, len(libraryIDs))
	args := make([]interface{}, len(libraryIDs))
	for i, libraryID := range libraryIDs {
		placeholders[i] = "?"
		args[i] = libraryID
	}

	rows, err := db.Query(
		fmt.Sprintf(
			`SELECT library_id, path FROM library_paths WHERE library_id IN (%s) ORDER BY library_id ASC, sort_order ASC, created_at ASC`,
			strings.Join(placeholders, ", "),
		),
		args...,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var libraryID string
		var path string
		if err := rows.Scan(&libraryID, &path); err != nil {
			return nil, err
		}
		pathMap[libraryID] = append(pathMap[libraryID], path)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return pathMap, nil
}

// scanLibraryRow 공통 라이브러리 행 스캔 로직
func scanLibraryRow(scanner interface {
	Scan(dest ...interface{}) error
}) (*model.Library, error) {
	var lib model.Library
	var lastScanned sql.NullTime
	var viewMode, readDirection, pageTransition, libType, scanStatus, scanResult, scanExcludes, libraryType sql.NullString
	var epubRenderMode, epubTheme, epubSpread, epubWheelDir, epubKeyboardDir, epubClickDir sql.NullString
	var isVisible, originalTitleOverride sql.NullBool

	if err := scanner.Scan(
		&lib.ID, &lib.Name, &viewMode, &readDirection, &pageTransition,
		&epubRenderMode, &epubTheme, &epubSpread, &epubWheelDir, &epubKeyboardDir, &epubClickDir,
		&lib.SortOrder, &lib.CreatedAt, &lib.UpdatedAt, &lastScanned, &scanStatus, &scanResult, &libType, &isVisible, &scanExcludes, &libraryType, &originalTitleOverride,
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
	if pageTransition.Valid {
		lib.DefaultPageTransition = pageTransition.String
	}
	if epubRenderMode.Valid {
		lib.DefaultEpubRenderMode = epubRenderMode.String
	}
	if epubTheme.Valid {
		lib.DefaultEpubTheme = epubTheme.String
	}
	if epubSpread.Valid {
		lib.DefaultEpubSpread = epubSpread.String
	}
	if epubWheelDir.Valid {
		lib.DefaultEpubWheelDir = epubWheelDir.String
	}
	if epubKeyboardDir.Valid {
		lib.DefaultEpubKeyboardDir = epubKeyboardDir.String
	}
	if epubClickDir.Valid {
		lib.DefaultEpubClickDir = epubClickDir.String
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
	if scanExcludes.Valid {
		lib.ScanExcludes = scanExcludes.String
	}
	if libraryType.Valid {
		lib.LibraryType = libraryType.String
	} else {
		lib.LibraryType = "book"
	}
	if originalTitleOverride.Valid {
		lib.OriginalTitleOverride = originalTitleOverride.Bool
	}

	// 기본값 보장
	if lib.DefaultViewMode == "" {
		lib.DefaultViewMode = "single"
	}
	if lib.DefaultReadDirection == "" {
		lib.DefaultReadDirection = "ltr"
	}
	if lib.DefaultPageTransition == "" {
		lib.DefaultPageTransition = "slide"
	}
	if lib.DefaultEpubRenderMode == "" {
		lib.DefaultEpubRenderMode = "auto"
	}
	if lib.DefaultEpubTheme == "" {
		lib.DefaultEpubTheme = "light"
	}
	if lib.DefaultEpubSpread == "" {
		lib.DefaultEpubSpread = "auto"
	}
	if lib.DefaultEpubWheelDir == "" {
		lib.DefaultEpubWheelDir = "down"
	}
	if lib.DefaultEpubKeyboardDir == "" {
		lib.DefaultEpubKeyboardDir = "right"
	}
	if lib.DefaultEpubClickDir == "" {
		lib.DefaultEpubClickDir = "right"
	}

	return &lib, nil
}

const librarySelectColumns = `id, name, default_view_mode, default_read_direction, default_page_transition,
	default_epub_render_mode, default_epub_theme, default_epub_spread,
	default_epub_wheel_direction, default_epub_keyboard_direction, default_epub_click_direction,
	sort_order, created_at, updated_at, last_scanned_at, scan_status, last_scan_result, type, is_visible, scan_excludes, library_type, original_title_override`

func (r *LibraryRepository) replaceLibraryPaths(q database.Queryer, libraryID string, paths []string) error {
	if _, err := q.Exec(`DELETE FROM library_paths WHERE library_id = ?`, libraryID); err != nil {
		return fmt.Errorf("delete old paths: %w", err)
	}

	for i, path := range paths {
		_, err := q.Exec(
			`INSERT INTO library_paths (id, library_id, path, sort_order) VALUES (?, ?, ?, ?)`,
			uuid.New().String(), libraryID, path, i,
		)
		if err != nil {
			return fmt.Errorf("insert path %q: %w", path, err)
		}
	}

	return nil
}

func (r *LibraryRepository) withTransaction(db database.Queryer, fn func(tx database.Queryer) error) error {
	switch q := database.GetQueryer(db).(type) {
	case *sql.Tx:
		return fn(q)
	case *sql.DB:
		tx, err := q.Begin()
		if err != nil {
			return fmt.Errorf("begin transaction: %w", err)
		}
		if err := fn(tx); err != nil {
			if rbErr := tx.Rollback(); rbErr != nil {
				return fmt.Errorf("rollback transaction after error (%v): %w", rbErr, err)
			}
			return err
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit transaction: %w", err)
		}
		return nil
	default:
		return fn(q)
	}
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

	return r.withTransaction(db, func(tx database.Queryer) error {
		_, err = tx.Exec(
			`INSERT INTO libraries (
				id, name, default_view_mode, default_read_direction, default_page_transition,
				default_epub_render_mode, default_epub_theme, default_epub_spread, default_epub_wheel_direction,
				default_epub_keyboard_direction, default_epub_click_direction,
				sort_order, created_at, updated_at, type, library_type, is_visible, scan_excludes, original_title_override
			)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL', ?, 1, ?, ?)`,
			library.ID, library.Name, library.DefaultViewMode, library.DefaultReadDirection, library.DefaultPageTransition,
			library.DefaultEpubRenderMode, library.DefaultEpubTheme, library.DefaultEpubSpread, library.DefaultEpubWheelDir,
			library.DefaultEpubKeyboardDir, library.DefaultEpubClickDir,
			library.SortOrder, library.CreatedAt, library.UpdatedAt, library.LibraryType, library.ScanExcludes, library.OriginalTitleOverride,
		)
		if err != nil {
			return err
		}

		return r.replaceLibraryPaths(tx, library.ID, library.Paths)
	})
}

// FindAll 모든 라이브러리 조회
func (r *LibraryRepository) FindAll(db database.Queryer) ([]model.Library, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT ` + librarySelectColumns + ` FROM libraries ORDER BY sort_order ASC, name ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var libraries []model.Library
	libraryIDs := make([]string, 0)
	for rows.Next() {
		lib, scanErr := scanLibraryRow(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		libraries = append(libraries, *lib)
		libraryIDs = append(libraryIDs, lib.ID)
	}
	if rowsErr := rows.Err(); rowsErr != nil {
		return nil, rowsErr
	}

	pathMap, err := r.loadLibraryPathsMap(db, libraryIDs)
	if err != nil {
		return nil, err
	}
	for i := range libraries {
		libraries[i].Paths = pathMap[libraries[i].ID]
	}

	return libraries, nil
}

// FindByID ID로 라이브러리 조회
func (r *LibraryRepository) FindByID(db database.Queryer, id string) (*model.Library, error) {
	db = database.GetQueryer(db)
	row := db.QueryRow(
		`SELECT `+librarySelectColumns+` FROM libraries WHERE id = ?`,
		id,
	)

	lib, err := scanLibraryRow(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	// 경로 로드
	paths, err := r.loadLibraryPaths(db, lib.ID)
	if err != nil {
		return nil, err
	}
	lib.Paths = paths

	return lib, nil
}

// FindByPath 경로로 라이브러리 조회 (library_paths 테이블에서 검색)
func (r *LibraryRepository) FindByPath(db database.Queryer, path string) (*model.Library, error) {
	db = database.GetQueryer(db)

	// library_paths에서 해당 경로를 가진 library_id 조회
	var libraryID string
	err := db.QueryRow(`SELECT library_id FROM library_paths WHERE path = ?`, path).Scan(&libraryID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	return r.FindByID(db, libraryID)
}

// UpdateScanStatus 스캔 상태 업데이트 (진행률 포함)
func (r *LibraryRepository) UpdateScanStatus(db database.Queryer, id string, status string, result string) error {
	db = database.GetQueryer(db)
	now := time.Now()
	_, err := db.Exec(
		`UPDATE libraries SET scan_status = ?, last_scan_result = ?, updated_at = ? WHERE id = ?`,
		status, result, now, id,
	)
	return err
}

// ResetStaleScanStates 서버 재시작 시 잔류하는 SCANNING 상태를 IDLE로 초기화
func (r *LibraryRepository) ResetStaleScanStates(db database.Queryer) (int64, error) {
	db = database.GetQueryer(db)
	now := time.Now()
	result, err := db.Exec(
		`UPDATE libraries SET scan_status = 'IDLE', last_scan_result = ?, updated_at = ? WHERE scan_status = 'SCANNING'`,
		"서버 재시작으로 스캔이 중단되었습니다.", now,
	)
	if err != nil {
		return 0, err
	}
	n, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return n, nil
}

// UpdateScanProgress 스캔 진행률 업데이트 (현재 처리 중인 항목 정보)
func (r *LibraryRepository) UpdateScanProgress(db database.Queryer, id string, currentItem string, progress int) error {
	db = database.GetQueryer(db)
	result := fmt.Sprintf("%s|%d", currentItem, progress)
	_, err := db.Exec(
		`UPDATE libraries SET last_scan_result = ? WHERE id = ?`,
		result, id,
	)
	return err
}

// Update 라이브러리 수정
func (r *LibraryRepository) Update(db database.Queryer, library *model.Library) error {
	db = database.GetQueryer(db)
	library.UpdatedAt = time.Now()
	_, err := db.Exec(
		`UPDATE libraries SET
			name = ?, default_view_mode = ?, default_read_direction = ?, default_page_transition = ?,
			default_epub_render_mode = ?, default_epub_theme = ?, default_epub_spread = ?, default_epub_wheel_direction = ?,
			default_epub_keyboard_direction = ?, default_epub_click_direction = ?,
			sort_order = ?, library_type = ?, is_visible = ?, scan_excludes = ?, original_title_override = ?, updated_at = ?
		WHERE id = ?`,
		library.Name, library.DefaultViewMode, library.DefaultReadDirection, library.DefaultPageTransition,
		library.DefaultEpubRenderMode, library.DefaultEpubTheme, library.DefaultEpubSpread, library.DefaultEpubWheelDir,
		library.DefaultEpubKeyboardDir, library.DefaultEpubClickDir,
		library.SortOrder, library.LibraryType, library.IsVisible, library.ScanExcludes, library.OriginalTitleOverride, library.UpdatedAt, library.ID,
	)
	return err
}

func (r *LibraryRepository) UpdateWithPaths(db database.Queryer, library *model.Library, paths *[]string) error {
	return r.withTransaction(db, func(tx database.Queryer) error {
		if paths != nil {
			if err := r.replaceLibraryPaths(tx, library.ID, *paths); err != nil {
				return err
			}
		}
		return r.Update(tx, library)
	})
}

// UpdatePaths 라이브러리 경로 목록을 교체 (기존 경로 삭제 후 새로 삽입)
func (r *LibraryRepository) UpdatePaths(db database.Queryer, libraryID string, paths []string) error {
	return r.withTransaction(db, func(tx database.Queryer) error {
		return r.replaceLibraryPaths(tx, libraryID, paths)
	})
}

// PathExists 특정 경로가 이미 다른 라이브러리에서 사용 중인지 확인
func (r *LibraryRepository) PathExists(db database.Queryer, path string, excludeLibraryID string) (bool, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(
		`SELECT COUNT(*) FROM library_paths WHERE path = ? AND library_id != ?`,
		path, excludeLibraryID,
	).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// UpdateOrder 여러 라이브러리의 정렬 순서 업데이트
func (r *LibraryRepository) UpdateOrder(db database.Queryer, orders map[string]int) error {
	db = database.GetQueryer(db)
	now := time.Now()
	stmt, err := db.Prepare(`UPDATE libraries SET sort_order = ?, updated_at = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer func() { _ = stmt.Close() }()

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
	// library_paths는 ON DELETE CASCADE로 자동 삭제
	_, err := db.Exec(`DELETE FROM libraries WHERE id = ?`, id)
	return err
}
