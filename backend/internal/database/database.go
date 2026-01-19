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
		description TEXT DEFAULT '',
		is_bookmarked BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 전자책 메타데이터
	CREATE TABLE IF NOT EXISTS ebook_metadata (
		series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
		status TEXT DEFAULT 'ONGOING',
		authors TEXT DEFAULT '',
		tags TEXT DEFAULT '',
		publication_year TEXT DEFAULT ''
	);

	-- 볼륨 (권/시즌)
	CREATE TABLE IF NOT EXISTS volumes (
		id TEXT PRIMARY KEY,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		title TEXT NOT NULL,
		volume_number INTEGER NOT NULL,
		path TEXT NOT NULL,
		thumbnail_path TEXT,
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

	-- 읽기 진행도 (UNIQUE 제약조건: user_id + chapter_id)
	CREATE TABLE IF NOT EXISTS reading_progress (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
		chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
		current_page INTEGER NOT NULL DEFAULT 0,
		total_pages INTEGER NOT NULL DEFAULT 0,
		progress_percent REAL DEFAULT 0.0,
		device_id TEXT,
		device_name TEXT,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(user_id, chapter_id)
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

	-- 인덱스
	CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id);
	CREATE INDEX IF NOT EXISTS idx_volumes_series ON volumes(series_id);
	CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_id);
	CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
	CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id);
	CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id);
	CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id);
	CREATE INDEX IF NOT EXISTS idx_volume_completions_user ON volume_completions(user_id);
	CREATE INDEX IF NOT EXISTS idx_volume_completions_volume ON volume_completions(volume_id);
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
	migrateEbookMetadata() // 기존 데이터 이전용
	migrateSeriesCleanup()

	// 4. 진행도 관련 정리
	migrateReadingProgress()

	return nil
}

// columnExists 테이블에 특정 컬럼이 존재하는지 확인
func columnExists(tableName, columnName string) bool {
	query := fmt.Sprintf("PRAGMA table_info(%s)", tableName)
	rows, err := DB.Query(query)
	if err != nil {
		return false
	}
	defer rows.Close()

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

// migrateReadingProgress reading_progress 테이블 UNIQUE 제약조건 마이그레이션
// (user_id, series_id) → (user_id, chapter_id)로 변경하여 챕터별 진행도 저장 가능하게 함
func migrateReadingProgress() {
	// 이미 마이그레이션 되었는지 확인 (새 테이블이 있거나 기존 테이블에 새 인덱스가 있으면 skip)
	var count int
	err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_chapter'`).Scan(&count)
	if err == nil && count > 0 {
		return // 이미 마이그레이션 완료
	}

	// 새 테이블 생성
	_, err = DB.Exec(`
		CREATE TABLE IF NOT EXISTS reading_progress_new (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
			volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
			chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
			current_page INTEGER NOT NULL DEFAULT 0,
			total_pages INTEGER NOT NULL DEFAULT 0,
			progress_percent REAL DEFAULT 0.0,
			device_id TEXT,
			device_name TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, chapter_id)
		)
	`)
	if err != nil {
		// 이미 존재하면 무시
		return
	}

	// 기존 데이터 이전 (chapter_id가 있는 것만)
	// 주의: chapter_id가 없는(볼륨 레벨 진행도) 데이터는 손실됨
	fmt.Println("Migrating reading_progress: Note that volume-only progress (null chapter_id) will be dropped.")
	DB.Exec(`
		INSERT OR IGNORE INTO reading_progress_new 
		SELECT * FROM reading_progress WHERE chapter_id IS NOT NULL
	`)

	// 기존 테이블 삭제 및 이름 변경
	DB.Exec(`DROP TABLE IF EXISTS reading_progress`)
	DB.Exec(`ALTER TABLE reading_progress_new RENAME TO reading_progress`)

	// 인덱스 생성
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`)
	DB.Exec(`CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id)`)
}

// migrateEbookMetadata ebook_metadata 테이블 신설 및 데이터 이전
func migrateEbookMetadata() {
	// 테이블 생성
	_, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS ebook_metadata (
			series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
			status TEXT DEFAULT 'ONGOING',
			authors TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			publication_year TEXT DEFAULT ''
		)
	`)
	if err != nil {
		fmt.Printf("Failed to create ebook_metadata table: %v\n", err)
		return
	}

	// 기존 데이터 이전 (series 테이블에 해당 컬럼들이 있을 때만)
	// SQLite는 이미 데이터가 있으면 INSERT OR IGNORE로 무시 가능
	_, err = DB.Exec(`
		INSERT OR IGNORE INTO ebook_metadata (series_id, status, authors, tags, publication_year)
		SELECT id, status, authors, tags, publication_year FROM series
	`)
	if err != nil {
		// 컬럼이 없는 경우 에러가 발생할 수 있으므로 로그만 남김
		fmt.Printf("Note: ebook_metadata migration skip or partial: %v\n", err)
	}
}

