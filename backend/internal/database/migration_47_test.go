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
		CREATE TABLE chapters(id TEXT PRIMARY KEY, volume_id TEXT, chapter_number INTEGER);
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

func TestSeriesCoverPageOrderTriggers(t *testing.T) {
	if err := Connect(filepath.Join(t.TempDir(), "order.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = Close(); DB = nil })
	exec := func(query string) {
		t.Helper()
		if _, err := DB.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO libraries(id,name,type) VALUES ('lib','Books','LOCAL');
		INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES
			('auto','lib','Auto','/auto',''), ('saved','lib','Saved','/saved','/cover.jpg');
		INSERT INTO volumes(id,series_id,title,path,volume_number) VALUES
			('v','auto','V','/v',1), ('w','saved','W','/w',1);
		INSERT INTO chapters(id,volume_id,title,path,chapter_number) VALUES ('c','v','C','/c',1)`)
	for _, tc := range []struct {
		query       string
		auto, saved bool // whether each series should forget its cached page
	}{
		{"UPDATE volumes SET volume_number=1, series_id='auto' WHERE id='v'", false, false},
		{"UPDATE chapters SET chapter_number=1, volume_id='v' WHERE id='c'", false, false},
		{"UPDATE volumes SET volume_number=2 WHERE id='v'", true, false},
		{"UPDATE chapters SET chapter_number=2 WHERE id='c'", true, false},
		{"UPDATE chapters SET volume_id='w' WHERE id='c'", true, true},
		{"UPDATE volumes SET series_id='saved' WHERE id='v'", true, true},
	} {
		exec("UPDATE series SET cover_page_id='remembered', thumbnail_version=7")
		exec(tc.query)
		for id, invalidate := range map[string]bool{"auto": tc.auto, "saved": tc.saved} {
			var page sql.NullString
			var version int
			if err := DB.QueryRow("SELECT cover_page_id, thumbnail_version FROM series WHERE id=?", id).Scan(&page, &version); err != nil {
				t.Fatal(err)
			}
			wantVersion := 7
			if id == "auto" && invalidate {
				wantVersion++
			}
			if page.Valid == invalidate || (page.Valid && page.String != "remembered") || version != wantVersion {
				t.Fatalf("%s: %s page=%v version=%d (invalidate=%t, want version %d)", tc.query, id, page, version, invalidate, wantVersion)
			}
		}
	}
}
