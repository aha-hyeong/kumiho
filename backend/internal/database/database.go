package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

// Queryer 데이터베이스 쿼리를 실행할 수 있는 인터페이스 (sql.DB와 sql.Tx 모두 지원)
type Queryer interface {
	Exec(query string, args ...interface{}) (sql.Result, error)
	Prepare(query string) (*sql.Stmt, error)
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
	ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	PrepareContext(ctx context.Context, query string) (*sql.Stmt, error)
	QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row
}

// GetQueryer tx가 있으면 tx를, 없으면 기본 DB를 반환
func GetQueryer(q Queryer) Queryer {
	if q != nil {
		return q
	}
	return DB
}

// Connect 데이터베이스 연결
func Connect(dbPath string) error {
	// 디렉토리 생성
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create database directory: %w", err)
	}

	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// 연결 테스트
	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %w", err)
	}

	// 마이그레이션 실행
	if err := Migrate(); err != nil {
		return fmt.Errorf("failed to migrate database: %w", err)
	}

	return nil
}

// Close 데이터베이스 연결 종료
func Close() error {
	if DB != nil {
		// WAL 파일 정리 (Main DB로 병합 및 파일 크기 초기화)
		_, _ = DB.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
		return DB.Close()
	}
	return nil
}

// Migrate 스키마 마이그레이션
func Migrate() error {
	schema := `
	-- 사용자
	CREATE TABLE IF NOT EXISTS users (
		id TEXT PRIMARY KEY,
		username TEXT UNIQUE NOT NULL, -- 로그인 ID
		nickname TEXT NOT NULL,        -- 사용자명 (닉네임)
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'USER',
		can_download BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 라이브러리
	CREATE TABLE IF NOT EXISTS libraries (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		path TEXT UNIQUE NOT NULL,
		type TEXT DEFAULT 'LOCAL',
		is_visible BOOLEAN DEFAULT 1,
		default_view_mode TEXT DEFAULT 'single',
		default_read_direction TEXT DEFAULT 'ltr',
		sort_order INTEGER DEFAULT 0,
		scan_status TEXT DEFAULT 'IDLE',
		last_scan_result TEXT DEFAULT '',
		scan_excludes TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		last_scanned_at DATETIME
	);

	-- 시리즈
	CREATE TABLE IF NOT EXISTS series (
		id TEXT PRIMARY KEY,
		library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		path TEXT NOT NULL,
		thumbnail_path TEXT,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 시리즈 메타데이터 (부가 정보)
	CREATE TABLE IF NOT EXISTS series_metadata (
		series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		description TEXT DEFAULT '',
		is_bookmarked BOOLEAN DEFAULT 0,
		status TEXT DEFAULT 'ONGOING',
		authors TEXT DEFAULT '',
		tags TEXT DEFAULT '',
		publication_year TEXT DEFAULT ''
	);

	-- 볼륨 (권/시즌)
	-- 볼륨 (권/시즌)
	CREATE TABLE IF NOT EXISTS volumes (
		id TEXT PRIMARY KEY,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		volume_number INTEGER NOT NULL,
		path TEXT NOT NULL,
		thumbnail_path TEXT,
		has_audio BOOLEAN DEFAULT 0,
		unit TEXT DEFAULT 'volume',
		description TEXT DEFAULT '',
		authors TEXT DEFAULT '',
		publication_year TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 챕터
	CREATE TABLE IF NOT EXISTS chapters (
		id TEXT PRIMARY KEY,
		volume_id TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		chapter_number INTEGER NOT NULL,
		path TEXT NOT NULL,
		page_count INTEGER DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 페이지
	CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
		page_number INTEGER NOT NULL,
		path TEXT NOT NULL
	);

	-- 읽기 진행도 (UNIQUE 제약조건: user_id + series_id)
	CREATE TABLE IF NOT EXISTS reading_progress (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
		chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
		current_page INTEGER NOT NULL DEFAULT 0,
		total_pages INTEGER NOT NULL DEFAULT 0,
		progress_percent REAL DEFAULT 0.0,
		device_id TEXT,
		device_name TEXT,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, series_id)
	);

	-- 볼륨 완료 기록
	CREATE TABLE IF NOT EXISTS volume_completions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		volume_id TEXT NOT NULL REFERENCES volumes(id) ON DELETE CASCADE,
		completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, volume_id)
	);

	-- 서버 설정
	CREATE TABLE IF NOT EXISTS server_settings (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 사용자별 설정 (서버 설정을 오버라이드)
	CREATE TABLE IF NOT EXISTS user_settings (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		key TEXT NOT NULL,
		value TEXT NOT NULL,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, key)
	);

	-- 사용자별 시리즈 개별 설정
	CREATE TABLE IF NOT EXISTS user_series_settings (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		reading_mode TEXT,
		reading_direction TEXT,
		click_direction TEXT,
		keyboard_direction TEXT,
		fit_mode TEXT,
		background_color TEXT,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, series_id)
	);

	-- 사용자별 접근 가능 라이브러리 매핑
	CREATE TABLE IF NOT EXISTS user_libraries (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
		PRIMARY KEY (user_id, library_id)
	);

	-- 사용자별 북마크(좋아요)
	CREATE TABLE IF NOT EXISTS user_bookmarks (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, series_id)
	);

	-- 인덱스
	CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id);
	CREATE INDEX IF NOT EXISTS idx_volumes_series ON volumes(series_id);
	CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_id);
	CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
	CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id);
	CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id);
	CREATE INDEX IF NOT EXISTS idx_volume_completions_user ON volume_completions(user_id);
	CREATE INDEX IF NOT EXISTS idx_volume_completions_volume ON volume_completions(volume_id);
	CREATE INDEX IF NOT EXISTS idx_user_libraries_user ON user_libraries(user_id);
	CREATE INDEX IF NOT EXISTS idx_user_bookmarks_user ON user_bookmarks(user_id);
	CREATE INDEX IF NOT EXISTS idx_user_settings_user ON user_settings(user_id);
	CREATE INDEX IF NOT EXISTS idx_user_series_settings_user ON user_series_settings(user_id);
	CREATE INDEX IF NOT EXISTS idx_user_series_settings_series ON user_series_settings(series_id);
	`

	if _, err := DB.Exec(schema); err != nil {
		return err
	}

	// 기존 데이터 호환성을 위한 마이그레이션 로직 (배포 전까지 유지)

	// 1. 사용자 테이블 (email 삭제, nickname 추가 및 데이터 복제)
	migrateUsersTable()

	// 2. 라이브러리 추가 데이터 처리
	migrateSystemLibrary()

	// 3. 시리즈 관련 정리
	migrateSeriesMetadata() // 기존 ebook_metadata 이전 및 series 정보 분리
	migrateSeriesCleanup()

	// 4. 진행도 관련 정리
	migrateReadingProgress()

	// 5. 사용자별 북마크 이전
	migrateUserBookmarks()

	// 6. 페이지 이미지 크기 컬럼 추가
	migratePagesWidthHeight()

	// 7. 유저 다운로드 권한 컬럼 추가
	migrateUserDownloadPermission()

	// 8. 볼륨 오디오 여부 컬럼 추가
	migrateVolumesHasAudio()

	// 9. 볼륨 단위(unit) 컬럼 추가
	migrateVolumesUnit()

	// 10. 읽기 진행도 제약조건 변경 (Series 단위 -> Volume 단위)
	// 10. 읽기 진행도 제약조건 변경 (Series 단위 -> Volume 단위)
	migrateReadingProgressPerVolume()

	// 11. 볼륨 메타데이터 컬럼 추가 (description, authors, publication_year)
	migrateVolumesMetadata()

	return nil
}