// migrateSeriesCleanup series 테이블에서 ebook_metadata로 이전된 불필요한 컬럼 제거
func migrateSeriesCleanup() {
	hasStatus := false
	{
		// 별도 스코프에서 조회하여 rows.Scan/Close 리소스를 즉시 정리
		rows, err := DB.Query(`PRAGMA table_info(series)`)
		if err != nil {
			return
		}
		defer rows.Close()

		for rows.Next() {
			var cid int
			var name, dtype string
			var notnull int
			var dflt_value interface{}
			var pk int
			if err := rows.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk); err != nil {
				continue
			}
			if name == "status" {
				hasStatus = true
				break
			}
		}
		rows.Close() // 명시적으로 닫기
	}

	if !hasStatus {
		return // 이미 정리됨
	}

	fmt.Println("Cleaning up series table: removing ebook metadata columns...")

	// SQLite에서 컬럼을 삭제하기 위해 새 테이블 생성 후 데이터 복사 (Recreate pattern)
	// 외래 키 제약 조건 때문에 일시적으로 외래 키 체크 비활성화 (동일한 연결 세션에서 처리 필수)
	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		fmt.Printf("Failed to get connection for series cleanup: %v\n", err)
		return
	}
	defer conn.Close()

	conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`)
	defer conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`)

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		fmt.Printf("Failed to start transaction for series cleanup: %v\n", err)
		return
	}
	defer tx.Rollback()

	// 1. 새 테이블 생성
	_, err = tx.ExecContext(ctx, `
		CREATE TABLE series_new (
			id TEXT PRIMARY KEY,
			library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			path TEXT NOT NULL,
			thumbnail_path TEXT,
			description TEXT DEFAULT '',
			is_bookmarked BOOLEAN DEFAULT 0,
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
		INSERT INTO series_new (id, library_id, title, path, thumbnail_path, description, is_bookmarked, created_at, updated_at)
		SELECT id, library_id, title, path, thumbnail_path, description, is_bookmarked, created_at, updated_at FROM series
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

	// 2. is_visible 컬럼 추가
	if !columnExists("libraries", "is_visible") {
		_, err := DB.Exec(`ALTER TABLE libraries ADD COLUMN is_visible BOOLEAN DEFAULT 1`)
		if err != nil {
			fmt.Printf("Migration error (libraries.is_visible): %v\n", err)
		}
	}

	// 3. 좋아요(즐겨찾기) 라이브러리 생성
	// type='SYSTEM', id='system-likes'
	var exists int
	err := DB.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = 'system-likes'`).Scan(&exists)
	if err == nil && exists == 0 {
		_, err := DB.Exec(`
			INSERT INTO libraries (id, name, path, type, is_visible, created_at, updated_at, sort_order)
			VALUES ('system-likes', '좋아요한 시리즈', 'SYSTEM://LIKES', 'SYSTEM', 1, datetime('now'), datetime('now'), 0)
		`)
		if err != nil {
			fmt.Printf("Failed to create system library: %v\n", err)
		} else {
			fmt.Println("Created 'Liked Series' system library.")
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
		defer conn.Close()

		conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`)
		defer conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`)

		tx, err := conn.BeginTx(ctx, nil)
		if err != nil {
			fmt.Printf("Failed to start transaction for users cleanup: %v\n", err)
			return
		}
		defer tx.Rollback()

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
