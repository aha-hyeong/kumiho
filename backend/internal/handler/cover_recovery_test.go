package handler

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

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

func TestMissingFirstVolumePDFCover(t *testing.T) {
	dir := t.TempDir()
	openCountedDB(t, filepath.Join(dir, "pdf.db"))
	_, app := newCoverTestApp(dir)
	execCoverSQL(t, `INSERT INTO libraries(id,name,type) VALUES ('lib','Books','LOCAL');
		INSERT INTO series(id,library_id,title,path) VALUES ('s','lib','Series','/series')`)
	execCoverSQL(t, `INSERT INTO volumes(id,series_id,title,path,volume_number,thumbnail_path)
		VALUES ('v','s','PDF',?,1,?)`, filepath.Join("testdata", "red-cover.pdf"), filepath.Join(dir, "missing.jpg"))
	for _, url := range []string{
		"/api/v1/series/s/thumbnail?width=0",
		"/api/v1/volumes/v/thumbnail?width=0&fallback=series",
	} {
		body := requestCover(t, app, url)
		img, err := jpeg.Decode(bytes.NewReader(body))
		if err != nil {
			t.Fatalf("%s: expected a rendered JPEG: %v", url, err)
		}
		r, g, b, _ := img.At(img.Bounds().Dx()/2, img.Bounds().Dy()/2).RGBA()
		if r < 0xf000 || g > 0x1000 || b > 0x1000 {
			t.Fatalf("%s: expected the red PDF page, got RGB(%d,%d,%d)", url, r, g, b)
		}
		var path string
		if err = database.DB.QueryRow("SELECT thumbnail_path FROM volumes WHERE id='v'").Scan(&path); err != nil {
			t.Fatal(err)
		}
		stored, readErr := os.ReadFile(path)
		if readErr != nil || !bytes.Equal(stored, body) {
			t.Fatalf("%s: stored volume cover differs from response, read error %v", url, readErr)
		}
		if err = os.Remove(path); err != nil {
			t.Fatal(err)
		}
	}
}

func TestCoverPageFillSkipsBusyWriter(t *testing.T) {
	dir := t.TempDir()
	queries := openCountedDB(t, filepath.Join(dir, "fills.db"))
	_, app := newCoverTestApp(dir)
	execCoverSQL(t, `INSERT INTO libraries(id,name,type) VALUES ('lib','Books','LOCAL')`)
	for _, id := range []string{"a", "b"} {
		path := filepath.Join(dir, id+".svg")
		if err := os.WriteFile(path, []byte("<svg><title>"+id+"</title></svg>"), 0o600); err != nil {
			t.Fatal(err)
		}
		execCoverSQL(t, "INSERT INTO series(id, library_id, title, path) VALUES (?, 'lib', ?, ?)", id, id, id)
		execCoverSQL(t, "INSERT INTO volumes(id, series_id, title, path, volume_number) VALUES (?,?,?,?,1)", id, id, id, id)
		execCoverSQL(t, "INSERT INTO chapters(id, volume_id, title, path, chapter_number) VALUES (?,?,?,?,1)", id, id, id, id)
		execCoverSQL(t, "INSERT INTO pages(id, chapter_id, path, page_number) VALUES (?,?,?,1)", id, id, path)
	}

	// Keep the first fill inside the SQLite driver until both HTTP requests return.
	fills := make(chan error, 2)
	unblock := make(chan struct{})
	release := sync.OnceFunc(func() { close(unblock) })
	defer release()
	queries.afterExec = func(query string, err error) {
		if strings.HasPrefix(query, "UPDATE series SET cover_page_id") {
			fills <- err
			<-unblock
		}
	}
	request := func(id string) {
		t.Helper()
		body := requestCover(t, app, "/api/v1/series/"+id+"/thumbnail")
		if string(body) != "<svg><title>"+id+"</title></svg>" {
			t.Fatalf("wrong cover for %s: %s", id, body)
		}
	}
	waitForFill := func() {
		t.Helper()
		select {
		case err := <-fills:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("expected a cover page cache write")
		}
	}
	request("a")
	waitForFill()
	request("b")
	release()
	// A queued fill would run when the first writer is released, without another request.
	select {
	case err := <-fills:
		t.Fatalf("second series scheduled a fill while the writer was busy: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	var page sql.NullString
	if err := database.DB.QueryRow("SELECT cover_page_id FROM series WHERE id='b'").Scan(&page); err != nil || page.Valid {
		t.Fatalf("skipped series cached page=%v, error %v", page, err)
	}
	request("b")
	waitForFill()
	if err := database.DB.QueryRow("SELECT cover_page_id FROM series WHERE id='b'").Scan(&page); err != nil || !page.Valid || page.String != "b" {
		t.Fatalf("retried series cached page=%v, error %v", page, err)
	}
}