// migrateVolumesMetadata volumes 테이블에 메타 데이터(description, authors, publication_year) 컬럼 추가
func migrateVolumesMetadata() {
	if !columnExists("volumes", "description") {
		_, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN description TEXT DEFAULT ''`)
		if err != nil {
			fmt.Printf("Migration error (volumes.description): %v\n", err)
		} else {
			fmt.Println("Migrated volumes table: added description column.")
		}
	}
	if !columnExists("volumes", "authors") {
		_, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN authors TEXT DEFAULT ''`)
		if err != nil {
			fmt.Printf("Migration error (volumes.authors): %v\n", err)
		} else {
			fmt.Println("Migrated volumes table: added authors column.")
		}
	}
	if !columnExists("volumes", "publication_year") {
		_, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN publication_year TEXT DEFAULT ''`)
		if err != nil {
			fmt.Printf("Migration error (volumes.publication_year): %v\n", err)
		} else {
			fmt.Println("Migrated volumes table: added publication_year column.")
		}
	}
}

// columnExists 테이블에 특정 컬럼이 존재하는지 확인
func columnExists(tableName, columnName string) bool {
	query := fmt.Sprintf("PRAGMA table_info(%s)", tableName)
	rows, err := DB.Query(query)
	if err != nil {
		return false
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var cid int
		var name, dtype string
		var notnull int
		var dflt_value interface{}
		var pk int
		if err := rows.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk); err != nil {
			continue
		}
		if name == columnName {
			return true
		}
	}
	return false
}

// migrateSeriesMetadata series_metadata 테이블 신설 및 데이터 이전
func migrateSeriesMetadata() {
	// 1. 기존 ebook_metadata 테이블이 있으면 이름을 변경
	var exists int
	err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ebook_metadata'`).Scan(&exists)
	if err == nil && exists > 0 {
		fmt.Println("Renaming ebook_metadata to series_metadata...")
		_, err = DB.Exec(`ALTER TABLE ebook_metadata RENAME TO series_metadata`)
		if err != nil {
			fmt.Printf("Failed to rename ebook_metadata: %v\n", err)
		}
	}

	// 2. 테이블 생성 (기본 스키마에 이미 선언되어 있지만 안전하게 수행)
	_, err = DB.Exec(`
		CREATE TABLE IF NOT EXISTS series_metadata (
			series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
			description TEXT DEFAULT '',
			is_bookmarked BOOLEAN DEFAULT 0,
			status TEXT DEFAULT 'ONGOING',
			authors TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			publication_year TEXT DEFAULT ''
		)
	`)
	if err != nil {
		fmt.Printf("Failed to create series_metadata table: %v\n", err)
		return
	}

	// 3. 기존 series 테이블에서 데이터 이전 (series_metadata로)
	// description 컬럼이 존재할 때만 실행
	if columnExists("series", "description") {
		_, err = DB.Exec(`
			INSERT OR IGNORE INTO series_metadata (series_id, description, is_bookmarked)
			SELECT id, description, is_bookmarked FROM series
		`)
		if err != nil {
			fmt.Printf("Note: series_metadata data migration skip or partial: %v\n", err)
		}
	}
}

