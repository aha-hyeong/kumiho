package repository

import (
	"database/sql"
	"path/filepath"
	"reflect"
	"slices"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func seedReadingProgressQueries(t *testing.T) {
	t.Helper()
	connectSeriesRepositoryTestDB(t)
	homeExec(t, `INSERT INTO libraries(id, name, type, library_type) VALUES ('lib', 'Library', 'LOCAL', 'book')`)
	homeExec(t, `INSERT INTO users(id, username, nickname, password_hash, role) VALUES
		('reader', 'reader', 'Reader', 'hash', 'USER'), ('other', 'other', 'Other', 'hash', 'USER')`)
	homeExec(t, `INSERT INTO series(id, library_id, title, path) VALUES
		('series', 'lib', 'Series', '/series'), ('other-series', 'lib', 'Other', '/other')`)
	homeExec(t, `INSERT INTO volumes(id, series_id, title, volume_number, path, parent_id) VALUES
		('root', 'series', 'Root', 1, '/root', NULL),
		('child', 'series', 'Child', 2, '/child', 'root'),
		('grandchild', 'series', 'Grandchild', 3, '/grandchild', 'child'),
		('sibling', 'series', 'Sibling', 4, '/sibling', NULL),
		('outside', 'other-series', 'Outside', 5, '/outside', NULL)`)
	homeExec(t, `INSERT INTO chapters(id, volume_id, title, chapter_number, path) VALUES
		('c-root', 'root', 'Root', 1, '/c-root'),
		('c-child', 'child', 'Child', 2, '/c-child'),
		('c-grandchild', 'grandchild', 'Grandchild', 3, '/c-grandchild'),
		('c-sibling', 'sibling', 'Sibling', 4, '/c-sibling'),
		('c-outside', 'outside', 'Outside', 5, '/c-outside')`)
}

func TestReadingProgressQueriesPreserveNullableColumns(t *testing.T) {
	for _, name := range []string{"null", "zero", "populated"} {
		t.Run(name, func(t *testing.T) {
			seedReadingProgressQueries(t)
			chapterID, volumeID := "c-root", "root"
			updated := time.Date(2026, time.October, 1, 12, 30, 0, 0, time.UTC)
			want := model.ReadingProgress{
				ID: "progress", UserID: "reader", SeriesID: "series", ChapterID: &chapterID,
				CurrentPage: 7, AnchorPage: 7, TotalPages: 31,
				CurrentPosition: 23, TotalPositions: 97, ProgressPercent: 29.25, UpdatedAt: updated,
			}
			var anchor, offset any
			if name != "null" {
				want.VolumeID = &volumeID
				deviceID, deviceName, cfi := "", "", ""
				currentTime, duration := 0.0, 0.0
				want.AnchorPage = 0
				if name == "populated" {
					deviceID, deviceName, cfi = "device-id", "Reader device", "epubcfi(/6/2!/4/2)"
					currentTime, duration = 12.5, 48.75
					want.AnchorPage, want.OffsetRatio = 5, 0.25
				}
				want.DeviceID, want.DeviceName, want.CurrentCFI = &deviceID, &deviceName, &cfi
				want.CurrentTime, want.Duration = &currentTime, &duration
				anchor, offset = want.AnchorPage, want.OffsetRatio
			}
			homeExec(t, `INSERT INTO reading_progress
				(id, user_id, series_id, volume_id, chapter_id, current_page, anchor_page, offset_ratio, total_pages,
				 current_position, total_positions, "current_time", duration, progress_percent, device_id, device_name, current_cfi, updated_at, read_time_seconds)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 99)`,
				want.ID, want.UserID, want.SeriesID, want.VolumeID, want.ChapterID, want.CurrentPage, anchor, offset,
				want.TotalPages, want.CurrentPosition, want.TotalPositions, want.CurrentTime, want.Duration,
				want.ProgressPercent, want.DeviceID, want.DeviceName, want.CurrentCFI, want.UpdatedAt)

			repo := NewReadingProgressRepository()
			one, err := repo.FindByUserAndSeries(nil, "reader", "series")
			if err != nil || one == nil || !reflect.DeepEqual(*one, want) {
				t.Fatalf("FindByUserAndSeries = %+v, %v; want %+v", one, err, want)
			}
			for method, query := range map[string]func() ([]model.ReadingProgress, error){
				"FindByUser":             func() ([]model.ReadingProgress, error) { return repo.FindByUser(nil, "reader") },
				"FindByUserAndVolume":    func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(nil, "reader", "root") },
				"FindByUserAndSeriesAll": func() ([]model.ReadingProgress, error) { return repo.FindByUserAndSeriesAll(nil, "reader", "series") },
			} {
				got, err := query()
				if err != nil || !reflect.DeepEqual(got, []model.ReadingProgress{want}) {
					t.Fatalf("%s = %+v, %v; want %+v", method, got, err, want)
				}
			}
		})
	}
}

