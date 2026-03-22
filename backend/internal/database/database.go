package database

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

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
		return fmt.Errorf("failed to create database directory (check permissions for %s): %w", dir, err)
	}

	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
		return fmt.Errorf("failed to open database: %w", err)
	}

	// 연결 테스트
	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database (ensure the database directory is writable and the file path is correct): %w", err)
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

// ============================================================
// 마이그레이션 버전 관리
// ============================================================

const latestMigrationVersion = 34

// getMigrationVersion server_settings에서 현재 마이그레이션 버전 조회
func getMigrationVersion() int {
	var version int
	if err := DB.QueryRow(`SELECT CAST(value AS INTEGER) FROM server_settings WHERE key = 'migration_version'`).Scan(&version); err != nil {
		return 0
	}
	return version
}

// setMigrationVersion server_settings에 마이그레이션 버전 저장
func setMigrationVersion(version int) {
	_, _ = DB.Exec(
		`INSERT INTO server_settings (key, value, updated_at) VALUES ('migration_version', ?, CURRENT_TIMESTAMP)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
		fmt.Sprintf("%d", version),
	)
}

func ensureSystemLikesLibrary() error {
	requiredColumns := []string{
		"id",
		"name",
		"path",
		"type",
		"library_type",
		"is_visible",
		"default_view_mode",
		"default_read_direction",
		"default_page_transition",
		"created_at",
		"updated_at",
		"sort_order",
	}
	for _, column := range requiredColumns {
		if !columnExists("libraries", column) {
			return nil
		}
	}

	if _, err := DB.Exec(`
		INSERT INTO libraries (
			id, name, path, type, library_type, is_visible,
			default_view_mode, default_read_direction, default_page_transition,
			created_at, updated_at, sort_order
		)
		VALUES (
			'system-likes', '좋아요한 시리즈', 'SYSTEM://LIKES', 'SYSTEM', 'book', 1,
			'single', 'ltr', 'slide',
			datetime('now'), datetime('now'), 0
		)
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			path = excluded.path,
			type = excluded.type,
			library_type = excluded.library_type,
			is_visible = excluded.is_visible,
			default_view_mode = excluded.default_view_mode,
			default_read_direction = excluded.default_read_direction,
			default_page_transition = excluded.default_page_transition,
			sort_order = excluded.sort_order,
			updated_at = datetime('now')
	`); err != nil {
		return fmt.Errorf("upsert system-likes library: %w", err)
	}

	return nil
}

// addColumn 테이블에 컬럼이 없으면 추가하는 헬퍼
func addColumn(table, column, definition string) error {
	if !columnExists(table, column) {
		if _, err := DB.Exec(fmt.Sprintf("ALTER TABLE %s ADD COLUMN %s %s", table, column, definition)); err != nil {
			return fmt.Errorf("add %s.%s: %w", table, column, err)
		}
	}
	return nil
}

type migration struct {
	version int
	name    string
	fn      func() error
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
		library_type TEXT DEFAULT 'book', -- "book", "audiobook"
		is_visible BOOLEAN DEFAULT 1,
		default_view_mode TEXT DEFAULT 'single',
		default_read_direction TEXT DEFAULT 'ltr',
		default_page_transition TEXT DEFAULT 'slide',
		default_epub_render_mode TEXT DEFAULT 'auto',
		default_epub_theme TEXT DEFAULT 'light',
		default_epub_spread TEXT DEFAULT 'auto',
		default_epub_wheel_direction TEXT DEFAULT 'down',
		default_epub_keyboard_direction TEXT DEFAULT 'right',
		default_epub_click_direction TEXT DEFAULT 'right',
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
		extension TEXT DEFAULT '',
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
		publication_year TEXT DEFAULT '',
		original_title TEXT DEFAULT '',
		publisher TEXT DEFAULT '',
		published_at TEXT DEFAULT '',
		isbn TEXT DEFAULT ''
	);

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
		chapter_count INTEGER DEFAULT 0,
		parent_id TEXT REFERENCES volumes(id) ON DELETE CASCADE,
		description TEXT DEFAULT '',
		authors TEXT DEFAULT '',
		publication_year TEXT DEFAULT '',
		extension TEXT DEFAULT '',
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
		total_bytes INTEGER DEFAULT 0,
		total_positions INTEGER DEFAULT 0,
		has_audio BOOLEAN DEFAULT 0,
		duration REAL, -- 오디오 길이 (초)
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 페이지
	CREATE TABLE IF NOT EXISTS pages (
		id TEXT PRIMARY KEY,
		chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
		page_number INTEGER NOT NULL,
		path TEXT NOT NULL,
		width INTEGER DEFAULT 0,
		height INTEGER DEFAULT 0
	);

	-- 읽기 진행도 (UNIQUE 제약조건: user_id + chapter_id)
	CREATE TABLE IF NOT EXISTS reading_progress (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		volume_id TEXT REFERENCES volumes(id) ON DELETE SET NULL,
		chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
		current_page INTEGER NOT NULL DEFAULT 0,
		anchor_page INTEGER,
		offset_ratio REAL,
		total_pages INTEGER NOT NULL DEFAULT 0,
		current_position INTEGER DEFAULT 0,
		total_positions INTEGER DEFAULT 0,
		current_time REAL DEFAULT 0.0, -- 오디오 재생 위치 (초)
		duration REAL DEFAULT 0.0,     -- 오디오 전체 길이 (초)
		progress_percent REAL DEFAULT 0.0,
		device_id TEXT,
		device_name TEXT,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		read_time_seconds INTEGER DEFAULT 0,
		current_cfi TEXT, -- EPUB용 CFI
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
		epub_render_mode TEXT,
		epub_theme TEXT,
		epub_spread TEXT,
		epub_wheel_direction TEXT,
		epub_keyboard_direction TEXT,
		epub_click_direction TEXT,
		reading_direction TEXT,
		wheel_direction TEXT,
		swipe_direction TEXT,
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

	-- 북마크 (특정 위치 저장용, 범용)
	CREATE TABLE IF NOT EXISTS bookmarks (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		volume_id TEXT REFERENCES volumes(id) ON DELETE CASCADE,
		chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
		title TEXT DEFAULT '',
		description TEXT DEFAULT '',
		page_number INTEGER DEFAULT 0,
		current_position INTEGER DEFAULT 0,
		current_cfi TEXT,
		current_time REAL,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 사용자별 일일 활동 로그 (정확한 잔디 통계용)
	CREATE TABLE IF NOT EXISTS daily_activity (
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		date TEXT NOT NULL, -- YYYY-MM-DD (localtime)
		series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
		pages_read INTEGER DEFAULT 0,
		read_time_seconds INTEGER DEFAULT 0,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY (user_id, date, series_id)
	);

	-- 현재 뷰어 소유권(lease)
	CREATE TABLE IF NOT EXISTS viewer_sessions (
		user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
		session_id TEXT NOT NULL,
		series_id TEXT REFERENCES series(id) ON DELETE CASCADE,
		chapter_id TEXT REFERENCES chapters(id) ON DELETE CASCADE,
		last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	-- 로그인 세션
	CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
		refresh_token_hash TEXT NOT NULL,
		device_name TEXT DEFAULT '',
		device_type TEXT DEFAULT '',
		browser TEXT DEFAULT '',
		os TEXT DEFAULT '',
		ip_address TEXT DEFAULT '',
		last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		expires_at DATETIME NOT NULL
	);

	-- 인덱스
	CREATE INDEX IF NOT EXISTS idx_daily_activity_user_date ON daily_activity(user_id, date);
	CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
	CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(refresh_token_hash);
	CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
	CREATE INDEX IF NOT EXISTS idx_viewer_sessions_last_seen ON viewer_sessions(last_seen_at);
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
	CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON bookmarks(user_id);
	CREATE INDEX IF NOT EXISTS idx_bookmarks_series ON bookmarks(series_id);
	CREATE INDEX IF NOT EXISTS idx_bookmarks_chapter ON bookmarks(chapter_id);
	`

	if _, err := DB.Exec(schema); err != nil {
		return err
	}

	if err := ensureSystemLikesLibrary(); err != nil {
		return err
	}

	// 현재 마이그레이션 버전 확인
	currentVersion := getMigrationVersion()

	// 기존 DB 감지: migration_version이 아직 없지만 이미 마이그레이션이 완료된 DB
	// (버전 관리 도입 이전 코드에서 업그레이드할 때)
	// migration_version 도입 이전에 #33 수준 구조를 가진 기존 DB는
	// 버전만 33으로 기록하고 이후 마이그레이션(#34+)은 계속 수행한다.
	if currentVersion == 0 &&
		columnExists("libraries", "type") &&
		columnExists("libraries", "library_type") &&
		columnExists("users", "can_download") &&
		columnExists("sessions", "expires_at") {
		setMigrationVersion(33)
		currentVersion = 33
	}

	if currentVersion >= latestMigrationVersion {
		return nil
	}

	// 마이그레이션 목록 (버전 순서대로)
	migrations := []migration{
		{1, "사용자 테이블 정리 (email 삭제, nickname 추가)", migrateUsersTable},
		{2, "시스템 라이브러리 지원", migrateSystemLibrary},
		{3, "시리즈 메타데이터 분리", migrateSeriesMetadata},
		{4, "시리즈 테이블 정리", migrateSeriesCleanup},
		{5, "읽기 진행도 제약조건 정립", migrateReadingProgress},
		{6, "사용자별 북마크 이전", migrateUserBookmarks},
		{7, "페이지 이미지 크기 컬럼 추가", migratePagesWidthHeight},
		{8, "유저 다운로드 권한 컬럼 추가", migrateUserDownloadPermission},
		{9, "볼륨 오디오 여부 컬럼 추가", migrateVolumesHasAudio},
		{10, "볼륨 단위(unit) 컬럼 추가", migrateVolumesUnit},
		{11, "읽기 진행도 볼륨 기반으로 변경", migrateReadingProgressPerVolume},
		{12, "볼륨 메타데이터 컬럼 추가", migrateVolumesMetadata},
		{13, "시리즈 메타데이터 확장 컬럼 추가", migrateSeriesMetadataColumns},
		{14, "챕터 완독 테이블 추가", migrateChapterCompletions},
		{15, "읽기 시간 컬럼 추가", migrateReadingTime},
		{16, "읽기 진행도 챕터 기반으로 변경", migrateProgressToChapterBased},
		{17, "세션 테이블 추가", migrateSessions},
		{18, "읽기 진행도 유니크 인덱스 수정 (Partial → Standard)", fixReadingProgressUniqueIndex},
		{19, "읽기 진행도 유니크 제약조건 수정 (Series → Chapter)", fixReadingProgressUniqueIndexV2},
		{20, "터치 스와이프 방향 컬럼 추가", migrateSwipeDirection},
		{21, "마우스 휠 방향 컬럼 추가", migrateWheelDirection},
		{22, "EPUB CFI 컬럼 추가", migrateEpubCFI},
		{23, "EPUB 가상 포지션 컬럼 추가", migrateEpubVirtualPositions},
		{24, "EPUB 렌더 모드 컬럼 추가", migrateEpubRenderMode},
		{25, "EPUB 시리즈 설정 컬럼 추가", migrateEpubSeriesSettings},
		{26, "라이브러리 EPUB 기본값 컬럼 추가", migrateLibraryEpubDefaults},
		{27, "볼륨 챕터 수 컬럼 추가", migrateVolumesChapterCount},
		{28, "볼륨 부모 ID 컬럼 추가", migrateVolumesParentID},
		{29, "볼륨 확장자 컬럼 추가", migrateVolumesExtension},
		{30, "시리즈 확장자 컬럼 추가", migrateSeriesExtension},
		{31, "세로 복원용 앵커 위치 컬럼 추가", migrateProgressRestorePosition},
		{32, "챕터별 has_audio 컬럼 추가", migrateChaptersHasAudio},
		{33, "오디오북 관련 컬럼 추가", migrateAudiobookColumns},
		{34, "오디오 진행시간 문자열 정규화", migrateAudioProgressTimeFormat},
	}

	// 필요한 마이그레이션만 실행
	for _, m := range migrations {
		if m.version <= currentVersion {
			continue
		}
		fmt.Printf("[Migration %d/%d] %s\n", m.version, latestMigrationVersion, m.name)
		if err := m.fn(); err != nil {
			return fmt.Errorf("migration %d (%s) failed: %w", m.version, m.name, err)
		}
		setMigrationVersion(m.version)
	}

	if err := ensureSystemLikesLibrary(); err != nil {
		return err
	}

	return nil
}

// ============================================================
// 유틸리티
// ============================================================

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

// ============================================================
// 마이그레이션 함수 (버전 순)
// ============================================================

// #1 migrateUsersTable users 테이블 구조 변경 (email 삭제, nickname 추가)
func migrateUsersTable() error {
	// 1. nickname 컬럼 추가 및 기본값 설정
	if !columnExists("users", "nickname") {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN nickname TEXT NOT NULL DEFAULT ''`); err != nil {
			return fmt.Errorf("add users.nickname: %w", err)
		}
		if _, err := DB.Exec(`UPDATE users SET nickname = username WHERE nickname = ''`); err != nil {
			return fmt.Errorf("update users.nickname: %w", err)
		}
	}

	// 2. email 컬럼 삭제를 위한 테이블 재생성
	if !columnExists("users", "email") {
		return nil
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for users cleanup: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		return fmt.Errorf("disable foreign keys: %w", execErr)
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for users cleanup: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE users_new (
			id TEXT PRIMARY KEY,
			username TEXT UNIQUE NOT NULL,
			nickname TEXT NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'USER',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create users_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO users_new (id, username, nickname, password_hash, role, created_at, updated_at)
		SELECT id, username, nickname, password_hash, role, created_at, updated_at FROM users
	`); err != nil {
		return fmt.Errorf("copy data to users_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE users`); err != nil {
		return fmt.Errorf("drop old users table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE users_new RENAME TO users`); err != nil {
		return fmt.Errorf("rename users_new to users: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit users cleanup: %w", err)
	}

	return nil
}

// #2 migrateSystemLibrary 시스템 라이브러리 지원을 위한 마이그레이션
func migrateSystemLibrary() error {
	if err := addColumn("libraries", "type", "TEXT DEFAULT 'LOCAL'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_view_mode", "TEXT DEFAULT 'single'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_read_direction", "TEXT DEFAULT 'ltr'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_page_transition", "TEXT DEFAULT 'slide'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "is_visible", "BOOLEAN DEFAULT 1"); err != nil {
		return err
	}

	// 좋아요(즐겨찾기) 라이브러리 생성
	if err := ensureSystemLikesLibrary(); err != nil {
		return err
	}

	return addColumn("libraries", "scan_excludes", "TEXT DEFAULT ''")
}

// #3 migrateSeriesMetadata series_metadata 테이블 신설 및 데이터 이전
func migrateSeriesMetadata() error {
	// 1. 기존 ebook_metadata 테이블이 있으면 이름을 변경
	var exists int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ebook_metadata'`).Scan(&exists); err == nil && exists > 0 {
		if _, err := DB.Exec(`ALTER TABLE ebook_metadata RENAME TO series_metadata`); err != nil {
			return fmt.Errorf("rename ebook_metadata: %w", err)
		}
	}

	// 2. 테이블 생성 (기본 스키마에 이미 선언되어 있지만 안전하게 수행)
	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS series_metadata (
			series_id TEXT PRIMARY KEY REFERENCES series(id) ON DELETE CASCADE,
			description TEXT DEFAULT '',
			is_bookmarked BOOLEAN DEFAULT 0,
			status TEXT DEFAULT 'ONGOING',
			authors TEXT DEFAULT '',
			tags TEXT DEFAULT '',
			publication_year TEXT DEFAULT '',
			original_title TEXT DEFAULT '',
			publisher TEXT DEFAULT '',
			published_at TEXT DEFAULT '',
			isbn TEXT DEFAULT ''
		)
	`); err != nil {
		return fmt.Errorf("create series_metadata: %w", err)
	}

	// 3. 기존 series 테이블에서 데이터 이전
	if columnExists("series", "description") {
		_, _ = DB.Exec(`
			INSERT OR IGNORE INTO series_metadata (series_id, description, is_bookmarked)
			SELECT id, description, is_bookmarked FROM series
		`)
	}

	return nil
}

// #4 migrateSeriesCleanup series 테이블에서 series_metadata로 이전된 불필요한 컬럼 제거
func migrateSeriesCleanup() error {
	hasExtraCol := false
	{
		rows, err := DB.Query(`PRAGMA table_info(series)`)
		if err != nil {
			return nil
		}
		for rows.Next() {
			var cid int
			var name, dtype string
			var notnull int
			var dflt_value interface{}
			var pk int
			if err := rows.Scan(&cid, &name, &dtype, &notnull, &dflt_value, &pk); err != nil {
				continue
			}
			if name == "description" || name == "status" || name == "authors" {
				hasExtraCol = true
				break
			}
		}
		_ = rows.Close()
	}

	if !hasExtraCol {
		return nil
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for series cleanup: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		return fmt.Errorf("disable foreign keys: %w", execErr)
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for series cleanup: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE series_new (
			id TEXT PRIMARY KEY,
			library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
			title TEXT NOT NULL,
			path TEXT NOT NULL,
			thumbnail_path TEXT,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create series_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO series_new (id, library_id, title, path, thumbnail_path, created_at, updated_at)
		SELECT id, library_id, title, path, thumbnail_path, created_at, updated_at FROM series
	`); err != nil {
		return fmt.Errorf("copy data to series_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE series`); err != nil {
		return fmt.Errorf("drop old series table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE series_new RENAME TO series`); err != nil {
		return fmt.Errorf("rename series_new to series: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id)`); err != nil {
		return fmt.Errorf("recreate index on series: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit series cleanup: %w", err)
	}

	return nil
}

// #5 migrateReadingProgress reading_progress 테이블 제약조건 정립
func migrateReadingProgress() error {
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_chapter'`).Scan(&count); err != nil || count == 0 {
		return nil
	}

	// 과거 스키마 호환:
	// 일부 DB는 reading_progress에 current_time/duration 컬럼이 없을 수 있다.
	// 이 경우 데이터 복사 시 0.0으로 대체해서 마이그레이션 실패를 방지한다.
	currentTimeExpr := "current_time"
	if !columnExists("reading_progress", "current_time") {
		currentTimeExpr = "0.0 AS current_time"
	}
	durationExpr := "duration"
	if !columnExists("reading_progress", "duration") {
		durationExpr = "0.0 AS duration"
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for progress migration: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		return fmt.Errorf("disable foreign keys: %w", execErr)
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for progress migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
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
			current_time REAL DEFAULT 0.0,
			duration REAL DEFAULT 0.0,
			UNIQUE(user_id, series_id)
		)
	`); err != nil {
		return fmt.Errorf("create reading_progress_new: %w", err)
	}

	insertQuery := fmt.Sprintf(`
		INSERT OR IGNORE INTO reading_progress_new (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, current_time, duration)
		SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, %s, %s
		FROM (
			SELECT *, ROW_NUMBER() OVER(PARTITION BY user_id, series_id ORDER BY updated_at DESC, id DESC) as rn
			FROM reading_progress
		) AS rp
		WHERE rn = 1
	`, currentTimeExpr, durationExpr)

	if _, err := tx.ExecContext(ctx, insertQuery); err != nil {
		return fmt.Errorf("copy data to reading_progress_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE reading_progress`); err != nil {
		return fmt.Errorf("drop old progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE reading_progress_new RENAME TO reading_progress`); err != nil {
		return fmt.Errorf("rename progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`); err != nil {
		return fmt.Errorf("recreate progress index (user): %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`); err != nil {
		return fmt.Errorf("recreate progress index (series): %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit progress migration: %w", err)
	}

	return nil
}

// #6 migrateUserBookmarks 기존 전역 북마크를 사용자별 북마크로 이전
func migrateUserBookmarks() error {
	_, err := DB.Exec(`
		INSERT OR IGNORE INTO user_bookmarks (user_id, series_id)
		SELECT
			(SELECT id FROM users ORDER BY created_at ASC LIMIT 1) as user_id,
			sm.series_id
		FROM series_metadata sm
		WHERE sm.is_bookmarked = 1
	`)
	if err != nil {
		return fmt.Errorf("migrate user bookmarks: %w", err)
	}
	return nil
}

// #7 migratePagesWidthHeight pages 테이블에 width, height 컬럼 추가
func migratePagesWidthHeight() error {
	if err := addColumn("pages", "width", "INTEGER DEFAULT 0"); err != nil {
		return err
	}
	return addColumn("pages", "height", "INTEGER DEFAULT 0")
}

// #8 migrateUserDownloadPermission users 테이블에 can_download 컬럼 추가
func migrateUserDownloadPermission() error {
	if !columnExists("users", "can_download") {
		if _, err := DB.Exec(`ALTER TABLE users ADD COLUMN can_download BOOLEAN DEFAULT 0`); err != nil {
			return fmt.Errorf("add users.can_download: %w", err)
		}
		if _, err := DB.Exec(`UPDATE users SET can_download = 1 WHERE role = 'MASTER'`); err != nil {
			return fmt.Errorf("update master can_download: %w", err)
		}
	}
	return nil
}

// #9 migrateVolumesHasAudio volumes 테이블에 has_audio 컬럼 추가
func migrateVolumesHasAudio() error {
	return addColumn("volumes", "has_audio", "BOOLEAN DEFAULT 0")
}

// #10 migrateVolumesUnit volumes 테이블에 unit 컬럼 추가
func migrateVolumesUnit() error {
	return addColumn("volumes", "unit", "TEXT DEFAULT 'volume'")
}

// #11 migrateReadingProgressPerVolume 읽기 진행도를 볼륨별로 저장하도록 제약조건 변경
func migrateReadingProgressPerVolume() error {
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_volume'`).Scan(&count); err == nil && count > 0 {
		return nil
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for progress migration v2: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		return fmt.Errorf("disable foreign keys: %w", execErr)
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for progress migration v2: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
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
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			current_time REAL DEFAULT 0.0,
			duration REAL DEFAULT 0.0
		)
	`); err != nil {
		return fmt.Errorf("create reading_progress_v2: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE UNIQUE INDEX idx_progress_unique_volume ON reading_progress_v2(user_id, volume_id) WHERE volume_id IS NOT NULL`); err != nil {
		return fmt.Errorf("create unique index on reading_progress_v2: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO reading_progress_v2 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, current_time, duration)
		SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, current_time, duration
		FROM reading_progress
	`); err != nil {
		return fmt.Errorf("copy data to reading_progress_v2: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE reading_progress`); err != nil {
		return fmt.Errorf("drop old progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE reading_progress_v2 RENAME TO reading_progress`); err != nil {
		return fmt.Errorf("rename progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`); err != nil {
		return fmt.Errorf("recreate progress index (user): %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`); err != nil {
		return fmt.Errorf("recreate progress index (series): %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id)`); err != nil {
		return fmt.Errorf("recreate progress index (chapter): %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit progress migration v2: %w", err)
	}

	return nil
}

// #12 migrateVolumesMetadata volumes 테이블에 메타데이터 컬럼 추가
func migrateVolumesMetadata() error {
	if err := addColumn("volumes", "description", "TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("volumes", "authors", "TEXT DEFAULT ''"); err != nil {
		return err
	}
	return addColumn("volumes", "publication_year", "TEXT DEFAULT ''")
}

// #13 migrateSeriesMetadataColumns series_metadata 테이블에 확장 메타데이터 컬럼 추가
func migrateSeriesMetadataColumns() error {
	if err := addColumn("series_metadata", "original_title", "TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("series_metadata", "publisher", "TEXT DEFAULT ''"); err != nil {
		return err
	}
	if err := addColumn("series_metadata", "published_at", "TEXT DEFAULT ''"); err != nil {
		return err
	}
	return addColumn("series_metadata", "isbn", "TEXT DEFAULT ''")
}

// #14 migrateChapterCompletions chapter_completions 테이블 추가
func migrateChapterCompletions() error {
	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS chapter_completions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
			completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			UNIQUE(user_id, chapter_id)
		)
	`); err != nil {
		return fmt.Errorf("create chapter_completions: %w", err)
	}

	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_chapter_completions_user ON chapter_completions(user_id)`); err != nil {
		return fmt.Errorf("create index chapter_completions(user_id): %w", err)
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_chapter_completions_chapter ON chapter_completions(chapter_id)`); err != nil {
		return fmt.Errorf("create index chapter_completions(chapter_id): %w", err)
	}

	return nil
}

// #15 migrateReadingTime reading_progress 테이블에 read_time_seconds 컬럼 추가
func migrateReadingTime() error {
	return addColumn("reading_progress", "read_time_seconds", "INTEGER DEFAULT 0")
}

// #16 migrateProgressToChapterBased 볼륨 기반 진행도를 챕터 기반으로 변경
func migrateProgressToChapterBased() error {
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_volume'`).Scan(&count); err != nil || count == 0 {
		return nil
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for chapter-based progress migration: %w", err)
	}
	defer func() { _ = conn.Close() }()

	if _, execErr := conn.ExecContext(ctx, `PRAGMA foreign_keys = OFF`); execErr != nil {
		return fmt.Errorf("disable foreign keys: %w", execErr)
	}
	defer func() { _, _ = conn.ExecContext(ctx, `PRAGMA foreign_keys = ON`) }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for chapter-based migration: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// 유실될 데이터 확인 (chapter_id IS NULL)
	var skippedCount int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM reading_progress WHERE chapter_id IS NULL").Scan(&skippedCount); err == nil && skippedCount > 0 {
		fmt.Printf("[Migration Warning] %d rows with NULL chapter_id will be skipped during migration.\n", skippedCount)
	}

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE reading_progress_new (
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
			read_time_seconds INTEGER DEFAULT 0,
			current_time REAL DEFAULT 0.0,
			duration REAL DEFAULT 0.0,
			UNIQUE(user_id, chapter_id)
		)
	`); err != nil {
		return fmt.Errorf("create reading_progress_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT OR IGNORE INTO reading_progress_new
		(id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, read_time_seconds, current_time, duration)
		SELECT
			id, user_id, series_id, volume_id, chapter_id,
			current_page, total_pages, progress_percent,
			device_id, device_name, updated_at, read_time_seconds, current_time, duration
		FROM reading_progress
		WHERE chapter_id IS NOT NULL
		ORDER BY updated_at DESC
	`); err != nil {
		return fmt.Errorf("copy data to reading_progress_new: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE reading_progress`); err != nil {
		return fmt.Errorf("drop old progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE reading_progress_new RENAME TO reading_progress`); err != nil {
		return fmt.Errorf("rename progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`); err != nil {
		return fmt.Errorf("recreate progress index (user): %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`); err != nil {
		return fmt.Errorf("recreate progress index (series): %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id)`); err != nil {
		return fmt.Errorf("recreate progress index (chapter): %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit chapter-based progress migration: %w", err)
	}

	return nil
}

// #17 migrateSessions 세션 테이블 생성 (기기별 로그인 관리)
func migrateSessions() error {
	if _, err := DB.Exec(`
		CREATE TABLE IF NOT EXISTS sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			refresh_token_hash TEXT NOT NULL,
			device_name TEXT DEFAULT '',
			device_type TEXT DEFAULT '',
			browser TEXT DEFAULT '',
			os TEXT DEFAULT '',
			ip_address TEXT DEFAULT '',
			last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			expires_at DATETIME NOT NULL
		)
	`); err != nil {
		return fmt.Errorf("create sessions table: %w", err)
	}

	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`); err != nil {
		return fmt.Errorf("create index sessions(user_id): %w", err)
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(refresh_token_hash)`); err != nil {
		return fmt.Errorf("create index sessions(refresh_token_hash): %w", err)
	}
	if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`); err != nil {
		return fmt.Errorf("create index sessions(expires_at): %w", err)
	}

	return nil
}

// #18 fixReadingProgressUniqueIndex 읽기 진행도 유니크 인덱스 수정 (Partial → Standard)
func fixReadingProgressUniqueIndex() error {
	var count int
	if err := DB.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_chapter'`).Scan(&count); err != nil || count == 0 {
		return nil
	}

	var indexSQL string
	if err := DB.QueryRow(`SELECT sql FROM sqlite_master WHERE type='index' AND name='idx_progress_unique_chapter'`).Scan(&indexSQL); err != nil {
		return nil
	}

	// WHERE 절이 없으면 이미 올바른 인덱스
	if !strings.Contains(strings.ToUpper(indexSQL), "WHERE") {
		return nil
	}

	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for fixing progress index: %w", err)
	}
	defer func() { _ = conn.Close() }()

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for fixing progress index: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `DROP INDEX IF EXISTS idx_progress_unique_chapter`); err != nil {
		return fmt.Errorf("drop idx_progress_unique_chapter: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `
		CREATE UNIQUE INDEX idx_progress_unique_chapter
		ON reading_progress(user_id, chapter_id)
	`); err != nil {
		return fmt.Errorf("create fixed idx_progress_unique_chapter: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit index fix: %w", err)
	}

	return nil
}

// #19 fixReadingProgressUniqueIndexV2 유니크 제약조건 수정 (Series → Chapter)
func fixReadingProgressUniqueIndexV2() error {
	ctx := context.Background()
	conn, err := DB.Conn(ctx)
	if err != nil {
		return fmt.Errorf("get connection for fixing progress unique index V2: %w", err)
	}
	defer func() { _ = conn.Close() }()

	// 현재 테이블의 유니크 인덱스 확인
	hasUniqueUserSeries := false

	indexRows, err := conn.QueryContext(ctx, "PRAGMA index_list('reading_progress')")
	if err != nil {
		return nil
	}

	for indexRows.Next() {
		var seq int
		var indexName string
		var unique int
		var origin string
		var partial int

		if scanErr := indexRows.Scan(&seq, &indexName, &unique, &origin, &partial); scanErr != nil {
			_ = indexRows.Close()
			return nil
		}

		if unique != 1 {
			continue
		}

		escapedName := strings.ReplaceAll(indexName, "'", "''")
		infoRows, queryErr := conn.QueryContext(ctx, fmt.Sprintf("PRAGMA index_info('%s')", escapedName))
		if queryErr != nil {
			_ = indexRows.Close()
			return nil
		}

		var cols []string
		for infoRows.Next() {
			var seqno, cid int
			var colName string
			if scanErr := infoRows.Scan(&seqno, &cid, &colName); scanErr != nil {
				_ = infoRows.Close()
				_ = indexRows.Close()
				return nil
			}
			cols = append(cols, colName)
		}
		_ = infoRows.Close()

		if len(cols) == 2 && cols[0] == "user_id" && cols[1] == "series_id" {
			hasUniqueUserSeries = true
			break
		}
	}
	_ = indexRows.Close()

	if !hasUniqueUserSeries {
		return nil
	}

	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for unique index fix V2: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE reading_progress_v3 (
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
			read_time_seconds INTEGER DEFAULT 0,
			current_time REAL DEFAULT 0.0,
			duration REAL DEFAULT 0.0,
			UNIQUE(user_id, chapter_id)
		)
	`); err != nil {
		return fmt.Errorf("create reading_progress_v3: %w", err)
	}

	// 유실될 데이터 확인
	var skippedCount int
	if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM reading_progress WHERE chapter_id IS NULL").Scan(&skippedCount); err == nil && skippedCount > 0 {
		fmt.Printf("[Migration V2 Warning] %d rows with NULL chapter_id will be skipped during unique index fix.\n", skippedCount)
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO reading_progress_v3 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, read_time_seconds, current_time, duration)
		SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, read_time_seconds, current_time, duration
		FROM reading_progress
		WHERE chapter_id IS NOT NULL
		ORDER BY updated_at DESC
		ON CONFLICT(user_id, chapter_id) DO NOTHING
	`); err != nil {
		return fmt.Errorf("copy data to reading_progress_v3: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `DROP TABLE reading_progress`); err != nil {
		return fmt.Errorf("drop old progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `ALTER TABLE reading_progress_v3 RENAME TO reading_progress`); err != nil {
		return fmt.Errorf("rename progress table: %w", err)
	}

	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id)`); err != nil {
		return fmt.Errorf("create user index: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id)`); err != nil {
		return fmt.Errorf("create series index: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `CREATE INDEX IF NOT EXISTS idx_progress_chapter ON reading_progress(chapter_id)`); err != nil {
		return fmt.Errorf("create chapter index: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit progress migration V2: %w", err)
	}

	return nil
}

// #20 migrateSwipeDirection 사용자별 시리즈 설정에 swipe_direction 컬럼 추가
func migrateSwipeDirection() error {
	return addColumn("user_series_settings", "swipe_direction", "TEXT")
}

// #21 migrateWheelDirection 사용자별 시리즈 설정에 wheel_direction 컬럼 추가
func migrateWheelDirection() error {
	return addColumn("user_series_settings", "wheel_direction", "TEXT")
}

// #22 migrateEpubCFI reading_progress 테이블에 current_cfi 컬럼 추가
func migrateEpubCFI() error {
	return addColumn("reading_progress", "current_cfi", "TEXT")
}

// #23 migrateEpubVirtualPositions EPUB 가상 포지션 관련 컬럼 추가
func migrateEpubVirtualPositions() error {
	if err := addColumn("chapters", "total_bytes", "INTEGER DEFAULT 0"); err != nil {
		return err
	}
	if err := addColumn("chapters", "total_positions", "INTEGER DEFAULT 0"); err != nil {
		return err
	}
	if err := addColumn("reading_progress", "current_position", "INTEGER DEFAULT 0"); err != nil {
		return err
	}
	return addColumn("reading_progress", "total_positions", "INTEGER DEFAULT 0")
}

// #24 migrateEpubRenderMode 사용자별 시리즈 설정에 epub_render_mode 컬럼 추가
func migrateEpubRenderMode() error {
	return addColumn("user_series_settings", "epub_render_mode", "TEXT")
}

// #25 migrateEpubSeriesSettings 사용자별 시리즈 설정에 EPUB 오버라이드 컬럼 추가
func migrateEpubSeriesSettings() error {
	if err := addColumn("user_series_settings", "epub_theme", "TEXT"); err != nil {
		return err
	}
	if err := addColumn("user_series_settings", "epub_spread", "TEXT"); err != nil {
		return err
	}
	if err := addColumn("user_series_settings", "epub_wheel_direction", "TEXT"); err != nil {
		return err
	}
	if err := addColumn("user_series_settings", "epub_keyboard_direction", "TEXT"); err != nil {
		return err
	}
	return addColumn("user_series_settings", "epub_click_direction", "TEXT")
}

// #26 migrateLibraryEpubDefaults libraries 테이블에 EPUB 기본값 컬럼 추가
func migrateLibraryEpubDefaults() error {
	if err := addColumn("libraries", "default_epub_render_mode", "TEXT DEFAULT 'auto'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_epub_theme", "TEXT DEFAULT 'light'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_epub_spread", "TEXT DEFAULT 'auto'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_epub_wheel_direction", "TEXT DEFAULT 'down'"); err != nil {
		return err
	}
	if err := addColumn("libraries", "default_epub_keyboard_direction", "TEXT DEFAULT 'right'"); err != nil {
		return err
	}
	return addColumn("libraries", "default_epub_click_direction", "TEXT DEFAULT 'right'")
}

// #27 migrateVolumesChapterCount volumes 테이블에 chapter_count 컬럼 추가
func migrateVolumesChapterCount() error {
	return addColumn("volumes", "chapter_count", "INTEGER DEFAULT 0")
}

// #28 migrateVolumesParentID volumes 테이블에 parent_id 컬럼 추가
func migrateVolumesParentID() error {
	if !columnExists("volumes", "parent_id") {
		if _, err := DB.Exec(`ALTER TABLE volumes ADD COLUMN parent_id TEXT REFERENCES volumes(id) ON DELETE CASCADE`); err != nil {
			return fmt.Errorf("add volumes.parent_id: %w", err)
		}
		if _, err := DB.Exec(`CREATE INDEX IF NOT EXISTS idx_volumes_parent ON volumes(parent_id)`); err != nil {
			return fmt.Errorf("create index volumes(parent_id): %w", err)
		}
	}
	return nil
}

// #29 migrateVolumesExtension volumes 테이블에 extension 컬럼 추가
func migrateVolumesExtension() error {
	return addColumn("volumes", "extension", "TEXT DEFAULT ''")
}

// #30 migrateSeriesExtension series 테이블에 extension 컬럼 추가
func migrateSeriesExtension() error {
	return addColumn("series", "extension", "TEXT DEFAULT ''")
}

// #31 migrateProgressRestorePosition reading_progress 테이블에 anchor_page, offset_ratio 컬럼 추가
func migrateProgressRestorePosition() error {
	if err := addColumn("reading_progress", "anchor_page", "INTEGER"); err != nil {
		return err
	}
	return addColumn("reading_progress", "offset_ratio", "REAL")
}

// #32 migrateChaptersHasAudio chapters 테이블에 has_audio 컬럼 추가
func migrateChaptersHasAudio() error {
	return addColumn("chapters", "has_audio", "BOOLEAN DEFAULT 0")
}

// #33 migrateAudiobookColumns 오디오북 관련 컬럼들을 각 테이블에 추가
func migrateAudiobookColumns() error {
	if err := addColumn("libraries", "library_type", "TEXT DEFAULT 'book'"); err != nil {
		return err
	}
	if err := addColumn("chapters", "duration", "REAL"); err != nil {
		return err
	}
	if err := addColumn("reading_progress", "current_time", "REAL DEFAULT 0.0"); err != nil {
		return err
	}
	return addColumn("reading_progress", "duration", "REAL DEFAULT 0.0")
}

// #34 migrateAudioProgressTimeFormat reading_progress.current_time/duration의 문자열 시간값을 초 단위 숫자로 정규화
func migrateAudioProgressTimeFormat() error {
	if !columnExists("reading_progress", "current_time") && !columnExists("reading_progress", "duration") {
		return nil
	}

	ctx := context.Background()
	tx, err := DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("start transaction for audio progress time normalize: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	rows, err := tx.QueryContext(ctx, `
		SELECT id, "current_time", "duration"
		FROM reading_progress
		WHERE typeof("current_time") = 'text' OR typeof("duration") = 'text'
	`)
	if err != nil {
		return fmt.Errorf("query legacy audio time rows: %w", err)
	}
	defer func() { _ = rows.Close() }()

	for rows.Next() {
		var id string
		var rawCurrentTime interface{}
		var rawDuration interface{}
		if err := rows.Scan(&id, &rawCurrentTime, &rawDuration); err != nil {
			return fmt.Errorf("scan legacy audio time row: %w", err)
		}

		if parsed, ok := parseLegacyTimeToSeconds(rawCurrentTime); ok {
			if _, err := tx.ExecContext(ctx, `UPDATE reading_progress SET current_time = ? WHERE id = ?`, parsed, id); err != nil {
				return fmt.Errorf("normalize current_time for %s: %w", id, err)
			}
		}
		if parsed, ok := parseLegacyTimeToSeconds(rawDuration); ok {
			if _, err := tx.ExecContext(ctx, `UPDATE reading_progress SET duration = ? WHERE id = ?`, parsed, id); err != nil {
				return fmt.Errorf("normalize duration for %s: %w", id, err)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate legacy audio time rows: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit audio progress time normalize: %w", err)
	}

	return nil
}

// parseLegacyTimeToSeconds 문자열 시간(HH:MM:SS, MM:SS)을 초 단위 float64로 변환
func parseLegacyTimeToSeconds(value interface{}) (float64, bool) {
	var raw string
	switch v := value.(type) {
	case nil:
		return 0, false
	case string:
		raw = strings.TrimSpace(v)
	case []byte:
		raw = strings.TrimSpace(string(v))
	default:
		return 0, false
	}

	if raw == "" {
		return 0, false
	}

	// 이미 숫자 문자열인 경우 그대로 사용
	if num, err := strconv.ParseFloat(raw, 64); err == nil {
		return num, true
	}

	parts := strings.Split(raw, ":")
	if len(parts) != 2 && len(parts) != 3 {
		return 0, false
	}

	parseInt := func(s string) (int64, bool) {
		n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
		if err != nil || n < 0 {
			return 0, false
		}
		return n, true
	}

	secondsPart, err := strconv.ParseFloat(strings.TrimSpace(parts[len(parts)-1]), 64)
	if err != nil || secondsPart < 0 {
		return 0, false
	}

	if len(parts) == 2 {
		minutes, ok := parseInt(parts[0])
		if !ok {
			return 0, false
		}
		return float64(minutes*60) + secondsPart, true
	}

	hours, ok := parseInt(parts[0])
	if !ok {
		return 0, false
	}
	minutes, ok := parseInt(parts[1])
	if !ok {
		return 0, false
	}
	return float64(hours*3600+minutes*60) + secondsPart, true
}