// migrateUserBookmarks 기존 전역 북마크를 사용자별 북마크로 이전
func migrateUserBookmarks() {
	// 모든 사용자에게 기존 북마크 정보 복사 (호환성 유지)
	_, err := DB.Exec(`
		INSERT OR IGNORE INTO user_bookmarks (user_id, series_id)
		SELECT 
			(SELECT id FROM users ORDER BY created_at ASC LIMIT 1) as user_id, 
			sm.series_id
		FROM series_metadata sm
		WHERE sm.is_bookmarked = 1
	`)
	if err != nil {
		fmt.Printf("Failed to migrate user bookmarks: %v\n", err)
	}
}

// migrateReadingProgress reading_progress 테이블 제약조건 정립
// (user_id, chapter_id) → (user_id, series_id)로 변경하여 시리즈당 하나의 진행도만 유지
func migrateReadingProgress() {
	// 이미 UNIQUE(user_id, series_id)이고 chapter_id가 NULL 허용인 상태인지 확인
	// idx_progress_chapter 인덱스가 있으면 PR #58 버전(chapter_id 필수)이므로 마이그레이션 수행
	var count int
	err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_chapter'`).Scan(&count)
	if err != nil || count == 0 {
		return // 이미 최신 구조이거나 이전 상태
	}

	fmt.Println("Consolidating reading_progress: changing unique constraint to (user_id, series_id)...")

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		fmt.Printf("Failed to get connection for progress migration: %v\n", err)
		return
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		fmt.Printf("Failed to disable foreign keys: %v\n", execErr)
		return
	}
	defer func() {
		if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); execErr != nil {
			fmt.Printf("Failed to enable foreign keys: %v\n", execErr)
		}
	}()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to start transaction for progress migration: %v\n", err)
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	// 1. 새 테이블 생성 (UNIQUE(user_id, series_id), chapter_id NULL 허용)
	_, err = tx.ExecContext(ctx, `
		CREATE TABLE reading_progress_new (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
			volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
			chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
			current_page INTEGER NOT NULL DEFAULT 0,
			total_pages INTEGER NOT NULL DEFAULT 0,
			progress_percent REAL DEFAULT 0.0,
			device_id TEXT,
			device_name TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, series_id)
		)
	`)
	if err != nil {
		fmt.Printf("Failed to create reading_progress_new: %v\n", err)
		return
	}

	// 2. 데이터 복사 (각 시리즈별 최신 진척도만 유지)
	_, err = tx.ExecContext(ctx, `
		INSERT INTO reading_progress_new (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at)
		SELECT 
			rp.id, rp.user_id, rp.series_id, rp.volume_id, rp.chapter_id, 
			rp.current_page, rp.total_pages, rp.progress_percent, 
			rp.device_id, rp.device_name, rp.updated_at
		FROM reading_progress AS rp
		INNER JOIN (
			SELECT 
				user_id, 
				series_id, 
				MAX(updated_at) AS max_updated_at
			FROM reading_progress
			GROUP BY user_id, series_id
		) AS latest
		ON rp.user_id = latest.user_id
		AND rp.series_id = latest.series_id
		AND rp.updated_at = latest.max_updated_at
	`)
	if err != nil {
		fmt.Printf("Failed to copy data to reading_progress_new: %v\n", err)
		return
	}

	// 3. 기존 테이블 삭제 및 교체
	_, err = tx.ExecContext(ctx, `DROP TABLE reading_progress`)
	if err != nil {
		fmt.Printf("Failed to drop old progress table: %v\n", err)
		return
	}

	_, err = tx.ExecContext(ctx, `ALTER TABLE reading_progress_new RENAME TO reading_progress`)
	if err != nil {
		fmt.Printf("Failed to rename progress table: %v\n", err)
		return
	}

	// 4. 인덱스 재생성
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate progress index (user): %v\n", err)
		return
	}
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate progress index (series): %v\n", err)
		return
	}

	if err := tx.Commit(); err != nil {
		fmt.Printf("Failed to commit progress migration: %v\n", err)
		return
	}

	fmt.Println("Successfully consolidated reading_progress table.")
}

