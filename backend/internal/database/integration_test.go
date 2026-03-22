package database_test

import (
	"database/sql"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

func connectTestDB(t *testing.T) {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("database.Close() error = %v", err)
		}
		database.DB = nil
	})
}

func seedLibraryAndChapter(t *testing.T) (seriesID, volumeID, chapterID string) {
	t.Helper()

	seriesID = "test-series-1"
	volumeID = "test-volume-1"
	chapterID = "test-chapter-1"

	tx, err := database.DB.Begin()
	if err != nil {
		t.Fatalf("begin transaction error = %v", err)
	}

	if _, err := tx.Exec(`INSERT INTO libraries (id, name, path) VALUES ('test-lib', 'Test Library', '/tmp/test')`); err != nil {
		_ = tx.Rollback()
		t.Fatalf("seed library error = %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO series (id, library_id, title, path) VALUES (?, 'test-lib', 'Test Series', '/tmp/test/series')`, seriesID); err != nil {
		_ = tx.Rollback()
		t.Fatalf("seed series error = %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO volumes (id, series_id, title, volume_number, path) VALUES (?, ?, 'Test Volume', 1, '/tmp/test/series/vol1')`, volumeID, seriesID); err != nil {
		_ = tx.Rollback()
		t.Fatalf("seed volume error = %v", err)
	}
	if _, err := tx.Exec(`INSERT INTO chapters (id, volume_id, title, chapter_number, path) VALUES (?, ?, 'Test Chapter', 1, '/tmp/test/series/vol1/ch1.cbz')`, chapterID, volumeID); err != nil {
		_ = tx.Rollback()
		t.Fatalf("seed chapter error = %v", err)
	}

	if err := tx.Commit(); err != nil {
		t.Fatalf("commit transaction error = %v", err)
	}

	return
}

// TestFreshDatabaseAllowsAdminRegistrationAndProgressTracking 은
// 빈 DB → 마이그레이션 → 관리자 등록 → 진행도 저장/조회 전체 플로우를 검증한다.
// 마이그레이션이 sessions/reading_progress 등의 스키마를 변경할 때
// 후속 서비스 로직이 깨지는 것을 방어한다.
func TestFreshDatabaseAllowsAdminRegistrationAndProgressTracking(t *testing.T) {
	connectTestDB(t)

	// 1. 관리자 등록
	authService := service.NewAuthService(
		repository.NewUserRepository(),
		repository.NewSessionRepository(),
		&config.Config{JWTSecret: "test-secret"},
	)

	tokens, err := authService.Register(&service.RegisterRequest{
		Username: "admin",
		Nickname: "관리자",
		Password: "password123",
	}, &service.LoginContext{
		UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
		IPAddress: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}
	if tokens.User.Role != model.RoleMaster {
		t.Fatalf("Register() role = %s, want %s", tokens.User.Role, model.RoleMaster)
	}

	// 2. 테스트 데이터 준비
	seriesID, volumeID, chapterID := seedLibraryAndChapter(t)

	// 3. 진행도 저장
	progressRepo := repository.NewReadingProgressRepository()
	err = progressRepo.Upsert(nil, &model.ReadingProgress{
		UserID:          tokens.User.ID,
		SeriesID:        seriesID,
		VolumeID:        &volumeID,
		ChapterID:       &chapterID,
		CurrentPage:     5,
		TotalPages:      20,
		ProgressPercent: 25.0,
	})
	if err != nil {
		t.Fatalf("Upsert() error = %v", err)
	}

	// 4. 진행도 조회
	progress, err := progressRepo.FindByUserAndChapter(nil, tokens.User.ID, chapterID)
	if err != nil {
		t.Fatalf("FindByUserAndChapter() error = %v", err)
	}
	if progress == nil {
		t.Fatal("FindByUserAndChapter() returned nil")
	}
	if progress.CurrentPage != 5 {
		t.Fatalf("CurrentPage = %d, want 5", progress.CurrentPage)
	}
	if progress.TotalPages != 20 {
		t.Fatalf("TotalPages = %d, want 20", progress.TotalPages)
	}
	if progress.ProgressPercent != 25.0 {
		t.Fatalf("ProgressPercent = %f, want 25.0", progress.ProgressPercent)
	}
}

// TestMigratedDatabasePreservesExistingProgress 는
// 기존 데이터가 있는 DB에 마이그레이션을 실행했을 때
// reading_progress 데이터가 유실되지 않는 것을 검증한다.
func TestMigratedDatabasePreservesExistingProgress(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	// foreign key 끈 상태로 레거시 데이터 삽입
	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=off&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	dbClosed := false
	t.Cleanup(func() {
		if !dbClosed {
			_ = db.Close()
		}
	})

	_, err = db.Exec(`
		CREATE TABLE server_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);

		CREATE TABLE libraries (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			path TEXT NOT NULL DEFAULT '',
			type TEXT DEFAULT 'LOCAL',
			is_visible BOOLEAN DEFAULT 1,
			default_view_mode TEXT DEFAULT 'single',
			default_read_direction TEXT DEFAULT 'ltr',
			default_page_transition TEXT DEFAULT 'slide',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			sort_order INTEGER DEFAULT 0,
			library_type TEXT DEFAULT 'book'
		);

		CREATE TABLE users (
			id TEXT PRIMARY KEY,
			can_download BOOLEAN DEFAULT 0
		);

		CREATE TABLE sessions (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			refresh_token_hash TEXT NOT NULL DEFAULT '',
			expires_at DATETIME NOT NULL
		);

		CREATE TABLE series (
			id TEXT PRIMARY KEY,
			library_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			folder_path TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE volumes (
			id TEXT PRIMARY KEY,
			series_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			folder_path TEXT NOT NULL DEFAULT ''
		);

		CREATE TABLE chapters (
			id TEXT PRIMARY KEY,
			volume_id TEXT NOT NULL,
			title TEXT NOT NULL DEFAULT '',
			file_path TEXT NOT NULL DEFAULT '',
			chapter_number INTEGER DEFAULT 0
		);

		CREATE TABLE reading_progress (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			series_id TEXT NOT NULL,
			chapter_id TEXT,
			current_page INTEGER DEFAULT 0,
			total_pages INTEGER DEFAULT 0,
			progress_percent REAL DEFAULT 0,
			current_time REAL DEFAULT 0,
			duration REAL DEFAULT 0
		);
	`)
	if err != nil {
		t.Fatalf("seed legacy schema error = %v", err)
	}

	// 2. 여러 건의 진행도 데이터 삽입 (current_time/duration 포함)
	type testProgress struct {
		id              string
		userID          string
		seriesID        string
		chapterID       string
		currentPage     int
		totalPages      int
		progressPercent float64
		currentTime     float64
		duration        float64
	}

	testData := []testProgress{
		{"p1", "user-1", "series-1", "chapter-1", 10, 100, 10.0, 0, 0},
		{"p2", "user-1", "series-1", "chapter-2", 50, 200, 25.0, 123.5, 300.0},
		{"p3", "user-1", "series-2", "chapter-3", 75, 75, 100.0, 0, 0},
		{"p4", "user-2", "series-1", "chapter-1", 30, 100, 30.0, 45.0, 120.0},
		{"p5", "user-2", "series-3", "chapter-4", 1, 500, 0.2, 0, 0},
	}

	_, err = db.Exec(`INSERT INTO users (id) VALUES ('user-1'), ('user-2')`)
	if err != nil {
		t.Fatalf("insert users error = %v", err)
	}

	for _, tp := range testData {
		_, err = db.Exec(
			`INSERT INTO reading_progress (id, user_id, series_id, chapter_id, current_page, total_pages, progress_percent, "current_time", duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			tp.id, tp.userID, tp.seriesID, tp.chapterID, tp.currentPage, tp.totalPages, tp.progressPercent, tp.currentTime, tp.duration,
		)
		if err != nil {
			t.Fatalf("insert reading_progress %s error = %v", tp.id, err)
		}
	}

	// database.Connect 전에 명시적으로 닫아야 lock 방지
	if closeErr := db.Close(); closeErr != nil {
		t.Fatalf("db.Close() before Connect error = %v", closeErr)
	}
	dbClosed = true

	// 3. Connect 호출 (마이그레이션 실행)
	err = database.Connect(dbPath)
	if err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if closeErr := database.Close(); closeErr != nil {
			t.Errorf("database.Close() error = %v", closeErr)
		}
		database.DB = nil
	})

	// 4. 전체 건수 보존 확인
	var count int
	err = database.DB.QueryRow(`SELECT COUNT(*) FROM reading_progress`).Scan(&count)
	if err != nil {
		t.Fatalf("count reading_progress error = %v", err)
	}
	if count != len(testData) {
		t.Fatalf("reading_progress count = %d, want %d", count, len(testData))
	}

	// 5. 각 진행도의 주요 필드 보존 확인 (current_time/duration 포함)
	for _, tp := range testData {
		var currentPage, totalPages int
		var progressPercent, currentTime, duration float64
		err = database.DB.QueryRow(
			`SELECT current_page, total_pages, progress_percent, "current_time", duration FROM reading_progress WHERE user_id = ? AND chapter_id = ?`,
			tp.userID, tp.chapterID,
		).Scan(&currentPage, &totalPages, &progressPercent, &currentTime, &duration)
		if err != nil {
			t.Fatalf("select progress for user=%s chapter=%s error = %v", tp.userID, tp.chapterID, err)
		}
		if currentPage != tp.currentPage {
			t.Fatalf("user=%s chapter=%s current_page = %d, want %d", tp.userID, tp.chapterID, currentPage, tp.currentPage)
		}
		if totalPages != tp.totalPages {
			t.Fatalf("user=%s chapter=%s total_pages = %d, want %d", tp.userID, tp.chapterID, totalPages, tp.totalPages)
		}
		if progressPercent != tp.progressPercent {
			t.Fatalf("user=%s chapter=%s progress_percent = %f, want %f", tp.userID, tp.chapterID, progressPercent, tp.progressPercent)
		}
		if currentTime != tp.currentTime {
			t.Fatalf("user=%s chapter=%s current_time = %f, want %f", tp.userID, tp.chapterID, currentTime, tp.currentTime)
		}
		if duration != tp.duration {
			t.Fatalf("user=%s chapter=%s duration = %f, want %f", tp.userID, tp.chapterID, duration, tp.duration)
		}
	}
}
