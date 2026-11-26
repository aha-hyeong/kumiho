package handler

import (
	"archive/zip"
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
	queries := openCountedDB(t, filepath.Join(dir, "general-series.db"))
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
	h := &SeriesHandler{config: &config.Config{DataDir: dir}, seriesRepo: sr, volumeRepo: vr, libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository(), seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), vr)}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
	app.Get("/api/v1/libraries/:libraryId/series", h.ListByLibrary)
	app.Get("/api/v1/series/search", h.Search)
	app.Get("/api/v1/series/:id", h.GetSeries)
	app.Patch("/api/v1/series/:id", h.UpdateSeries)
	app.Delete("/api/v1/series/:id/thumbnail", h.DeleteThumbnail)
	ih := &ImageHandler{seriesRepo: sr, volumeRepo: vr, config: &config.Config{DataDir: dir}}
	app.Get("/api/v1/:type/:id/thumbnail", ih.GetThumbnail)
	previous := map[string]string{}
	assertURLs := func(seriesVersion, autoVersion int64, changed bool) {
		t.Helper()
		for _, route := range []string{"/api/v1/libraries/lib/series", "/api/v1/libraries/liked/series", "/api/v1/series/search?q=Series", "/api/v1/series/s", "/api/v1/series/f"} {
			queries.reset()
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
			queries.assertNoPages(t)
			for _, s := range list {
				want := util.BuildHomeSeriesThumbnailURL("s", stamp, seriesVersion)
				if s.ID == "f" {
					want = util.SeriesCardThumbnailURL(&model.Series{ID: "f", UpdatedAt: stamp, ThumbnailVersion: autoVersion, LastContentUpdatedAt: s.LastContentUpdatedAt})
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
	assertURLs(7, 0, false)
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
	assertURLs(7, 0, false)
	execSQL(`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('progress-volume','s','Progress volume',1,'/progress')`)
	execSQL(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('chapter','progress-volume','Chapter',1,'/chapter',10)`)
	volumeID, chapterID := "progress-volume", "chapter"
	progress := model.ReadingProgress{UserID: "u", SeriesID: "s", VolumeID: &volumeID, ChapterID: &chapterID, CurrentPage: 4, TotalPages: 10, ProgressPercent: 40}
	if err := repository.NewReadingProgressRepository().Upsert(nil, &progress); err != nil {
		t.Fatal(err)
	}
	assertURLs(7, 0, false)
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
	assertURLs(8, 1, true)
	assertImage(util.BuildHomeSeriesThumbnailURL("s", stamp, 8), blue)
	assertImage(util.BuildHomeVolumeThumbnailURL("v", stamp, 4), blue)
	assertURLs(8, 1, false)

	queries.reset()
	response, err := app.Test(httptest.NewRequest("DELETE", "/api/v1/series/s/thumbnail", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var deleted model.Series
	if err := json.NewDecoder(response.Body).Decode(&deleted); err != nil {
		t.Fatal(err)
	}
	queries.assertNoPages(t)
	persisted, err := sr.FindByID(nil, "s", "u")
	if err != nil || persisted == nil {
		t.Fatalf("read after deletion: %v", err)
	}
	if response.StatusCode != 200 || persisted.ThumbnailPath != nil || deleted.ThumbnailURL == nil || *deleted.ThumbnailURL != util.SeriesCardThumbnailURL(persisted) {
		t.Fatalf("unexpected delete response: status=%d url=%v", response.StatusCode, deleted.ThumbnailURL)
	}
}

func TestSeriesThumbnailFallbackOrder(t *testing.T) {
	dir := t.TempDir()
	queries := openCountedDB(t, filepath.Join(dir, "covers.db"))
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := database.DB.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	cover := func(name string) string {
		t.Helper()
		path := filepath.Join(dir, name+".svg")
		if err := os.WriteFile(path, []byte("<svg><title>"+name+"</title></svg>"), 0600); err != nil {
			t.Fatal(err)
		}
		return path
	}
	exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`)
	exec(`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES ('s','lib','S','/s',?)`, cover("series"))
	exec(`INSERT INTO volumes(id,series_id,title,path,volume_number,thumbnail_path) VALUES ('v','s','V','/v',1,?)`, cover("volume"))
	exec(`INSERT INTO chapters(id,volume_id,title,path,chapter_number) VALUES ('c','v','C','/c',1)`)
	exec(`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('p','c',1,?)`, cover("page"))

	h := &ImageHandler{seriesRepo: repository.NewSeriesRepository(), volumeRepo: repository.NewVolumeRepository(), chapterRepo: repository.NewChapterRepository(), pageRepo: repository.NewPageRepository(), config: &config.Config{DataDir: dir}}
	app := fiber.New()
	app.Get("/series/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "series")
		c.Locals("role", model.RoleMaster)
		return h.GetThumbnail(c)
	})
	assertCover := func(status int, name string) {
		t.Helper()
		response, err := app.Test(httptest.NewRequest("GET", "/series/s/thumbnail?width=400", nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		body, err := io.ReadAll(response.Body)
		if err != nil || response.StatusCode != status || (status == 200 && string(body) != "<svg><title>"+name+"</title></svg>") {
			t.Fatalf("want %d %q: got %d %s (%v)", status, name, response.StatusCode, body, err)
		}
	}

	assertLookups := func(want int) {
		t.Helper()
		got := 0
		for _, q := range queries.snapshot() {
			if strings.Contains(q, "FROM pages p") && strings.Contains(q, "ORDER BY") {
				got++
			}
		}
		if got != want {
			t.Fatalf("ordered first-page searches = %d, want %d", got, want)
		}
		queries.reset()
	}
	assertCover(200, "series")
	assertLookups(0)
	exec(`UPDATE series SET thumbnail_path=NULL WHERE id='s'`)
	assertCover(200, "page")
	assertLookups(1)
	var cached string
	if err := database.DB.QueryRow(`SELECT cover_page_id FROM series WHERE id='s'`).Scan(&cached); err != nil || cached != "p" {
		t.Fatalf("cached page = %q, err = %v", cached, err)
	}
	assertCover(200, "page")
	assertLookups(0)
	exec(`DELETE FROM pages WHERE id='p'`)
	exec(`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('next','c',2,?)`, cover("next"))
	assertCover(200, "next")
	assertLookups(1)
	assertCover(200, "next")
	assertLookups(0)

	// Use the scanner's volume creation path and insert a new earlier page.
	if err := h.volumeRepo.Create(nil, &model.Volume{ID: "earlier", SeriesID: "s", Title: "Earlier", Path: "/earlier", VolumeNumber: 0}); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO chapters(id,volume_id,title,path,chapter_number) VALUES ('early','earlier','C','/early',1)`)
	exec(`INSERT INTO pages(id,chapter_id,page_number,path) VALUES ('first','early',1,?)`, cover("first"))
	exec(`CREATE TRIGGER fail_cache BEFORE UPDATE OF cover_page_id ON series BEGIN SELECT RAISE(ABORT, 'cache unavailable'); END`)
	assertCover(200, "first")
	assertLookups(1)
	exec(`DROP TRIGGER fail_cache`)
	assertCover(200, "first")
	assertLookups(1)
	exec(`DELETE FROM volumes WHERE id='earlier'`)
	exec(`DELETE FROM pages WHERE id='next'`)
	assertCover(200, "volume")
	exec(`UPDATE volumes SET thumbnail_path=NULL WHERE id='v'`)
	assertCover(404, "")

	epub, err := os.Create(filepath.Join(dir, "book.epub"))
	if err != nil {
		t.Fatal(err)
	}
	archive := zip.NewWriter(epub)
	for name, body := range map[string]string{
		"META-INF/container.xml": `<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>`,
		"book.opf":               `<package><manifest><item id="cover" href="cover.svg" media-type="image/svg+xml" properties="cover-image"/></manifest></package>`,
		"cover.svg":              "<svg><title>epub</title></svg>",
	} {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := io.WriteString(entry, body); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := epub.Close(); err != nil {
		t.Fatal(err)
	}
	exec(`UPDATE chapters SET path=? WHERE id='c'`, epub.Name())
	assertCover(200, "epub")
	assertCover(200, "epub")
	var custom bool
	if err := database.DB.QueryRow(`SELECT thumbnail_path IS NOT NULL FROM series WHERE id='s'`).Scan(&custom); err != nil || custom {
		t.Fatalf("EPUB fallback stored as custom cover: %t, err=%v", custom, err)
	}
}