// migrateSeriesCleanup series 테이블에서 series_metadata로 이전된 불필요한 컬럼 제거
func migrateSeriesCleanup() {
	hasExtraCol := false
	{
		rows, err := DB.Query(`PRAGMA table_info(series)`)
		if err != nil {
			return
		}
		defer func() { _ = rows.Close() }()

		for rows.Next() {
			var cid int
			var name, dtype string
			var notnull int
			var dflt_value interface{}
			var pk int
			if err := rows.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk); err != nil {
				continue
			}
			// metadata로 이동한 컬럼들이 남아있는지 확인
			if name == "description" || name == "status" || name == "authors" {
				hasExtraCol = true
				break
			}
		}
		_ = rows.Close()
	}

	if !hasExtraCol {
		return // 이미 정리됨
	}

	fmt.Println("Cleaning up series table: removing metadata columns...")

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		fmt.Printf("Failed to get connection for series cleanup: %v\n", err)
		return
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		fmt.Printf("Failed to disable foreign keys: %v\n", execErr)
		return
	}
	defer func() {
		if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); execErr != nil {
			fmt.Printf("Failed to enable foreign keys: %v\n", execErr)
		}
	}()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to start transaction for series cleanup: %v\n", err)
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	// 1. 새 테이블 생성 (metadata 컬럼 제외)
	_, err = tx.ExecContext(ctx, `
		CREATE TABLE series_new (
			id TEXT PRIMARY KEY,
			library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			path TEXT NOT NULL,
			thumbnail_path TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		fmt.Printf("Failed to create series_new: %v\n", err)
		return
	}

	// 2. 데이터 복사
	_, err = tx.ExecContext(ctx, `
		INSERT INTO series_new (id, library_id, title, path, thumbnail_path, created_at, updated_at)
		SELECT id, library_id, title, path, thumbnail_path, created_at, updated_at FROM series
	`)
	if err != nil {
		fmt.Printf("Failed to copy data to series_new: %v\n", err)
		return
	}

	// 3. 기존 테이블 삭제 및 이름 변경
	_, err = tx.ExecContext(ctx, `DROP TABLE series`)
	if err != nil {
		fmt.Printf("Failed to drop old series table: %v\n", err)
		return
	}

	_, err = tx.ExecContext(ctx, `ALTER TABLE series_new RENAME TO series`)
	if err != nil {
		fmt.Printf("Failed to rename series_new to series: %v\n", err)
		return
	}

	// 4. 인덱스 재생성
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate index on series: %v\n", err)
		return
	}

	if err := tx.Commit(); err != nil {
		fmt.Printf("Failed to commit series cleanup: %v\n", err)
		return
	}

	fmt.Println("Successfully cleaned up series table.")
}

// migrateSystemLibrary 시스템 라이브러리 지원을 위한 마이그레이션
func migrateSystemLibrary() {
	// 1. type 컬럼 추가
	if !columnExists("libraries", "type") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN type TEXT DEFAULT 'LOCAL'`)
		if err != nil {
			fmt.Printf("Migration error (libraries.type): %v\n", err)
		}
	}

	// 2. 추가 설정 컬럼 확인
	if !columnExists("libraries", "default_view_mode") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN default_view_mode TEXT DEFAULT 'single'`)
		if err != nil {
			fmt.Printf("Migration error (libraries.default_view_mode): %v\n", err)
		}
	}
	if !columnExists("libraries", "default_read_direction") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN default_read_direction TEXT DEFAULT 'ltr'`)
		if err != nil {
			fmt.Printf("Migration error (libraries.default_read_direction): %v\n", err)
		}
	}

	// 3. is_visible 컬럼 추가
	if !columnExists("libraries", "is_visible") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN is_visible BOOLEAN DEFAULT 1`)
		if err != nil {
			fmt.Printf("Migration error (libraries.is_visible): %v\n", err)
		}
	}

	// 4. 좋아요(즐겨찾기) 라이브러리 생성
	// type='SYSTEM', id='system-likes'
	var exists int
	err := DB.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = 'system-likes'`).Scan(&exists)
	if err == nil && exists == 0 {
		_, err := DB.Exec(`
			INSERT INTO libraries (id, name, path, type, is_visible, default_view_mode, default_read_direction, created_at, updated_at, sort_order)
			VALUES ('system-likes', '좋아요한 시리즈', 'SYSTEM://LIKES', 'SYSTEM', 1, 'single', 'ltr', datetime('now'), datetime('now'), 0)
		`)
		if err != nil {
			fmt.Printf("Failed to create system library: %v\n", err)
		} else {
			fmt.Println("Created 'Liked Series' system library.")
		}
	}

	// 5. scan_excludes 컬럼 추가
	if !columnExists("libraries", "scan_excludes") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN scan_excludes TEXT DEFAULT ''`)
		if err != nil {
			fmt.Printf("Migration error (libraries.scan_excludes): %v\n", err)
		} else {
			fmt.Println("Migrated libraries table: added scan_excludes column.")
		}
	}
}

// migrateUsersTable users 테이블 구조 변경 (email 삭제, nickname 추가)
func migrateUsersTable() {
	// 1. nickname 컬럼 추가 및 기본값 설정
	if !columnExists("users", "nickname") {
		_, err := DB.Exec(`ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''`)
		if err != nil {
			fmt.Printf("Migration error (add nickname): %v\n", err)
		} else {
			_, err = DB.Exec(`UPDATE users SET nickname = username WHERE nickname = ''`)
			if err != nil {
				fmt.Printf("Migration error (update nickname): %v\n", err)
			}
			fmt.Println("Migrated users table: added nickname column.")
		}
	}

	// 2. email 컬럼 삭제를 위한 테이블 재생성 (SQLite 제한사항 해결)
	if columnExists("users", "email") {
		fmt.Println("Cleaning up users table: removing email column...")

		ctx := context.Background()
		conn, err := DB.Conn(ctx)
		if err != nil {
			fmt.Printf("Failed to get connection for users cleanup: %v\n", err)
			return
		}
		defer func() { _ = conn.Close() }()

		if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
			fmt.Printf("Failed to disable foreign keys: %v\n", execErr)
			return
		}
		defer func() {
			if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); execErr != nil {
				fmt.Printf("Failed to enable foreign keys: %v\n", execErr)
			}
		}()

		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			fmt.Printf("Failed to start transaction for users cleanup: %v\n", err)
			return
		}
		defer func() {
			_ = tx.Rollback()
		}()

		// 1. 새 테이블 생성 (email 제외)
		_, err = tx.ExecContext(ctx, `
			CREATE TABLE users_new (
				id TEXT PRIMARY KEY,
				username TEXT UNIQUE NOT NULL,
				nickname TEXT NOT NULL,
				password_hash TEXT NOT NULL,
				role TEXT NOT NULL DEFAULT 'USER',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
				updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
			)
		`)
		if err != nil {
			fmt.Printf("Failed to create users_new: %v\n", err)
			return
		}

		// 2. 데이터 복사
		_, err = tx.ExecContext(ctx, `
			INSERT INTO users_new (id, username, nickname, password_hash, role, created_at, updated_at)
			SELECT id, username, nickname, password_hash, role, created_at, updated_at FROM users
		`)
		if err != nil {
			fmt.Printf("Failed to copy data to users_new: %v\n", err)
			return
		}

		// 3. 기존 테이블 삭제 및 이름 변경
		_, err = tx.ExecContext(ctx, `DROP TABLE users`)
		if err != nil {
			fmt.Printf("Failed to drop old users table: %v\n", err)
			return
		}

		_, err = tx.ExecContext(ctx, `ALTER TABLE users_new RENAME TO users`)
		if err != nil {
			fmt.Printf("Failed to rename users_new to users: %v\n", err)
			return
		}

		if err := tx.Commit(); err != nil {
			fmt.Printf("Failed to commit users cleanup: %v\n", err)
			return
		}

		fmt.Println("Successfully cleaned up users table: removed email column.")
	}
}

// migratePagesWidthHeight pages 테이블에 width, height 컬럼 추가
func migratePagesWidthHeight() {
	// width 컬럼이 없으면 추가
	if !columnExists("pages", "width") {
		_, err := DB.Exec(`ALTER TABLE pages ADD COLUMN width INTEGER DEFAULT 0`)
		if err != nil {
			fmt.Printf("Failed to add width column to pages: %v\n", err)
		} else {
			fmt.Println("Added width column to pages table.")
		}
	}

	// height 컬럼이 없으면 추가
	if !columnExists("pages", "height") {
		_, err := DB.Exec(`ALTER TABLE pages ADD COLUMN height INTEGER DEFAULT 0`)
		if err != nil {
			fmt.Printf("Failed to add height column to pages: %v\n", err)
		} else {
			fmt.Println("Added height column to pages table.")
		}
	}
}

// migrateUserDownloadPermission users 테이블에 can_download 컬럼 추가
func migrateUserDownloadPermission() {
	if !columnExists("users", "can_download") {
		_, err := DB.Exec(`ALTER TABLE users ADD COLUMN can_download BOOLEAN DEFAULT 0`)
		if err != nil {
			fmt.Printf("Migration error (users.can_download): %v\n", err)
		} else {
			// MASTER 계정은 기본적으로 다운로드 권한 허용
			_, err = DB.Exec(`UPDATE users SET can_download = 1 WHERE role = 'MASTER'`)
			if err != nil {
				fmt.Printf("Migration error (users.can_download update master): %v\n", err)
			}
			fmt.Println("Migrated users table: added can_download column.")
		}
	}
}

// migrateVolumesHasAudio volumes 테이블에 has_audio 컬럼 추가
func migrateVolumesHasAudio() {
	if !columnExists("volumes", "has_audio") {
		_, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN has_audio BOOLEAN DEFAULT 0`)
		if err != nil {
			fmt.Printf("Migration error (volumes.has_audio): %v\n", err)
		} else {
			fmt.Println("Migrated volumes table: added has_audio column.")
		}
	}
}

