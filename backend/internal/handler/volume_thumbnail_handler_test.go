package handler

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/gofiber/fiber/v2"
)

func TestVolumeThumbnailAPICacheInvalidation(t *testing.T) {
	dir := t.TempDir()
	if err := database.Connect(filepath.Join(dir, "volume-thumbnail.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.DB.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	stamp := time.Date(2026, 10, 4, 1, 2, 3, 456, time.UTC)
	exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`)
	exec(`INSERT INTO series(id,library_id,title,path) VALUES ('s','lib','Series','/series')`)
	cover := filepath.Join(dir, "cover.svg")
	red := `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="red"/></svg>`
	blue := strings.ReplaceAll(red, "red", "blue")
	green := strings.ReplaceAll(red, "red", "green")
	writeCover := func(path, contents string) {
		t.Helper()
		if err := os.WriteFile(path, []byte(contents), 0600); err != nil {
			t.Fatal(err)
		}
	}
	writeCover(cover, red)
	exec(`INSERT INTO volumes(id,series_id,title,volume_number,path,parent_id,thumbnail_path,thumbnail_version,updated_at)
		VALUES ('parent','s','Parent',1,'/parent',NULL,?,7,?),
		       ('child','s','Child',1,'/child','parent',?,7,?)`, cover, stamp, cover, stamp)
	vr := repository.NewVolumeRepository()
	h := &SeriesHandler{seriesRepo: repository.NewSeriesRepository(), volumeRepo: vr, completionRepo: repository.NewVolumeCompletionRepository()}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
	app.Get("/api/v1/series/:seriesId/volumes", h.ListVolumes)
	app.Get("/api/v1/volumes/:id", h.GetVolume)
	app.Patch("/api/v1/volumes/:id", h.UpdateVolume)
	imageHandler := &ImageHandler{volumeRepo: vr, config: &config.Config{DataDir: dir}}
	app.Get("/api/v1/:type/:id/thumbnail", imageHandler.GetThumbnail)
	previous := make(map[string]string)
	assertURLs := func(updated time.Time, version int64, changed bool) {
		t.Helper()
		for _, route := range []string{
			"/api/v1/series/s/volumes",
			"/api/v1/series/s/volumes?parent_id=root",
			"/api/v1/series/s/volumes?parent_id=parent",
			"/api/v1/volumes/parent",
		} {
			response, err := app.Test(httptest.NewRequest("GET", route, nil), -1)
			if err != nil {
				t.Fatal(err)
			}
			var volumes []model.Volume
			if strings.HasPrefix(route, "/api/v1/volumes/") {
				var volume model.Volume
				err = json.NewDecoder(response.Body).Decode(&volume)
				volumes = []model.Volume{volume}
			} else {
				var payload struct {
					Volumes []model.Volume `json:"volumes"`
				}
				err = json.NewDecoder(response.Body).Decode(&payload)
				volumes = payload.Volumes
			}
			response.Body.Close()
			if response.StatusCode != 200 || err != nil || len(volumes) == 0 {
				t.Fatalf("%s: status=%d err=%v volumes=%v", route, response.StatusCode, err, volumes)
			}
			for _, volume := range volumes {
				want := util.BuildHomeVolumeThumbnailURL(volume.ID, updated, version)
				if volume.ThumbnailURL == nil || *volume.ThumbnailURL != want {
					t.Fatalf("%s: id=%s URL=%v, want %s", route, volume.ID, volume.ThumbnailURL, want)
				}
				key := route + volume.ID
				if before, exists := previous[key]; exists && (want != before) != changed {
					t.Fatalf("%s: changed=%v, URL %s -> %s", key, changed, before, want)
				}
				previous[key] = want
			}
		}
	}
	assertImage := func(contents string) {
		t.Helper()
		url := previous["/api/v1/volumes/parentparent"]
		response, err := app.Test(httptest.NewRequest("GET", url, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		body, readErr := io.ReadAll(response.Body)
		response.Body.Close()
		if readErr != nil {
			t.Fatal(readErr)
		}
		if response.StatusCode != 200 || string(body) != contents {
			t.Fatalf("thumbnail request %s: status=%d, body=%s", url, response.StatusCode, body)
		}
		if response.Header.Get("Cache-Control") != "public, max-age=86400" {
			t.Error("existing thumbnail caching policy changed")
		}
	}
	assertURLs(stamp, 7, false)
	assertURLs(stamp, 7, false)
	assertImage(red)
	// Ordinary metadata edits must preserve the existing thumbnail identity.
	for _, id := range []string{"parent", "child"} {
		request := httptest.NewRequest("PATCH", "/api/v1/volumes/"+id, strings.NewReader(`{"title":"Renamed","description":"Metadata only"}`))
		request.Header.Set("Content-Type", "application/json")
		response, err := app.Test(request, -1)
		if err != nil {
			t.Fatal(err)
		}
		var volume model.Volume
		decodeErr := json.NewDecoder(response.Body).Decode(&volume)
		response.Body.Close()
		want := util.BuildHomeVolumeThumbnailURL(id, stamp, 7)
		if response.StatusCode != 200 || decodeErr != nil || volume.Title != "Renamed" || volume.ThumbnailURL == nil || *volume.ThumbnailURL != want {
			t.Fatalf("metadata edit %s: status=%d err=%v volume=%+v", id, response.StatusCode, decodeErr, volume)
		}
	}
	assertURLs(stamp, 7, false)
	assertImage(red)
	// Exercise the real progress writer, including its updated_at mutation.
	exec(`INSERT INTO users(id,username,nickname,password_hash) VALUES ('u','fixture','Fixture','unused')`)
	exec(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('chapter','parent','Chapter',1,'/chapter',10)`)
	volumeID, chapterID := "parent", "chapter"
	progress := model.ReadingProgress{UserID: "u", SeriesID: "s", VolumeID: &volumeID, ChapterID: &chapterID, CurrentPage: 1, TotalPages: 10, ProgressPercent: 10}
	progressRepo := repository.NewReadingProgressRepository()
	for _, page := range []int{1, 4} {
		progress.CurrentPage = page
		progress.ProgressPercent = float64(page * 10)
		progress.UpdatedAt = stamp
		if err := progressRepo.Upsert(nil, &progress); err != nil {
			t.Fatal(err)
		}
		var persistedPage int
		var persistedTime time.Time
		if err := database.DB.QueryRow(`SELECT current_page, updated_at FROM reading_progress WHERE user_id='u' AND chapter_id='chapter'`).Scan(&persistedPage, &persistedTime); err != nil {
			t.Fatal(err)
		}
		if persistedPage != page || persistedTime.Equal(stamp) {
			t.Fatalf("progress was not persisted: page=%d updated_at=%s", persistedPage, persistedTime)
		}
		assertURLs(stamp, 7, false)
		assertImage(red)
	}
	updated := stamp.Add(time.Nanosecond)
	writeCover(cover, blue)
	exec(`UPDATE volumes SET updated_at=?`, updated)
	assertURLs(updated, 7, true)
	assertImage(blue)
	writeCover(cover, green)
	for _, id := range []string{"parent", "child"} {
		volume, err := vr.FindByID(nil, id)
		if err != nil || volume == nil {
			t.Fatalf("load %s: %v", id, err)
		}
		if updateErr := vr.UpdateThumbnail(nil, volume); updateErr != nil {
			t.Fatal(updateErr)
		}
		h.assignVolumeThumbnailURL(volume)
		want := util.BuildHomeVolumeThumbnailURL(id, updated, 8)
		if *volume.ThumbnailURL != want {
			t.Errorf("thumbnail mutation response URL=%s, want %s", *volume.ThumbnailURL, want)
		}
	}
	assertURLs(updated, 8, true)
	assertImage(green)
	replacement := filepath.Join(dir, "replacement.svg")
	writeCover(replacement, red)
	exec(`UPDATE volumes SET thumbnail_path=?`, replacement)
	assertURLs(updated, 9, true)
	assertImage(red)
	assertURLs(updated, 9, false)
}

func TestVolumeThumbnailURLTracksEntityVersion(t *testing.T) {
	h := &SeriesHandler{}
	h.assignVolumeThumbnailURL(nil)
	stamp := time.Date(2026, 10, 4, 1, 2, 3, 456, time.UTC)
	volume := model.Volume{ID: "volume", UpdatedAt: stamp, ThumbnailVersion: 7}
	h.assignVolumeThumbnailURL(&volume)
	want := util.BuildHomeVolumeThumbnailURL(volume.ID, stamp, 7)
	if volume.ThumbnailURL == nil || *volume.ThumbnailURL != want {
		t.Fatalf("volume URL = %v, want %s", volume.ThumbnailURL, want)
	}
	for _, next := range []model.Volume{
		{ID: volume.ID, UpdatedAt: stamp.Add(time.Nanosecond), ThumbnailVersion: 7},
		{ID: volume.ID, UpdatedAt: stamp, ThumbnailVersion: 8},
	} {
		h.assignVolumeThumbnailURL(&next)
		if next.ThumbnailURL == nil || *next.ThumbnailURL == want {
			t.Error("real volume timestamp or thumbnail version change must invalidate URL")
		}
	}
	h.assignVolumeThumbnailURL(&volume)
	if *volume.ThumbnailURL != want {
		t.Error("unchanged volume metadata must keep URL stable")
	}
}
