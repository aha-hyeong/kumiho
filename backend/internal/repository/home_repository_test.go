package repository

import (
	"fmt"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

func homeExec(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := database.DB.Exec(query, args...); err != nil {
		t.Fatalf("fixture SQL: %v", err)
	}
}

func TestHomeRecentSelectionAndBatchMetrics(t *testing.T) {
	connectSeriesRepositoryTestDB(t)
	repo := NewSeriesRepository()
	now := time.Now().UTC().Truncate(time.Second)
	for _, lib := range []struct{ id, kind string }{{"allowed", "LOCAL"}, {"denied", "LOCAL"}, {"system-likes", "SYSTEM"}} {
		homeExec(t, `INSERT OR IGNORE INTO libraries (id,name,type,library_type) VALUES (?, ?, ?, 'book')`, lib.id, lib.id, lib.kind)
	}
	homeExec(t, `INSERT INTO users (id,username,nickname,password_hash,role) VALUES ('reader','reader','Reader','hash','USER')`)
	for _, row := range []struct {
		id, lib          string
		content, updated *time.Time
	}{
		{"fallback", "allowed", nil, ptrTime(now.Add(-2 * time.Hour))},
		{"newest", "allowed", ptrTime(now.Add(-time.Hour)), ptrTime(now.Add(-30 * 24 * time.Hour))},
		{"old", "allowed", ptrTime(now.Add(-10 * 24 * time.Hour)), ptrTime(now)},
		{"denied-series", "denied", ptrTime(now), ptrTime(now)},
		{"system-series", "system-likes", ptrTime(now), ptrTime(now)},
	} {
		homeExec(t, `INSERT INTO series(id,library_id,title,path,last_content_updated_at,updated_at) VALUES (?,?,?,?,?,?)`, row.id, row.lib, row.id, "/"+row.id, row.content, row.updated)
	}
	cutoff := now.Add(-7 * 24 * time.Hour)
	ids, err := repo.FindHomeRecentIDs(nil, cutoff, 2, []string{"allowed"}, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 2 || ids[0] != "newest" || ids[1] != "fallback" {
		t.Fatalf("allowed ordered ids: %v", ids)
	}
	ids, err = repo.FindHomeRecentIDs(nil, cutoff, 1, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != "denied-series" {
		t.Fatalf("master limited ids: %v", ids)
	}
	ids, err = repo.FindHomeRecentIDs(nil, cutoff, 30, nil, false)
	if err != nil || len(ids) != 0 {
		t.Fatalf("empty permissions: %v %v", ids, err)
	}
	ids, err = repo.FindHomeRecentIDs(nil, cutoff, 30, []string{"allowed"}, false)
	if err != nil || len(ids) != 2 {
		t.Fatalf("system/period exclusion: %v %v", ids, err)
	}
	for i := 0; i < 31; i++ {
		id := fmt.Sprintf("many-%02d", i)
		homeExec(t, `INSERT INTO series(id,library_id,title,path,last_content_updated_at) VALUES (?,'allowed',?,?,?)`, id, id, "/"+id, now)
	}
	ids, err = repo.FindHomeRecentIDs(nil, cutoff, 9999, []string{"allowed"}, false)
	if err != nil || len(ids) != 30 {
		t.Fatalf("bounded default: %d cards %v", len(ids), err)
	}
	for i := 0; i < 31; i++ {
		homeExec(t, `INSERT INTO user_bookmarks(user_id,series_id) VALUES ('reader',?)`, fmt.Sprintf("many-%02d", i))
	}
	homeExec(t, `INSERT INTO user_bookmarks(user_id,series_id) VALUES ('reader','denied-series')`)
	liked, err := repo.FindHomeLikedIDs(nil, "reader", []string{"allowed"}, false)
	if err != nil || len(liked) != 30 || liked[0] != "many-00" || liked[29] != "many-29" {
		t.Fatalf("bounded accessible likes in title order: %v %v", liked, err)
	}
	liked, err = repo.FindHomeLikedIDs(nil, "reader", nil, false)
	if err != nil || len(liked) != 0 {
		t.Fatalf("zero permissions must not expose likes: %v %v", liked, err)
	}

	homeExec(t, `INSERT INTO volumes(id,series_id,title,volume_number,path,unit) VALUES ('v1','newest','V',1,'/v1','chapter'),('v2','newest','V',2,'/v2','chapter')`)
	homeExec(t, `INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('c1','v1','C',1,'/c1',100),('c2','v2','C',2,'/c2',40)`)
	homeExec(t, `INSERT INTO chapter_completions(id,user_id,chapter_id) VALUES ('done','reader','c2')`)
	homeExec(t, `INSERT INTO reading_progress(id,user_id,series_id,volume_id,chapter_id,current_page,total_pages,progress_percent) VALUES ('reading','reader','newest','v1','c1',25,100,25)`)
	metrics, err := repo.GetHomeMetrics(nil, "reader", []string{"newest", "fallback"})
	if err != nil {
		t.Fatal(err)
	}
	got := metrics["newest"]
	if got.VolumeCount != 2 || got.ChapterCount != 2 || got.TotalPageCount != 140 || got.ReadPageCount != 65 || got.DisplayUnit != "chapter" {
		t.Fatalf("batch metrics: %+v", got)
	}
	legacyTotal, err := repo.GetTotalProgressUnits(nil, "newest")
	if err != nil {
		t.Fatal(err)
	}
	legacyRead, err := repo.GetReadProgressUnits(nil, "reader", "newest")
	if err != nil {
		t.Fatal(err)
	}
	if got.TotalPageCount != legacyTotal || got.ReadPageCount != legacyRead {
		t.Fatalf("batch/legacy mismatch: batch=%+v legacy=%d/%d", got, legacyTotal, legacyRead)
	}
	otherUser, err := repo.GetHomeMetrics(nil, "another-reader", []string{"newest"})
	if err != nil || otherUser["newest"].ReadPageCount != 0 {
		t.Fatalf("other user progress leaked: %+v %v", otherUser, err)
	}
	if metrics["fallback"].TotalPageCount != 0 {
		t.Fatalf("empty series metrics: %+v", metrics["fallback"])
	}
	empty, err := repo.GetHomeMetrics(nil, "reader", nil)
	if err != nil || len(empty) != 0 {
		t.Fatalf("empty metrics: %v %v", empty, err)
	}
}

func ptrTime(t time.Time) *time.Time { return &t }
