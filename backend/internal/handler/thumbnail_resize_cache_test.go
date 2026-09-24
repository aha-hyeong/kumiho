package handler

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

func TestThumbnailResizeDiskCache(t *testing.T) {
	dataDir, libraryDir := t.TempDir(), t.TempDir()
	source := filepath.Join(libraryDir, "cover.png")
	writeImage := func(c color.RGBA) {
		t.Helper()
		img := image.NewRGBA(image.Rect(0, 0, 400, 400))
		for y := 0; y < 400; y++ {
			for x := 0; x < 400; x++ {
				img.SetRGBA(x, y, c)
			}
		}
		file, err := os.Create(source)
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(file, img); err != nil {
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			t.Fatal(err)
		}
	}
	writeImage(color.RGBA{R: 255, A: 255})
	var reads, resizes atomic.Int32
	read := func() ([]byte, string, error) {
		reads.Add(1)
		data, err := os.ReadFile(source)
		return data, "image/png", err
	}
	h := &ImageHandler{}
	resize := func(data []byte, width int) ([]byte, error) {
		resizes.Add(1)
		return h.resizeImage(data, width)
	}
	cache := &thumbnailResizeCache{}
	load := func() []byte {
		t.Helper()
		data, typ, err := cache.load(dataDir, source, "", 120, 0, read, resize)
		if err != nil || typ != "image/jpeg" {
			t.Fatalf("load type=%s err=%v", typ, err)
		}
		return data
	}
	start := time.Now()
	first := load()
	cold := time.Since(start)
	if reads.Load() != 1 || resizes.Load() != 1 {
		t.Fatalf("cold reads=%d resizes=%d", reads.Load(), resizes.Load())
	}
	cache = &thumbnailResizeCache{} // emulate a new handler/process
	start = time.Now()
	if !bytes.Equal(load(), first) {
		t.Fatal("warm result changed")
	}
	warm := time.Since(start)
	if reads.Load() != 1 || resizes.Load() != 1 {
		t.Fatalf("warm reprocessed source: reads=%d resizes=%d", reads.Load(), resizes.Load())
	}
	t.Logf("thumbnail cold=%s warm=%s (test fixture, not HTTP)", cold, warm)
	writeImage(color.RGBA{B: 255, A: 255})
	stamp := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(source, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make([][]byte, 20)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			data, typ, err := cache.load(dataDir, source, "", 120, 0, read, resize)
			if err != nil || typ != "image/jpeg" {
				t.Errorf("concurrent load type=%s err=%v", typ, err)
			}
			results[i] = data
		}(i)
	}
	wg.Wait()
	if reads.Load() != 2 || resizes.Load() != 2 || bytes.Equal(results[0], first) {
		t.Fatalf("replacement: reads=%d resizes=%d changed=%t", reads.Load(), resizes.Load(), !bytes.Equal(results[0], first))
	}
	if _, _, err := cache.load(dataDir, source, "", 120, 1, read, resize); err != nil || reads.Load() != 3 || resizes.Load() != 3 {
		t.Fatalf("thumbnail version invalidation: reads=%d resizes=%d err=%v", reads.Load(), resizes.Load(), err)
	}
	files, err := os.ReadDir(filepath.Join(dataDir, "cache", "thumbnail-resize"))
	if err != nil || len(files) != 1 {
		t.Fatalf("cache files=%d err=%v", len(files), err)
	}
	if _, err := os.Stat(filepath.Join(libraryDir, "cache")); !os.IsNotExist(err) {
		t.Fatalf("library was modified: %v", err)
	}
}

func TestThumbnailDiskCacheDoesNotBypassPermission(t *testing.T) {
	dir := t.TempDir()
	if err := database.Connect(filepath.Join(dir, "thumb.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	source := filepath.Join(t.TempDir(), "cover.png")
	file, err := os.Create(source)
	if err != nil {
		t.Fatal(err)
	}
	if err := png.Encode(file, image.NewRGBA(image.Rect(0, 0, 400, 400))); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	for _, row := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`, nil},
		{`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES ('s','lib','S','/s',?)`, []any{source}},
	} {
		if _, err := database.DB.Exec(row.query, row.args...); err != nil {
			t.Fatal(err)
		}
	}
	h := NewImageHandler(repository.NewPageRepository(), repository.NewChapterRepository(), repository.NewVolumeRepository(), repository.NewSeriesRepository(), service.NewAuthService(repository.NewUserRepository(), repository.NewSessionRepository(), &config.Config{}), &config.Config{DataDir: dir})
	app := fiber.New()
	app.Get("/series/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "series")
		c.Locals("userID", "unauthorized")
		if c.Get("X-Master") != "" {
			c.Locals("role", model.RoleMaster)
		}
		return h.GetThumbnail(c)
	})
	request := func(master bool) int {
		t.Helper()
		req := httptest.NewRequest("GET", "/series/s/thumbnail?width=120", nil)
		if master {
			req.Header.Set("X-Master", "1")
		}
		res, err := app.Test(req, -1)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		return res.StatusCode
	}
	if got := request(true); got != 200 {
		t.Fatalf("master cold=%d", got)
	}
	if got := request(false); got != 403 {
		t.Fatalf("unauthorized warm=%d", got)
	}
}
