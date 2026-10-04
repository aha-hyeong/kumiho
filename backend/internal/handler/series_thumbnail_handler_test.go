package handler

import (
	"encoding/json"
	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/gofiber/fiber/v2"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGeneralSeriesThumbnailAPICacheIdentity(t *testing.T) {
	dir := t.TempDir()
	if err := database.Connect(filepath.Join(dir, "general-series.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	execSQL := func(q string, args ...any) {
		t.Helper()
		if _, err := database.DB.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	stamp := time.Date(2026, 10, 4, 1, 2, 3, 456, time.UTC)
	execSQL(`INSERT INTO users(id,username,nickname,password_hash) VALUES ('u','fixture','Fixture','unused')`)
	execSQL(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book'),('liked','Liked','SYSTEM','book')`)
	cover := filepath.Join(dir, "cover.svg")
	red := `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="red"/></svg>`
	blue := strings.ReplaceAll(red, "red", "blue")
	writeCover := func(body string) {
		t.Helper()
		if err := os.WriteFile(cover, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		mtime := time.Unix(946684800, 0)
		if err := os.Chtimes(cover, mtime, mtime); err != nil {
			t.Fatal(err)
		}
	}
	writeCover(red)
	execSQL(`INSERT INTO series(id,library_id,title,path,thumbnail_path,thumbnail_version,updated_at,last_content_updated_at) VALUES ('s','lib','Series custom','/series',?,7,?,datetime('now')),('f','lib','Series fallback','/fallback',NULL,0,?,datetime('now'))`, cover, stamp, stamp)
	execSQL(`INSERT INTO volumes(id,series_id,title,volume_number,path,thumbnail_path,thumbnail_version,updated_at) VALUES ('v','f','Volume',1,'/volume',?,3,?)`, cover, stamp)
	execSQL(`INSERT INTO user_bookmarks(user_id,series_id) VALUES ('u','s'),('u','f')`)
	sr, vr := repository.NewSeriesRepository(), repository.NewVolumeRepository()
	h := &SeriesHandler{seriesRepo: sr, volumeRepo: vr, libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository(), seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), vr)}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
	app.Get("/api/v1/libraries/:libraryId/series", h.ListByLibrary)
	app.Get("/api/v1/series/search", h.Search)
	app.Get("/api/v1/series/:id", h.GetSeries)
	app.Patch("/api/v1/series/:id", h.UpdateSeries)
	ih := &ImageHandler{seriesRepo: sr, volumeRepo: vr, config: &config.Config{DataDir: dir}}
	app.Get("/api/v1/:type/:id/thumbnail", ih.GetThumbnail)
	previous := map[string]string{}
	assertURLs := func(seriesVersion, volumeVersion int64, changed bool) {
		t.Helper()
		for _, route := range []string{"/api/v1/libraries/lib/series", "/api/v1/libraries/liked/series", "/api/v1/series/search?q=Series", "/api/v1/series/s", "/api/v1/series/f"} {
			response, err := app.Test(httptest.NewRequest("GET", route, nil), -1)
			if err != nil {
				t.Fatal(err)
			}
			var list []model.Series
			if route == "/api/v1/series/s" || route == "/api/v1/series/f" {
				var s model.Series
				err = json.NewDecoder(response.Body).Decode(&s)
				list = []model.Series{s}
			} else {
				var payload struct {
					Series []model.Series `json:"series"`
				}
				err = json.NewDecoder(response.Body).Decode(&payload)
				list = payload.Series
			}
			response.Body.Close()
			if response.StatusCode != 200 || err != nil || len(list) == 0 {
				t.Fatalf("%s status%d err%v", route, response.StatusCode, err)
			}
			for _, s := range list {
				want := util.BuildHomeSeriesThumbnailURL("s", stamp, seriesVersion)
				if s.ID == "f" {
					want = util.BuildHomeVolumeThumbnailURL("v", stamp, volumeVersion)
				}
				if s.ThumbnailURL == nil || *s.ThumbnailURL != want {
					t.Errorf("%s %s URL=%v want %s", route, s.ID, s.ThumbnailURL, want)
					continue
				}
				key := route + s.ID
				if old, exists := previous[key]; exists && (want != old) != changed {
					t.Errorf("%s changed=%v URL%s ->%s", key, changed, old, want)
				}
				previous[key] = want
			}
		}
	}
	assertImage := func(url, body string) {
		t.Helper()
		response, err := app.Test(httptest.NewRequest("GET", url, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		contents, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || string(contents) != body {
			t.Fatalf("image %s status%d err%v body%s", url, response.StatusCode, err, contents)
		}
		if response.Header.Get("Cache-Control") != "public, max-age=86400" {
			t.Error("cache header changed")
		}
	}
	assertURLs(7, 3, false)
	assertImage(util.BuildHomeSeriesThumbnailURL("s", stamp, 7), red)
	for _, id := range []string{"s", "f"} {
		request := httptest.NewRequest("PATCH", "/api/v1/series/"+id, strings.NewReader(`{"title":"Series renamed","description":"Metadata only"}`))
		request.Header.Set("Content-Type", "application/json")
		response, err := app.Test(request, -1)
		if err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatalf("metadata status%d", response.StatusCode)
		}
	}
	assertURLs(7, 3, false)
	execSQL(`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('progress-volume','s','Progress volume',1,'/progress')`)
	execSQL(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('chapter','progress-volume','Chapter',1,'/chapter',10)`)
	volumeID, chapterID := "progress-volume", "chapter"
	progress := model.ReadingProgress{UserID: "u", SeriesID: "s", VolumeID: &volumeID, ChapterID: &chapterID, CurrentPage: 4, TotalPages: 10, ProgressPercent: 40}
	if err := repository.NewReadingProgressRepository().Upsert(nil, &progress); err != nil {
		t.Fatal(err)
	}
	assertURLs(7, 3, false)
	writeCover(blue) // identical path and mtime: DB version must still invalidate.
	custom, err := sr.FindByID(nil, "s", "u")
	if err != nil || custom == nil {
		t.Fatalf("custom read %v", err)
	}
	if updateErr := sr.UpdateThumbnail(nil, custom); updateErr != nil {
		t.Fatal(updateErr)
	}
	volume, err := vr.FindByID(nil, "v")
	if err != nil || volume == nil {
		t.Fatalf("volume read %v", err)
	}
	if err := vr.UpdateThumbnail(nil, volume); err != nil {
		t.Fatal(err)
	}
	assertURLs(8, 4, true)
	assertImage(util.BuildHomeSeriesThumbnailURL("s", stamp, 8), blue)
	assertImage(util.BuildHomeVolumeThumbnailURL("v", stamp, 4), blue)
	assertURLs(8, 4, false)
}
