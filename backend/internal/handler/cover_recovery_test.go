package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
)

func newCoverTestApp(dir string) (*ImageHandler, *fiber.App) {
	h := NewImageHandler(repository.NewPageRepository(), repository.NewChapterRepository(), repository.NewVolumeRepository(), repository.NewSeriesRepository(), nil, &config.Config{DataDir: dir})
	app := fiber.New()
	app.Get("/api/v1/:type/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("role", model.RoleMaster)
		return h.GetThumbnail(c)
	})
	return h, app
}

func requestCover(t *testing.T, app *fiber.App, url string) []byte {
	t.Helper()
	response, err := app.Test(httptest.NewRequest("GET", url, nil), 3000)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	body, err := io.ReadAll(response.Body)
	if err != nil || response.StatusCode != 200 {
		t.Fatalf("GET %s: status %d, read error %v", url, response.StatusCode, err)
	}
	return body
}

func execCoverSQL(t *testing.T, query string, args ...any) {
	t.Helper()
	if _, err := database.DB.Exec(query, args...); err != nil {
		t.Fatal(err)
	}
}

func TestSeriesCoverAfterMetadataOnlyRescan(t *testing.T) {
	dir := t.TempDir()
	openCountedDB(t, filepath.Join(dir, "scan.db"))
	h, app := newCoverTestApp(dir)
	libraries := repository.NewLibraryRepository()
	s := scanner.NewScanner(libraries, h.seriesRepo, h.volumeRepo, h.chapterRepo, h.pageRepo, repository.NewSettingRepository(), h.config)
	library := &model.Library{Name: "Books", Paths: []string{t.TempDir()}, LibraryType: "book"}
	if err := libraries.Create(nil, library); err != nil {
		t.Fatal(err)
	}
	var covers [][]byte
	for i, volume := range []string{"1권", "2권"} {
		folder := filepath.Join(library.Paths[0], "Series")
		if err := os.MkdirAll(folder, 0o755); err != nil {
			t.Fatal(err)
		}
		img := image.NewGray(image.Rect(0, 0, 1, 1))
		img.SetGray(0, 0, color.Gray{Y: uint8(100 * i)})
		var buf bytes.Buffer
		if err := png.Encode(&buf, img); err != nil {
			t.Fatal(err)
		}
		var archive bytes.Buffer
		w := zip.NewWriter(&archive)
		entry, err := w.Create("001.png")
		if err != nil {
			t.Fatal(err)
		}
		if _, err = entry.Write(buf.Bytes()); err != nil {
			t.Fatal(err)
		}
		if err = w.Close(); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(folder, volume+".cbz"), archive.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
		covers = append(covers, buf.Bytes())
	}
	scan := func() {
		t.Helper()
		result, err := s.ScanLibrary(context.Background(), library)
		if err != nil || len(result.Errors) != 0 {
			t.Fatalf("scan: %+v, error %v", result, err)
		}
	}
	scan()
	// Seed legacy numbering. The files and their modification times stay intact.
	execCoverSQL(t, "UPDATE volumes SET volume_number=0 WHERE volume_number=2")
	var seriesID string
	if err := database.DB.QueryRow("SELECT id FROM series").Scan(&seriesID); err != nil {
		t.Fatal(err)
	}
	oldPage, err := h.seriesRepo.GetFirstPageID(nil, seriesID)
	if err != nil {
		t.Fatal(err)
	}
	execCoverSQL(t, "UPDATE series SET cover_page_id=? WHERE id=?", oldPage, seriesID)
	readSeries := func() *model.Series {
		t.Helper()
		series, readErr := h.seriesRepo.FindByID(nil, seriesID, "")
		if readErr != nil || series == nil {
			t.Fatalf("read series: %v", readErr)
		}
		return series
	}
	before := readSeries()
	oldURL := util.SeriesCardThumbnailURL(before)
	if !bytes.Equal(requestCover(t, app, oldURL), covers[1]) {
		t.Fatal("expected the second volume's image before renumbering")
	}
	scan()
	var remembered sql.NullString
	if err = database.DB.QueryRow("SELECT cover_page_id FROM series WHERE id=?", seriesID).Scan(&remembered); err != nil || remembered.Valid {
		t.Fatalf("remembered page after renumbering = %v, error %v", remembered, err)
	}
	after := readSeries()
	url := util.SeriesCardThumbnailURL(after)
	if url == oldURL || !before.UpdatedAt.Equal(after.UpdatedAt) || !before.LastContentUpdatedAt.Equal(after.LastContentUpdatedAt) {
		t.Fatalf("expected only the thumbnail version to change: %s -> %s", oldURL, url)
	}
	if !bytes.Equal(requestCover(t, app, url), covers[0]) {
		t.Fatal("expected the first volume's image after renumbering")
	}
}
