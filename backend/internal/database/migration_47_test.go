package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestSeriesCoverPageMigration(t *testing.T) {
	var err error
	DB, err = sql.Open("sqlite3", filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = DB.Close(); DB = nil })
	exec := func(query string) {
		t.Helper()
		if _, err := DB.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TABLE series(id TEXT PRIMARY KEY, thumbnail_path TEXT, thumbnail_version INTEGER, last_content_updated_at TEXT);
		CREATE TABLE volumes(id TEXT PRIMARY KEY, series_id TEXT, volume_number INTEGER, thumbnail_version INTEGER);
		INSERT INTO series VALUES ('s', '/custom.jpg', 7, 'original')`)
	check := func(want sql.NullString) {
		t.Helper()
		var id sql.NullString
		var path, stamp string
		var version int
		if err := DB.QueryRow(`SELECT cover_page_id, thumbnail_path, thumbnail_version, last_content_updated_at FROM series`).Scan(&id, &path, &version, &stamp); err != nil {
			t.Fatal(err)
		}
		if id != want || path != "/custom.jpg" || version != 7 || stamp != "original" {
			t.Fatalf("unexpected migrated row: %v %s %d %s", id, path, version, stamp)
		}
	}
	if err := migrateSeriesCoverPage(); err != nil {
		t.Fatal(err)
	}
	check(sql.NullString{})
	exec(`UPDATE series SET cover_page_id='page'`)
	if err := migrateSeriesCoverPage(); err != nil {
		t.Fatal(err)
	}
	check(sql.NullString{String: "page", Valid: true})
	exec(`UPDATE series SET last_content_updated_at='original'`)
	check(sql.NullString{})
}
