package handler

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

func TestBatchGetExtensionsPreservesSingleAndMixedFormats(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "extensions.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, statement := range []string{
		`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Library','LOCAL','book')`,
		`INSERT INTO series(id,library_id,title,path,extension) VALUES ('pdf','lib','PDF series','/pdf','PDF'),('mixed','lib','Mixed series','/mixed','MIX'),('empty','lib','Empty series','/empty',''),('other','lib','Other series','/other','CBZ')`,
	} {
		if _, err := database.DB.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	h := &SeriesHandler{seriesRepo: repository.NewSeriesRepository()}
	app := fiber.New()
	app.Post("/api/v1/series/extensions/batch", h.BatchGetExtensions)
	for _, tc := range []struct {
		name string
		body string
		want map[string]string
	}{
		{"stored single and mixed formats", `{"series_ids":["pdf","mixed","empty","missing","pdf"]}`, map[string]string{"pdf": "PDF", "mixed": "MIX", "empty": ""}},
		{"empty batch", `{"series_ids":[]}`, map[string]string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/v1/series/extensions/batch", strings.NewReader(tc.body))
			req.Header.Set("Content-Type", "application/json")
			response, err := app.Test(req, -1)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			if response.StatusCode != 200 {
				t.Fatalf("status = %d, want 200", response.StatusCode)
			}
			var payload struct {
				Extensions map[string]string `json:"extensions"`
			}
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(payload.Extensions, tc.want) {
				t.Fatalf("extensions = %v, want %v", payload.Extensions, tc.want)
			}
		})
	}
}
