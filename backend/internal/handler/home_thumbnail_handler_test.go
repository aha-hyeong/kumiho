package handler

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
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
					response.Body.Close()
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
					if attempt > 0 && (url == previousURL || path != previousPath) {
						t.Fatalf("same-path replacement: URL %s -> %s, path %s -> %s", previousURL, url, previousPath, path)
					}
					previousURL, previousPath = url, path
				}
			})
		}
	}
}
