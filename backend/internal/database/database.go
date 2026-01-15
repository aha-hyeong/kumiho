package database

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "github.com/mattn/go-sqlite3"
)

var DB *sql.DB

// Connect 데이터베이스 연결
func Connect(dbPath string) error {
	// 디렉토리 생성
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create database directory: %w", err)
	}

	var err error
	DB, err = sql.Open("sqlite3", dbPath+"?_foreign_keys=on")
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
		username TEXT UNIQUE NOT NULL,
		email TEXT UNIQUE NOT NULL,
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
		status TEXT DEFAULT 'ONGOING',
		authors TEXT DEFAULT '',
		tags TEXT DEFAULT '',
		is_bookmarked BOOLEAN DEFAULT 0,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

	-- 읽기 진행도
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

	-- 인덱스
	CREATE INDEX IF NOT EXISTS idx_series_library ON series(library_id);
	CREATE INDEX IF NOT EXISTS idx_volumes_series ON volumes(series_id);
	CREATE INDEX IF NOT EXISTS idx_chapters_volume ON chapters(volume_id);
	CREATE INDEX IF NOT EXISTS idx_pages_chapter ON pages(chapter_id);
	CREATE INDEX IF NOT EXISTS idx_progress_user ON reading_progress(user_id);
	CREATE INDEX IF NOT EXISTS idx_progress_series ON reading_progress(series_id);
	`

	if _, err := DB.Exec(schema); err != nil {
		return err
	}

	// 마이그레이션: 기존 series 테이블에 컬럼이 없을 경우 추가
	migrations := []string{
		`ALTER TABLE series ADD COLUMN description TEXT DEFAULT ''`,
		`ALTER TABLE series ADD COLUMN status TEXT DEFAULT 'ONGOING'`,
		`ALTER TABLE series ADD COLUMN authors TEXT DEFAULT ''`,
		`ALTER TABLE series ADD COLUMN tags TEXT DEFAULT ''`,
		`ALTER TABLE series ADD COLUMN is_bookmarked BOOLEAN DEFAULT 0`,
	}

	for _, query := range migrations {
		// 이미 컬럼이 존재하면 에러가 발생하지만, SQLite에서는 IF NOT EXISTS가 없으므로 무시
		DB.Exec(query)
	}

	return nil
}
