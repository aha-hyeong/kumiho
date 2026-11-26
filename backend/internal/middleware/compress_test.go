package middleware

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func newCompressTestApp() *fiber.App {
	app := fiber.New()
	app.Use(Compress())
	largeJSON := fiber.Map{"series": strings.Repeat("시리즈 설명 ", 500)}
	app.Get("/json", func(c *fiber.Ctx) error { return c.JSON(largeJSON) })
	app.Get("/small", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"ok": true}) })
	app.Get("/image", func(c *fiber.Ctx) error {
		c.Set(fiber.HeaderContentType, "image/jpeg")
		return c.Send(bytes.Repeat([]byte{0xff}, 4096))
	})
	app.Get("/partial", func(c *fiber.Ctx) error {
		c.Set(fiber.HeaderContentType, "text/plain")
		return c.Status(fiber.StatusPartialContent).SendString(strings.Repeat("a", 4096))
	})
	app.Get("/sse", func(c *fiber.Ctx) error {
		c.Set(fiber.HeaderContentType, "text/event-stream")
		c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
			_, _ = w.WriteString("data: " + strings.Repeat("x", 4096) + "\n\n")
			_ = w.Flush()
		})
		return nil
	})
	app.Get("/error", func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": strings.Repeat("e", 4096)})
	})
	return app
}

func TestCompressGzipsLargeJSON(t *testing.T) {
	app := newCompressTestApp()
	req := httptest.NewRequest(fiber.MethodGet, "/json", nil)
	req.Header.Set(fiber.HeaderAcceptEncoding, "gzip, deflate, br")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if got := resp.Header.Get(fiber.HeaderContentEncoding); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if got := resp.Header.Get(fiber.HeaderVary); !strings.Contains(got, fiber.HeaderAcceptEncoding) {
		t.Errorf("Vary = %q, want Accept-Encoding", got)
	}
	compressed, _ := io.ReadAll(resp.Body)
	r, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		t.Fatal(err)
	}
	plain, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(plain), `{"series":"시리즈 설명`) {
		t.Fatalf("decompressed body = %.40q", plain)
	}
	if len(compressed)*4 > len(plain) {
		t.Errorf("compressed %d bytes from %d, expected a large reduction", len(compressed), len(plain))
	}
}

func TestCompressSkipsUnsuitableResponses(t *testing.T) {
	app := newCompressTestApp()
	for _, tc := range []struct {
		name, path, acceptEncoding string
	}{
		{name: "client-without-gzip", path: "/json"},
		{name: "small-body", path: "/small", acceptEncoding: "gzip"},
		{name: "binary-image", path: "/image", acceptEncoding: "gzip"},
		{name: "partial-content", path: "/partial", acceptEncoding: "gzip"},
		{name: "event-stream", path: "/sse", acceptEncoding: "gzip"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(fiber.MethodGet, tc.path, nil)
			if tc.acceptEncoding != "" {
				req.Header.Set(fiber.HeaderAcceptEncoding, tc.acceptEncoding)
			}
			resp, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			if got := resp.Header.Get(fiber.HeaderContentEncoding); got != "" {
				t.Fatalf("Content-Encoding = %q, want none", got)
			}
			body, _ := io.ReadAll(resp.Body)
			if len(body) == 0 {
				t.Fatal("body should be passed through unchanged")
			}
		})
	}
}

func TestCompressGzipsJSONErrorBodies(t *testing.T) {
	app := newCompressTestApp()
	req := httptest.NewRequest(fiber.MethodGet, "/error", nil)
	req.Header.Set(fiber.HeaderAcceptEncoding, "gzip")
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusInternalServerError || resp.Header.Get(fiber.HeaderContentEncoding) != "gzip" {
		t.Fatalf("status=%d encoding=%q", resp.StatusCode, resp.Header.Get(fiber.HeaderContentEncoding))
	}
}

func TestAcceptsGzipParsesAcceptEncoding(t *testing.T) {
	for header, want := range map[string]bool{
		"gzip, deflate, br":  true,
		"gzip":               true,
		"br,gzip":            true,
		"GZIP":               true,
		"gzip;q=1":           true,
		"gzip; q=0.5, br":    true,
		"gzip;q=0":           false,
		"gzip;q=0.0, br":     false,
		"*":                  true,
		"br, *;q=0":          false,
		"*;q=0, gzip":        true,
		"gzip;q=0, *":        false,
		"identity":           false,
		"br, deflate":        false,
		"":                   false,
		"x-gzipped, br":      false,
		"gzip;q=invalid, br": false,
	} {
		if got := acceptsGzip(header); got != want {
			t.Errorf("acceptsGzip(%q) = %v, want %v", header, got, want)
		}
	}
}

func TestCompressVaryHeader(t *testing.T) {
	app := fiber.New()
	app.Use(Compress())
	large := strings.Repeat("시리즈 설명 ", 500)
	app.Get("/json", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"series": large}) })
	app.Get("/json-with-vary", func(c *fiber.Ctx) error {
		c.Vary(fiber.HeaderOrigin)
		return c.JSON(fiber.Map{"series": large})
	})
	app.Get("/small", func(c *fiber.Ctx) error { return c.JSON(fiber.Map{"ok": true}) })

	for _, tc := range []struct {
		name, path, acceptEncoding, wantEncoding string
		wantVary                                 []string
		noVary                                   bool
	}{
		{name: "compressed-no-space-list", path: "/json", acceptEncoding: "br,gzip", wantEncoding: "gzip", wantVary: []string{fiber.HeaderAcceptEncoding}},
		{name: "uncompressed-still-varies", path: "/json", acceptEncoding: "br", wantVary: []string{fiber.HeaderAcceptEncoding}},
		{name: "existing-vary-preserved", path: "/json-with-vary", acceptEncoding: "gzip", wantEncoding: "gzip", wantVary: []string{fiber.HeaderOrigin, fiber.HeaderAcceptEncoding}},
		{name: "small-body-no-vary", path: "/small", acceptEncoding: "gzip", noVary: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest(fiber.MethodGet, tc.path, nil)
			req.Header.Set(fiber.HeaderAcceptEncoding, tc.acceptEncoding)
			resp, err := app.Test(req)
			if err != nil {
				t.Fatal(err)
			}
			if got := resp.Header.Get(fiber.HeaderContentEncoding); got != tc.wantEncoding {
				t.Errorf("Content-Encoding = %q, want %q", got, tc.wantEncoding)
			}
			vary := strings.Join(resp.Header.Values(fiber.HeaderVary), ", ")
			if tc.noVary && strings.Contains(vary, fiber.HeaderAcceptEncoding) {
				t.Errorf("Vary = %q, want no Accept-Encoding", vary)
			}
			for _, field := range tc.wantVary {
				if !strings.Contains(vary, field) {
					t.Errorf("Vary = %q, want it to contain %s", vary, field)
				}
			}
			if strings.Count(vary, fiber.HeaderAcceptEncoding) > 1 {
				t.Errorf("Vary lists Accept-Encoding more than once: %q", vary)
			}
		})
	}
}
