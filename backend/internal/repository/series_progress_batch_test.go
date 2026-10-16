package repository

import (
	"math"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

func TestReadProgressUnitsBatchMatchesSingle(t *testing.T) {
	connectSeriesRepositoryTestDB(t)
	database.DB.SetMaxOpenConns(1)
	homeExec(t, `INSERT INTO libraries(id,name,type,library_type) VALUES ('batch-lib','Batch','LOCAL','book')`)
	homeExec(t, `INSERT INTO users(id,username,nickname,password_hash) VALUES ('reader','reader','Reader','unused'),('other','other','Other','unused')`)
	homeExec(t, `INSERT INTO series(id,library_id,title,path) VALUES ('empty','batch-lib','Empty','/synthetic/empty')`)
	cases := []struct {
		id                                               string
		pages, positions, currentPage, totalPages        int
		percent, duration, currentTime, progressDuration float64
		cfi                                              string
		audio, complete, noProgress, wrongSeries         bool
	}{
		{id: "pages", pages: 100, positions: 100000, currentPage: 25, totalPages: 100, percent: 99},
		{id: "cfi", pages: 100, currentPage: 1, totalPages: 100, percent: 75, cfi: "epubcfi(/6/2!/4/2)"},
		{id: "epub", positions: 1000, percent: 25, cfi: "epubcfi(/6/2!/4/2)"},
		{id: "percent", pages: 100, percent: 33.5},
		{id: "audio", duration: 123.75, audio: true, currentTime: 61.875},
		{id: "audio-duration", duration: 120, audio: true, currentTime: 60, progressDuration: 240},
		{id: "audio-fallback", pages: 100, audio: true, currentTime: 25},
		{id: "upper-clamp", pages: 100, currentPage: 250, totalPages: 100},
		{id: "lower-clamp", pages: 100, currentPage: -25, totalPages: 100},
		{id: "complete", pages: 100, currentPage: 25, totalPages: 100, complete: true},
		{id: "complete-only", pages: 100, complete: true, noProgress: true},
		{id: "unread", pages: 100, noProgress: true},
		{id: "wrong-series", pages: 100, currentPage: 75, totalPages: 100, wrongSeries: true},
		// Keep scalar conversion behavior rather than adopting Home's finite-value clamp.
		{id: "nonfinite", duration: math.Inf(1), complete: true, noProgress: true},
	}
	ids := []string{"empty", "missing"}
	for _, tc := range cases {
		ids = append(ids, tc.id)
		homeExec(t, `INSERT INTO series(id,library_id,title,path) VALUES (?,'batch-lib',?,?)`, tc.id, tc.id, "/synthetic/"+tc.id)
		homeExec(t, `INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES (?,?,'V',1,?)`, "v-"+tc.id, tc.id, "/synthetic/v-"+tc.id)
		homeExec(t, `INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count,total_positions,duration,has_audio) VALUES (?,?,'C',1,?,?,?,?,?)`, "c-"+tc.id, "v-"+tc.id, "/synthetic/c-"+tc.id, tc.pages, tc.positions, tc.duration, tc.audio)
		if !tc.noProgress {
			seriesID := tc.id
			if tc.wrongSeries {
				seriesID = "empty"
			}
			homeExec(t, `INSERT INTO reading_progress(id,user_id,series_id,volume_id,chapter_id,current_page,total_pages,progress_percent,current_cfi,current_time,duration) VALUES (?,'reader',?,?,?,?,?,?,?,?,?)`, "p-"+tc.id, seriesID, "v-"+tc.id, "c-"+tc.id, tc.currentPage, tc.totalPages, tc.percent, tc.cfi, tc.currentTime, tc.progressDuration)
		}
		if tc.complete {
			homeExec(t, `INSERT INTO chapter_completions(id,user_id,chapter_id) VALUES (?,'reader',?)`, "done-"+tc.id, "c-"+tc.id)
		}
		homeExec(t, `INSERT INTO reading_progress(id,user_id,series_id,volume_id,chapter_id,current_page,total_pages,progress_percent) VALUES (?,'other',?,?,?,80,100,80)`, "other-"+tc.id, tc.id, "v-"+tc.id, "c-"+tc.id)
	}
	var beforeChanges int64
	if err := database.DB.QueryRow(`SELECT total_changes()`).Scan(&beforeChanges); err != nil {
		t.Fatal(err)
	}
	repo := NewSeriesRepository()
	for _, user := range []string{"reader", "other", "absent"} {
		got, err := repo.GetReadProgressUnitsBatch(nil, user, ids)
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != len(ids) {
			t.Fatalf("result contains %d series, want %d", len(got), len(ids))
		}
		for _, id := range ids {
			want, err := repo.GetReadProgressUnits(nil, user, id)
			if err != nil {
				t.Fatal(err)
			}
			if got[id] != want {
				t.Errorf("user %s series %s: batch=%d scalar=%d", user, id, got[id], want)
			}
		}
	}
	var afterChanges int64
	if err := database.DB.QueryRow(`SELECT total_changes()`).Scan(&afterChanges); err != nil {
		t.Fatal(err)
	}
	if afterChanges != beforeChanges {
		t.Fatal("aggregation modified database records")
	}
}