func TestReadingProgressQueriesPreserveSelection(t *testing.T) {
	seedReadingProgressQueries(t)
	for _, row := range []struct {
		id, user, series, volume, chapter string
		day, percent                      int
	}{
		{"root", "reader", "series", "root", "c-root", 1, 30},
		{"child", "reader", "series", "child", "c-child", 1, 60},
		// Volume/series-all filter through chapters, not progress's volume_id/series_id.
		{"grandchild", "reader", "other-series", "outside", "c-grandchild", 2, 50},
		{"sibling", "reader", "series", "sibling", "c-sibling", 3, 100},
		{"outside", "reader", "other-series", "outside", "c-outside", 4, 20},
		{"other-user", "other", "series", "root", "c-root", 5, 20},
	} {
		homeExec(t, `INSERT INTO reading_progress
			(id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_position, total_positions, progress_percent, updated_at)
			VALUES (?, ?, ?, ?, ?, 7, 31, 23, 97, ?, ?)`,
			row.id, row.user, row.series, row.volume, row.chapter, row.percent,
			time.Date(2026, time.October, row.day, 0, 0, 0, 0, time.UTC))
	}
	repo := NewReadingProgressRepository()
	one, err := repo.FindByUserAndSeries(nil, "reader", "series")
	if err != nil || one == nil || one.ID != "child" {
		t.Fatalf("unfinished priority/chapter tiebreaker: %+v, %v", one, err)
	}
	byUser, err := repo.FindByUser(nil, "reader")
	if err != nil || len(byUser) != 5 {
		t.Fatalf("user filter: %+v, %v", byUser, err)
	}
	ids := make([]string, 0, len(byUser))
	for i, p := range byUser {
		ids = append(ids, p.ID)
		if i > 0 && p.UpdatedAt.After(byUser[i-1].UpdatedAt) {
			t.Fatal("user results must be ordered by updated_at DESC")
		}
	}
	// FindByUser has no tiebreaker for identical timestamps.
	slices.Sort(ids)
	if !slices.Equal(ids, []string{"child", "grandchild", "outside", "root", "sibling"}) {
		t.Fatalf("user filter: %v", ids)
	}
	for _, tc := range []struct {
		name  string
		query func() ([]model.ReadingProgress, error)
		ids   []string
	}{
		{"recursive root", func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(nil, "reader", "root") }, []string{"grandchild", "child", "root"}},
		{"recursive child", func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(nil, "reader", "child") }, []string{"grandchild", "child"}},
		{"series join/order", func() ([]model.ReadingProgress, error) { return repo.FindByUserAndSeriesAll(nil, "reader", "series") }, []string{"sibling", "grandchild", "child", "root"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, queryErr := tc.query()
			if queryErr != nil || len(got) != len(tc.ids) {
				t.Fatalf("query = %+v, %v; want %v", got, queryErr, tc.ids)
			}
			for i, id := range tc.ids {
				if got[i].ID != id {
					t.Fatalf("row %d = %q, want %q", i, got[i].ID, id)
				}
			}
		})
	}
	// With all chapters completed, the latest one still wins.
	homeExec(t, `UPDATE reading_progress SET progress_percent = 100 WHERE user_id = 'reader' AND series_id = 'series'`)
	one, err = repo.FindByUserAndSeries(nil, "reader", "series")
	if err != nil || one == nil || one.ID != "sibling" {
		t.Fatalf("completed/latest selection: %+v, %v", one, err)
	}
}

