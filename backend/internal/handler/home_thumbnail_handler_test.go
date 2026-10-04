package handler

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
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
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/gofiber/fiber/v2"
)

func TestHomeThumbnailCacheInvalidationAfterReplacement(t *testing.T) {
	for _, target := range []string{"series", "volumes"} {
		for _, source := range []string{"upload", "url"} {
			t.Run(target+"/"+source, func(t *testing.T) {
				dir := t.TempDir()
				if err := database.Connect(filepath.Join(dir, "home.db")); err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = database.Close(); database.DB = nil })
				exec := func(q string, args ...any) {
					t.Helper()
					if _, err := database.DB.Exec(q, args...); err != nil {
						t.Fatal(err)
					}
				}
				originalTime := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
				exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`)
				exec(`INSERT INTO series(id,library_id,title,path,updated_at,last_content_updated_at) VALUES ('s','lib','S','/s',?,?)`, originalTime, time.Now())
				exec(`INSERT INTO volumes(id,series_id,title,volume_number,path,updated_at) VALUES ('v','s','V',1,'/v',?)`, originalTime)
				sr, vr := repository.NewSeriesRepository(), repository.NewVolumeRepository()
				h := &SeriesHandler{seriesRepo: sr, volumeRepo: vr, libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository(), config: &config.Config{DataDir: dir}, seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), vr)}
				app := fiber.New()
				app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
				app.Get("/series/home", h.GetHomeSeries)
				app.Post("/series/:id/thumbnail", h.UploadThumbnail)
				app.Post("/series/:id/thumbnail/url", h.DownloadThumbnail)
				app.Post("/volumes/:id/thumbnail", h.UploadVolumeThumbnail)
				app.Post("/volumes/:id/thumbnail/url", h.UploadVolumeThumbnailFromURL)
				var imageData bytes.Buffer
				if err := png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
					t.Fatal(err)
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "image/png")
					_, _ = w.Write(imageData.Bytes())
				}))
				defer server.Close()
				id := "s"
				if target == "volumes" {
					id = "v"
				}
				var previousURL, previousPath string
				for attempt := 0; attempt < 2; attempt++ {
					endpoint := "/" + target + "/" + id + "/thumbnail"
					var request *http.Request
					if source == "url" {
						payload, _ := json.Marshal(map[string]string{"url": server.URL})
						request = httptest.NewRequest("POST", endpoint+"/url", bytes.NewReader(payload))
						request.Header.Set("Content-Type", "application/json")
					} else {
						var body bytes.Buffer
						writer := multipart.NewWriter(&body)
						part, err := writer.CreateFormFile("thumbnail", "cover.png")
						if err != nil {
							t.Fatal(err)
						}
						if _, err := part.Write(imageData.Bytes()); err != nil {
							t.Fatal(err)
						}
						if err := writer.Close(); err != nil {
							t.Fatal(err)
						}
						request = httptest.NewRequest("POST", endpoint, &body)
						request.Header.Set("Content-Type", writer.FormDataContentType())
					}
					response, err := app.Test(request, -1)
					if err != nil {
						t.Fatal(err)
					}
					var replacement struct {
						ThumbnailURL string `json:"thumbnail_url"`
					}
					decodeErr := json.NewDecoder(response.Body).Decode(&replacement)
					response.Body.Close()
					if decodeErr != nil {
						t.Fatal(decodeErr)
					}
					if response.StatusCode != 200 {
						t.Fatalf("replacement status=%d", response.StatusCode)
					}
					response, err = app.Test(httptest.NewRequest("GET", "/series/home?section=updated", nil), -1)
					if err != nil {
						t.Fatal(err)
					}
					var payload struct {
						Updated []model.Series `json:"updated_series"`
					}
					err = json.NewDecoder(response.Body).Decode(&payload)
					response.Body.Close()
					if err != nil {
						t.Fatal(err)
					}
					if response.StatusCode != 200 || len(payload.Updated) != 1 || payload.Updated[0].ThumbnailURL == nil {
						t.Fatalf("Home response status=%d %+v", response.StatusCode, payload)
					}
					url := *payload.Updated[0].ThumbnailURL
					if !strings.Contains(url, "?t=db-") {
						t.Fatalf("not DB-only URL: %s", url)
					}
					var path string
					var version int
					var updated time.Time
					if err := database.DB.QueryRow(`SELECT thumbnail_path,thumbnail_version,updated_at FROM `+target+` WHERE id=?`, id).Scan(&path, &version, &updated); err != nil {
						t.Fatal(err)
					}
					if version != attempt+1 {
						t.Fatalf("version=%d for attempt=%d", version, attempt)
					}
					if target == "volumes" && !updated.Equal(originalTime) {
						t.Fatalf("volume content timestamp changed: %s", updated)
					}
					want := util.BuildHomeSeriesThumbnailURL(id, updated, int64(version))
					if target == "volumes" {
						want = util.BuildHomeVolumeThumbnailURL(id, updated, int64(version))
					}
					if replacement.ThumbnailURL != want {
						t.Fatalf("%s replacement response URL=%s, want persisted version %s", target, replacement.ThumbnailURL, want)
					}
					if attempt > 0 && (url == previousURL || path != previousPath) {
						t.Fatalf("same-path replacement: URL %s -> %s, path %s -> %s", previousURL, url, previousPath, path)
					}
					previousURL, previousPath = url, path
				}
			})
		}
	}
}

func TestRecentProgressThumbnailCacheIdentity(t *testing.T) {
	for _, source := range []string{"series", "volume", "first-volume"} {
		t.Run(source, func(t *testing.T) {
			dir := t.TempDir()
			if err := database.Connect(filepath.Join(dir, "recent-progress.db")); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = database.Close(); database.DB = nil })
			execSQL := func(query string, args ...any) {
				t.Helper()
				if _, err := database.DB.Exec(query, args...); err != nil {
					t.Fatal(err)
				}
			}
			stamp := time.Date(2026, 10, 4, 1, 2, 3, 456, time.UTC)
			cover := filepath.Join(dir, "cover.svg")
			red := `<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1" fill="red"/></svg>`
			blue := strings.ReplaceAll(red, "red", "blue")
			writeCover := func(contents string) {
				t.Helper()
				if err := os.WriteFile(cover, []byte(contents), 0600); err != nil {
					t.Fatal(err)
				}
				mtime := time.Unix(946684800, 0)
				if err := os.Chtimes(cover, mtime, mtime); err != nil {
					t.Fatal(err)
				}
			}
			writeCover(red)
			var seriesCover, currentCover, firstCover any
			switch source {
			case "series":
				seriesCover = cover
			case "volume":
				currentCover = cover
			case "first-volume":
				firstCover = cover
			}
			execSQL(`INSERT INTO users(id,username,nickname,password_hash) VALUES ('u','fixture','Fixture','unused')`)
			execSQL(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`)
			execSQL(`INSERT INTO series(id,library_id,title,path,thumbnail_path,thumbnail_version,updated_at) VALUES ('s','lib','Series','/series',?,7,?)`, seriesCover, stamp)
			execSQL(`INSERT INTO volumes(id,series_id,title,volume_number,path,thumbnail_path,thumbnail_version,updated_at)
				VALUES ('first','s','First',1,'/first',?,7,?), ('current','s','Current',2,'/current',?,7,?)`, firstCover, stamp, currentCover, stamp)
			execSQL(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('chapter','current','Chapter',1,'/chapter',10)`)
			sr, vr := repository.NewSeriesRepository(), repository.NewVolumeRepository()
			pr := repository.NewReadingProgressRepository()
			volumeID, chapterID := "current", "chapter"
			progress := model.ReadingProgress{UserID: "u", SeriesID: "s", VolumeID: &volumeID, ChapterID: &chapterID, CurrentPage: 1, TotalPages: 10, ProgressPercent: 10}
			if err := pr.Upsert(nil, &progress); err != nil {
				t.Fatal(err)
			}
			h := &ProgressHandler{progressRepo: pr, seriesRepo: sr, volumeRepo: vr, chapterRepo: repository.NewChapterRepository(), libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository()}
			ih := &ImageHandler{seriesRepo: sr, volumeRepo: vr, config: &config.Config{DataDir: dir}}
			app := fiber.New()
			app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
			app.Get("/api/v1/reading-progress/recent", h.GetRecentProgress)
			app.Get("/api/v1/:type/:id/thumbnail", ih.GetThumbnail)
			fetch := func() (model.ReadingProgress, string) {
				t.Helper()
				response, err := app.Test(httptest.NewRequest("GET", "/api/v1/reading-progress/recent", nil), -1)
				if err != nil {
					t.Fatal(err)
				}
				var payload struct {
					Recent []struct {
						model.ReadingProgress
						ThumbnailURL string `json:"thumbnail_url"`
					} `json:"recent_progress"`
				}
				decodeErr := json.NewDecoder(response.Body).Decode(&payload)
				response.Body.Close()
				if response.StatusCode != 200 || decodeErr != nil || len(payload.Recent) != 1 || payload.Recent[0].ThumbnailURL == "" {
					t.Fatalf("recent progress status=%d err=%v payload=%+v", response.StatusCode, decodeErr, payload)
				}
				return payload.Recent[0].ReadingProgress, payload.Recent[0].ThumbnailURL
			}
			assertImage := func(url, contents string) {
				t.Helper()
				response, err := app.Test(httptest.NewRequest("GET", url, nil), -1)
				if err != nil {
					t.Fatal(err)
				}
				body, readErr := io.ReadAll(response.Body)
				response.Body.Close()
				if response.StatusCode != 200 || readErr != nil || string(body) != contents {
					t.Fatalf("thumbnail %s: status=%d err=%v body=%s", url, response.StatusCode, readErr, body)
				}
				if response.Header.Get("Cache-Control") != "public, max-age=86400" {
					t.Error("existing thumbnail cache policy changed")
				}
			}
			beforeProgress, beforeURL := fetch()
			assertImage(beforeURL, red)
			progress.CurrentPage, progress.ProgressPercent = 4, 40
			if err := pr.Upsert(nil, &progress); err != nil {
				t.Fatal(err)
			}
			afterProgress, progressURL := fetch()
			if afterProgress.CurrentPage != 4 || afterProgress.ProgressPercent != 40 || !afterProgress.UpdatedAt.After(beforeProgress.UpdatedAt) {
				t.Fatalf("progress update not reflected: before=%+v after=%+v", beforeProgress, afterProgress)
			}
			if progressURL != beforeURL {
				t.Errorf("progress-only update changed thumbnail URL: %s -> %s", beforeURL, progressURL)
			}
			writeCover(blue) // Same path and mtime: only the DB version invalidates.
			table, id := "volumes", "current"
			if source == "series" {
				table, id = "series", "s"
				series, err := sr.FindByID(nil, id, "u")
				if err != nil || series == nil {
					t.Fatalf("load series: %v", err)
				}
				if updateErr := sr.UpdateThumbnail(nil, series); updateErr != nil {
					t.Fatal(updateErr)
				}
			} else {
				if source == "first-volume" {
					id = "first"
				}
				volume, err := vr.FindByID(nil, id)
				if err != nil || volume == nil {
					t.Fatalf("load volume: %v", err)
				}
				if updateErr := vr.UpdateThumbnail(nil, volume); updateErr != nil {
					t.Fatal(updateErr)
				}
			}
			var path string
			var version int64
			var updated time.Time
			if scanErr := database.DB.QueryRow(`SELECT thumbnail_path,thumbnail_version,updated_at FROM `+table+` WHERE id=?`, id).Scan(&path, &version, &updated); scanErr != nil {
				t.Fatal(scanErr)
			}
			if path != cover || version != 8 || !updated.Equal(stamp) {
				t.Fatalf("replacement changed wrong identity: path=%s version=%d updated=%s", path, version, updated)
			}
			_, afterURL := fetch()
			want := util.BuildHomeVolumeThumbnailURL(id, updated, version)
			if source == "series" {
				want = util.BuildHomeSeriesThumbnailURL(id, updated, version)
			}
			if afterURL == beforeURL || afterURL != want {
				t.Errorf("same-path/mtime replacement: URL %s -> %s, want persisted DB identity %s", beforeURL, afterURL, want)
			}
			assertImage(afterURL, blue)
			_, stableURL := fetch()
			if stableURL != afterURL {
				t.Error("unchanged thumbnail did not retain its URL")
			}
		})
	}
}
