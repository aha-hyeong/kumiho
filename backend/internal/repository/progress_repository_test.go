package repository

import (
	"database/sql"
	"reflect"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

func seedReadingProgressQueries(t *testing.T) {
	t.Helper()
	connectSeriesRepositoryTestDB(t)
	homeExec(t, `INSERT INTO libraries(id, name, type, library_type) VALUES ('lib', 'Library', 'LOCAL', 'book')`)
	homeExec(t, `INSERT INTO users(id, username, nickname, password_hash, role) VALUES ('reader', 'reader', 'Reader', 'hash', 'USER')`)
	homeExec(t, `INSERT INTO series(id, library_id, title, path) VALUES ('series', 'lib', 'Series', '/series')`)
	homeExec(t, `INSERT INTO volumes(id, series_id, title, volume_number, path) VALUES ('root', 'series', 'Root', 1, '/root')`)
	homeExec(t, `INSERT INTO chapters(id, volume_id, title, chapter_number, path) VALUES ('c-root', 'root', 'Root', 1, '/c-root')`)
}

func TestReadingProgressQueriesScanProjection(t *testing.T) {
	for _, name := range []string{"null", "zero", "populated", "empty", "scan-error"} {
		t.Run(name, func(t *testing.T) {
			seedReadingProgressQueries(t)
			chapterID, volumeID := "c-root", "root"
			want := model.ReadingProgress{
				ID: "progress", UserID: "reader", SeriesID: "series", ChapterID: &chapterID,
				CurrentPage: 7, AnchorPage: 7, TotalPages: 31,
				CurrentPosition: 23, TotalPositions: 97, ProgressPercent: 29.25,
				UpdatedAt: time.Date(2026, time.October, 1, 12, 30, 0, 0, time.UTC),
			}
			var anchor, offset any
			if name == "zero" || name == "populated" {
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
			var expected []model.ReadingProgress
			if name != "empty" {
				homeExec(t, `INSERT INTO reading_progress
					(id, user_id, series_id, volume_id, chapter_id, current_page, anchor_page, offset_ratio, total_pages,
					 current_position, total_positions, "current_time", duration, progress_percent, device_id, device_name, current_cfi, updated_at, read_time_seconds)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 99)`,
					want.ID, want.UserID, want.SeriesID, want.VolumeID, want.ChapterID, want.CurrentPage, anchor, offset,
					want.TotalPages, want.CurrentPosition, want.TotalPositions, want.CurrentTime, want.Duration,
					want.ProgressPercent, want.DeviceID, want.DeviceName, want.CurrentCFI, want.UpdatedAt)
				expected = []model.ReadingProgress{want}
			}
			if name == "scan-error" {
				homeExec(t, `UPDATE reading_progress SET current_page = 'invalid' WHERE id = 'progress'`)
			}
			repo := NewReadingProgressRepository()
			for method, query := range map[string]func() ([]model.ReadingProgress, error){
				"FindByUserAndSeries": func() ([]model.ReadingProgress, error) {
					p, err := repo.FindByUserAndSeries(nil, "reader", "series")
					if p == nil {
						return nil, err
					}
					return []model.ReadingProgress{*p}, err
				},
				"FindByUser":             func() ([]model.ReadingProgress, error) { return repo.FindByUser(nil, "reader") },
				"FindByUserAndVolume":    func() ([]model.ReadingProgress, error) { return repo.FindByUserAndVolume(nil, "reader", "root") },
				"FindByUserAndSeriesAll": func() ([]model.ReadingProgress, error) { return repo.FindByUserAndSeriesAll(nil, "reader", "series") },
			} {
				got, err := query()
				if name == "scan-error" {
					if err == nil || got != nil {
						t.Fatalf("%s scan error = %+v, %v; want nil result, error", method, got, err)
					}
				} else if err != nil || !reflect.DeepEqual(got, expected) {
					t.Fatalf("%s = %+v, %v; want %+v", method, got, err, expected)
				}
			}
		})
	}
}

func TestScanReadingProgressRowNullIDsAndErrors(t *testing.T) {
	seedReadingProgressQueries(t)
	homeExec(t, `INSERT INTO reading_progress
		(id, user_id, series_id, chapter_id, current_page, current_position, total_positions)
		VALUES ('progress', 'reader', 'series', 'c-root', 9, 0, 0)`)
	// Current schema disallows NULL chapter_id; project NULL IDs without a legacy schema.
	p, err := scanReadingProgressRow(database.DB.QueryRow(`SELECT
		id, user_id, series_id, NULL, NULL, current_page, anchor_page, offset_ratio, total_pages,
		current_position, total_positions, "current_time", duration, progress_percent, device_id, device_name, current_cfi, updated_at
		FROM reading_progress`))
	if err != nil || p.VolumeID != nil || p.ChapterID != nil || p.AnchorPage != 9 {
		t.Fatalf("nullable IDs/fallback = %+v, %v", p, err)
	}
	if _, err := scanReadingProgressRow(database.DB.QueryRow(`SELECT 1 WHERE 0`)); err != sql.ErrNoRows {
		t.Fatalf("missing row error = %v, want sql.ErrNoRows", err)
	}
	if _, err := scanReadingProgressRow(database.DB.QueryRow(`SELECT 1`)); err == nil {
		t.Fatal("column count mismatch must be returned")
	}
}