func TestReadingProgressQueriesPreserveNullIDsAndEmptyResults(t *testing.T) {
	// Current migrations require chapter_id; older SQLite rows may still be NULL.
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "legacy-progress.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	_, err = db.Exec(`CREATE TABLE reading_progress (
		id TEXT, user_id TEXT, series_id TEXT, volume_id TEXT, chapter_id TEXT,
		current_page INTEGER, anchor_page INTEGER, offset_ratio REAL,
		total_pages INTEGER DEFAULT 0, current_position INTEGER, total_positions INTEGER,
		"current_time" REAL, duration REAL, progress_percent REAL DEFAULT 0,
		device_id TEXT, device_name TEXT, current_cfi TEXT, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);
		CREATE TABLE volumes (id TEXT, parent_id TEXT, series_id TEXT);
		CREATE TABLE chapters (id TEXT, volume_id TEXT, chapter_number INTEGER);
		INSERT INTO volumes VALUES ('root', NULL, 'series');
		INSERT INTO reading_progress
		(id, user_id, series_id, volume_id, chapter_id, current_page, anchor_page, current_position, total_positions)
		VALUES ('legacy', 'reader', 'series', NULL, NULL, 9, NULL, 0, 0)`)
	if err != nil {
		t.Fatal(err)
	}
	repo := NewReadingProgressRepository()
	one, err := repo.FindByUserAndSeries(db, "reader", "series")
	if err != nil || one == nil || one.VolumeID != nil || one.ChapterID != nil || one.AnchorPage != 9 {
		t.Fatalf("nullable IDs/fallback: %+v, %v", one, err)
	}
	all, err := repo.FindByUser(db, "reader")
	if err != nil || len(all) != 1 || !reflect.DeepEqual(all[0], *one) {
		t.Fatalf("nullable IDs in list: %+v, %v", all, err)
	}
	one, err = repo.FindByUserAndSeries(db, "missing", "series")
	if err != nil || one != nil {
		t.Fatalf("empty single result = %+v, %v", one, err)
	}
	for name, query := range map[string]func() ([]model.ReadingProgress, error){
		"empty user":                            func() ([]model.ReadingProgress, error) { return repo.FindByUser(db, "missing") },
		"null chapter excluded from volume":     func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(db, "reader", "root") },
		"null chapter excluded from series-all": func() ([]model.ReadingProgress, error) { return repo.FindByUserAndSeriesAll(db, "reader", "series") },
		"missing volume":                        func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(db, "reader", "missing") },
		"missing series":                        func() ([]model.ReadingProgress, error) { return repo.FindByUserAndSeriesAll(db, "reader", "missing") },
	} {
		got, queryErr := query()
		if queryErr != nil || got != nil {
			t.Fatalf("%s = %+v, %v; want nil slice, nil error", name, got, queryErr)
		}
	}
	// SQLite accepts TEXT in an INTEGER column; conversion errors must propagate.
	if _, execErr := db.Exec(`UPDATE reading_progress SET current_page = 'invalid' WHERE id = 'legacy'`); execErr != nil {
		t.Fatal(execErr)
	}
	one, err = repo.FindByUserAndSeries(db, "reader", "series")
	if err == nil || one != nil {
		t.Fatalf("single scan error = %+v, %v", one, err)
	}
	all, err = repo.FindByUser(db, "reader")
	if err == nil || all != nil {
		t.Fatalf("list scan error = %+v, %v", all, err)
	}
}

func TestScanReadingProgressRowPreservesScanErrors(t *testing.T) {
	seedReadingProgressQueries(t)
	_, err := scanReadingProgressRow(database.DB.QueryRow(`SELECT 1 WHERE 0`))
	if err != sql.ErrNoRows {
		t.Fatalf("missing row error = %v, want sql.ErrNoRows", err)
	}
	if _, err := scanReadingProgressRow(database.DB.QueryRow(`SELECT 1`)); err == nil {
		t.Fatal("column count mismatch must be returned")
	}
}
