package service

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestHomeThumbnailURLsUseOnlyDBState(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "home.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.DB.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`)
	dbTime := time.Date(2026, 9, 24, 1, 2, 3, 123456789, time.UTC)
	fileTime := time.Unix(946684800, 0)
	ids := []string{}
	// Distinct existing paths prevent the legacy stat cache from hiding a file probe.
	for i := 0; i < 6; i++ {
		id := fmt.Sprintf("s%d", i)
		ids = append(ids, id)
		cover := filepath.Join(t.TempDir(), "cold-cover.jpg")
		if err := os.WriteFile(cover, []byte("cover"), 0600); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(cover, fileTime, fileTime); err != nil {
			t.Fatal(err)
		}
		var seriesCover any = cover
		if i%2 == 1 {
			seriesCover = nil
		}
		exec(`INSERT INTO series(id,library_id,title,path,thumbnail_path,updated_at) VALUES (?,'lib',?,?,?,?)`, id, id, "/"+id, seriesCover, dbTime)
		if i%2 == 1 {
			exec(`INSERT INTO volumes(id,series_id,title,volume_number,path,thumbnail_path,updated_at) VALUES (?,?,?,1,?,?,?)`, id+"v", id, id, "/"+id+"v", cover, dbTime)
		}
	}
	repo := repository.NewSeriesRepository()
	svc := NewSeriesEnrichService(repo, repository.NewChapterRepository(), repository.NewVolumeRepository())
	load := func() map[string]string {
		t.Helper()
		cards, err := repo.FindByIDs(nil, ids, "")
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.EnrichHomeList(cards, ""); err != nil {
			t.Fatal(err)
		}
		urls := map[string]string{}
		for _, card := range cards {
			if card.ThumbnailURL == nil {
				t.Fatalf("missing thumbnail for %s", card.ID)
			}
			urls[card.ID] = *card.ThumbnailURL
		}
		return urls
	}
	first := load()
	for i, id := range ids {
		kind, target := "series", id
		if i%2 == 1 {
			kind, target = "volumes", id+"v"
		}
		want := fmt.Sprintf("/api/v1/%s/%s/thumbnail?t=db-%d-0", kind, target, dbTime.UnixNano())
		if first[id] != want {
			t.Errorf("%s URL = %s, want DB-only %s", id, first[id], want)
		}
	}
	// Replacing bytes at the same persisted path must invalidate Home without
	// changing the content timestamps (volume uploads and metadata covers do this).
	series, err := repo.FindByID(nil, "s0", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.UpdatePreservingUpdatedAt(nil, series); err != nil {
		t.Fatal(err)
	}
	volumeRepo := repository.NewVolumeRepository()
	volume, err := volumeRepo.FindByID(nil, "s1v")
	if err != nil {
		t.Fatal(err)
	}
	if err := volumeRepo.UpdatePreservingContentUpdatedAt(nil, volume); err != nil {
		t.Fatal(err)
	}
	second := load()
	for _, id := range []string{"s0", "s1"} {
		if second[id] == first[id] {
			t.Errorf("%s same-path replacement did not invalidate Home URL", id)
		}
	}
	// Sub-second DB timestamp changes must not collapse to the same cache key.
	exec(`UPDATE series SET updated_at=? WHERE id='s2'`, dbTime.Add(time.Nanosecond))
	third := load()
	if third["s2"] == second["s2"] {
		t.Error("DB timestamp change did not invalidate Home URL")
	}
}