// migrateVolumesUnit volumes 테이블에 unit 컬럼 추가
func migrateVolumesUnit() {
	if !columnExists("volumes", "unit") {
		_, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN unit TEXT DEFAULT 'volume'`)
		if err != nil {
			fmt.Printf("Migration error (volumes.unit): %v\n", err)
		} else {
			fmt.Println("Migrated volumes table: added unit column.")
		}
	}
}

// migrateReadingProgressPerVolume 읽기 진행도를 볼륨별로 저장하도록 제약조건 변경
// (user_id, series_id) UNIQUE -> (user_id, volume_id) UNIQUE
// 주의: volume_id가 NULL인 경우(거의 없어야 함)는 중복 허용됨
func migrateReadingProgressPerVolume() {
	// 이미 변경되었는지 확인하기 위해 인덱스 이름 확인?
	// 아니면 그냥 시도. Safe하게 하려면 별도 flag 체크 필요하지만,
	// 여기서는 reading_progress 테이블의 인덱스 정보를 조회해서 판단.
	// (기존 idx_progress_unique_volume 같은게 있는지)

	// 간단히: UNIQUE 제약조건이 (user_id, series_id)인지 확인하는 쿼리가 복잡하므로,
	// 별도의 tracking table이나 version check가 없으니
	// 임의의 키(컬럼 아님)를 체크하거나, 그냥 매번 실행하되 "table_info"로 판단... 어렵다.
	// 그래서 "idx_progress_unique_volume" 이라는 이름의 Index가 없으면 실행하는 것으로 함.
	var count int
	err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_volume'`).Scan(&count)
	if err == nil && count > 0 {
		return // 이미 마이그레이션 됨
	}

	fmt.Println("Migrating reading_progress to per-volume unique constraint...")

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		fmt.Printf("Failed to get connection for progress migration v2: %v\n", err)
		return
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		fmt.Printf("Failed to disable foreign keys: %v\n", execErr)
		return
	}
	defer func() {
		if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`); execErr != nil {
			fmt.Printf("Failed to enable foreign keys: %v\n", execErr)
		}
	}()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to start transaction for progress migration v2: %v\n", err)
		return
	}
	defer func() { _ = tx.Rollback() }()

	// 1. 새 테이블 생성 (UNIQUE(user_id, volume_id))
	// volume_id가 NULL인 경우 CONFLICT가 발생하지 않으므로 여러 개 생길 수 있음 -> OK (시리즈 레벨 더미 진행도 등)
	// 하지만 일반적인 읽기 진행도는 volume_id가 필수임.
	_, err = tx.ExecContext(ctx, `
		CREATE TABLE reading_progress_v2 (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
			volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
			chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
			current_page INTEGER NOT NULL DEFAULT 0,
			total_pages INTEGER NOT NULL DEFAULT 0,
			progress_percent REAL DEFAULT 0.0,
			device_id TEXT,
			device_name TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`)
	if err != nil {
		fmt.Printf("Failed to create reading_progress_v2: %v\n", err)
		return
	}

	// Unique Index 생성 (테이블 정의에 넣지 않고 별도 인덱스로 명시적 제어)
	// volume_id가 NULL이 아닌 경우에만 Unique 해야 하나?
	// SQLite에서 UNIQUE(user_id, volume_id)는 volume_id가 NULL이면 중복 허용.
	// 우리가 원하는 것은 "같은 유저가 같은 볼륨에 대해 하나의 진행도만 가짐". OK.
	_, err = tx.ExecContext(ctx, `CREATE UNIQUE INDEX idx_progress_unique_volume ON reading_progress_v2(user_id, volume_id) WHERE volume_id IS NOT NULL`)
	if err != nil {
		fmt.Printf("Failed to create unique index on reading_progress_v2: %v\n", err)
		return
	}
	// volume_id가 NULL인 경우 series_id로 Unique해야 하나?
	// 일단 기존 데이터 유지를 위해 (user_id, series_id) where volume_id is null 추가?
	// 복잡해지므로 일단 volume 단위만 확실히 잡음.

	// 2. 데이터 복사
	// 기존 테이블의 모든 데이터를 복사. (시리즈당 1개만 있었으므로 충돌 날 일 없음...
	// 단, 기존 데이터 중 volume_id가 NULL인 게 있으면? -> 인덱스 WHERE volume_id IS NOT NULL이라서 에러 안 남.
	_, err = tx.ExecContext(ctx, `
		INSERT INTO reading_progress_v2 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at)
		SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at
		FROM reading_progress
	`)
	if err != nil {
		fmt.Printf("Failed to copy data to reading_progress_v2: %v\n", err)
		return
	}

	// 3. 테이블 교체
	_, err = tx.ExecContext(ctx, `DROP TABLE reading_progress`)
	if err != nil {
		fmt.Printf("Failed to drop old progress table: %v\n", err)
		return
	}

	_, err = tx.ExecContext(ctx, `ALTER TABLE reading_progress_v2 RENAME TO reading_progress`)
	if err != nil {
		fmt.Printf("Failed to rename progress table: %v\n", err)
		return
	}

	// 4. 인덱스 재생성 (Helper Index)
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate progress index (user): %v\n", err)
		return
	}
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate progress index (series): %v\n", err)
		return
	}
	_, err = tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id)`)
	if err != nil {
		fmt.Printf("Failed to recreate progress index (chapter): %v\n", err)
		return
	}

	if err := tx.Commit(); err != nil {
		fmt.Printf("Failed to commit progress migration v2: %v\n", err)
		return
	}

	fmt.Println("Successfully migrated reading_progress to per-volume tracking.")
}
