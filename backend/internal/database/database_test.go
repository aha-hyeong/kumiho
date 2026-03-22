package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func openRawTestDB(t *testing.T) string {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	db, err := sql.Open("sqlite3", dbPath+"?_foreign_keys=on&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
		t.Fatalf("sql.Open() error = %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("db.Ping() error = %v", err)
	}

	DB = db
	t.Cleanup(func() {
		if err := Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		DB = nil
	})

	return dbPath
}

func objectExists(t *testing.T, objectType, objectName string) bool {
	t.Helper()

	var count int
	err := DB.QueryRow(
		`SELECT COUNT(*) FROM sqlite_master WHERE type = ? AND name = ?`,
		objectType,
		objectName,
	).Scan(&count)
	if err != nil {
		t.Fatalf("objectExists(%s, %s) query error = %v", objectType, objectName, err)
	}

	return count > 0
}

func TestConnectFreshDatabaseCreatesMigrationArtifacts(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := Connect(dbPath); err != nil {
		t.Fatalf("Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := Close(); err != nil {
			t.Fatalf("Close() error = %v", err)
		}
		DB = nil
	})

	if !objectExists(t, "table", "sessions") {
		t.Fatal("sessions table was not created")
	}
	if !objectExists(t, "index", "idx_sessions_token_hash") {
		t.Fatal("idx_sessions_token_hash index was not created")
	}
	if !objectExists(t, "table", "libraries") {
		t.Fatal("libraries table was not created")
	}

	var systemLikesCount int
	err := DB.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = 'system-likes' AND type = 'SYSTEM'`).Scan(&systemLikesCount)
	if err != nil {
		t.Fatalf("count system-likes library error = %v", err)
	}
	if systemLikesCount != 1 {
		t.Fatalf("system-likes count = %d, want 1", systemLikesCount)
	}

	if got := getMigrationVersion(); got != latestMigrationVersion {
		t.Fatalf("getMigrationVersion() = %d, want %d", got, latestMigrationVersion)
	}
}

func TestMigrateLegacyDatabaseWithoutVersionRunsPendingMigration(t *testing.T) {
	openRawTestDB(t)

	_, err := DB.Exec(`
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

		CREATE TABLE reading_progress (
			id TEXT PRIMARY KEY,
			user_id TEXT NOT NULL,
			series_id TEXT NOT NULL,
			chapter_id TEXT,
			current_time REAL DEFAULT 0,
			duration REAL DEFAULT 0
		);
	`)
	if err != nil {
		t.Fatalf("seed legacy schema error = %v", err)
	}

	_, err = DB.Exec(
		`INSERT INTO reading_progress (id, user_id, series_id, chapter_id, current_time, duration) VALUES (?, ?, ?, ?, ?, ?)`,
		"progress-1",
		"user-1",
		"series-1",
		"chapter-1",
		"01:02:03",
		"02:00",
	)
	if err != nil {
		t.Fatalf("insert legacy reading_progress error = %v", err)
	}

	err = Migrate()
	if err != nil {
		t.Fatalf("Migrate() error = %v", err)
	}

	if got := getMigrationVersion(); got != latestMigrationVersion {
		t.Fatalf("getMigrationVersion() = %d, want %d", got, latestMigrationVersion)
	}

	var currentTime float64
	var duration float64
	err = DB.QueryRow(
		`SELECT "current_time", "duration" FROM reading_progress WHERE id = ?`,
		"progress-1",
	).Scan(&currentTime, &duration)
	if err != nil {
		t.Fatalf("select normalized reading_progress error = %v", err)
	}

	if currentTime != 3723 {
		t.Fatalf("current_time = %v, want 3723", currentTime)
	}
	if duration != 120 {
		t.Fatalf("duration = %v, want 120", duration)
	}

	var textValueCount int
	err = DB.QueryRow(
		`SELECT COUNT(*) FROM reading_progress WHERE typeof("current_time") = 'text' OR typeof("duration") = 'text'`,
	).Scan(&textValueCount)
	if err != nil {
		t.Fatalf("count text reading_progress rows error = %v", err)
	}
	if textValueCount != 0 {
		t.Fatalf("textValueCount = %d, want 0", textValueCount)
	}

	var systemLikesCount int
	err = DB.QueryRow(`SELECT COUNT(*) FROM libraries WHERE id = 'system-likes' AND type = 'SYSTEM'`).Scan(&systemLikesCount)
	if err != nil {
		t.Fatalf("count legacy system-likes library error = %v", err)
	}
	if systemLikesCount != 1 {
		t.Fatalf("legacy system-likes count = %d, want 1", systemLikesCount)
	}
}

func TestConnectRepairsSystemLikesLibrary(t *testing.T) {
	openRawTestDB(t)

	_, err := DB.Exec(`
		CREATE TABLE libraries (
			id TEXT PRIMARY KEY,
			name TEXT NOT NULL DEFAULT '',
			path TEXT NOT NULL DEFAULT '',
			type TEXT DEFAULT 'LOCAL',
			library_type TEXT DEFAULT 'book',
			is_visible BOOLEAN DEFAULT 1,
			default_view_mode TEXT DEFAULT 'single',
			default_read_direction TEXT DEFAULT 'ltr',
			default_page_transition TEXT DEFAULT 'slide',
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			sort_order INTEGER DEFAULT 0
		)
	`)
	if err != nil {
		t.Fatalf("create libraries table error = %v", err)
	}

	_, err = DB.Exec(`
		INSERT INTO libraries (id, name, path, type, library_type, is_visible, default_view_mode, default_read_direction, default_page_transition, sort_order)
		VALUES ('system-likes', '깨진 좋아요', '/wrong/path', 'LOCAL', 'audiobook', 0, 'double', 'rtl', 'fade', 99)
	`)
	if err != nil {
		t.Fatalf("insert broken system-likes error = %v", err)
	}

	err = ensureSystemLikesLibrary()
	if err != nil {
		t.Fatalf("ensureSystemLikesLibrary() error = %v", err)
	}

	var name, path, libType, libraryType, viewMode, readDirection, pageTransition string
	var isVisible bool
	err = DB.QueryRow(`
		SELECT name, path, type, library_type, is_visible, default_view_mode, default_read_direction, default_page_transition
		FROM libraries WHERE id = 'system-likes'
	`).Scan(&name, &path, &libType, &libraryType, &isVisible, &viewMode, &readDirection, &pageTransition)
	if err != nil {
		t.Fatalf("select repaired system-likes error = %v", err)
	}

	if name != "좋아요한 시리즈" || path != "SYSTEM://LIKES" || libType != "SYSTEM" || libraryType != "book" ||
		!isVisible || viewMode != "single" || readDirection != "ltr" || pageTransition != "slide" {
		t.Fatalf("system-likes not repaired correctly: got (%s, %s, %s, %s, %t, %s, %s, %s)",
			name, path, libType, libraryType, isVisible, viewMode, readDirection, pageTransition)
	}
}
