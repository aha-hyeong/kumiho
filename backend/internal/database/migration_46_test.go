package database

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestThumbnailVersionMigrationPreservesContentTimes(t *testing.T) {
	var err error
	DB, err = sql.Open("sqlite3", filepath.Join(t.TempDir(), "legacy.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = DB.Close(); DB = nil })
	for _, table := range []string{"series", "volumes"} {
		if _, err := DB.Exec(`CREATE TABLE ` + table + ` (id TEXT PRIMARY KEY, title TEXT, thumbnail_path TEXT, updated_at TEXT, last_content_updated_at TEXT);
   INSERT INTO ` + table + ` VALUES ('s','title','/cover.jpg','old-update','old-content')`); err != nil {
			t.Fatal(err)
		}
	}
	if err := migrateThumbnailVersions(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"series", "volumes"} {
		var version int
		if err := DB.QueryRow(`SELECT thumbnail_version FROM ` + table).Scan(&version); err != nil || version != 0 {
			t.Fatalf("%s initial version=%d err=%v", table, version, err)
		}
		// Metadata updates write thumbnail_path as an unchanged SET value;
		// only actual path changes should trigger an automatic bump.
		if _, err := DB.Exec(`UPDATE ` + table + ` SET title='renamed', thumbnail_path='/cover.jpg' WHERE id='s'`); err != nil {
			t.Fatal(err)
		}
		if err := DB.QueryRow(`SELECT thumbnail_version FROM ` + table).Scan(&version); err != nil || version != 0 {
			t.Fatalf("%s unchanged path version=%d err=%v", table, version, err)
		}
		for _, path := range []any{"/other.jpg", nil, "/cover.jpg"} {
			if _, err := DB.Exec(`UPDATE `+table+` SET thumbnail_path=? WHERE id='s'`, path); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := DB.Exec(`UPDATE ` + table + ` SET title='new title' WHERE id='s'`); err != nil {
			t.Fatal(err)
		}
		var updated, content string
		if err := DB.QueryRow(`SELECT thumbnail_version,updated_at,last_content_updated_at FROM `+table).Scan(&version, &updated, &content); err != nil {
			t.Fatal(err)
		}
		if version != 3 || updated != "old-update" || content != "old-content" {
			t.Fatalf("%s version=%d times=%s/%s", table, version, updated, content)
		}
	}
	if err := migrateThumbnailVersions(); err != nil {
		t.Fatal(err)
	}
	for _, table := range []string{"series", "volumes"} {
		var version int
		if err := DB.QueryRow(`SELECT thumbnail_version FROM ` + table).Scan(&version); err != nil || version != 3 {
			t.Fatalf("rerun %s version=%d err=%v", table, version, err)
		}
		tx, err := DB.Begin()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(`UPDATE ` + table + ` SET thumbnail_path='/rolled-back.jpg'`); err != nil {
			t.Fatal(err)
		}
		if err := tx.Rollback(); err != nil {
			t.Fatal(err)
		}
		if err := DB.QueryRow(`SELECT thumbnail_version FROM ` + table).Scan(&version); err != nil || version != 3 {
			t.Fatalf("rollback %s version=%d err=%v", table, version, err)
		}
	}
}
