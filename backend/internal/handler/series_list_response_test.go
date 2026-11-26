package handler

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

// 라이브러리 목록 응답은 카드에 필요 없는 긴 설명을 싣지 않고, 상세 응답은 그대로 싣는다.
func TestListByLibraryOmitsDescriptionsButDetailKeepsThem(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "list-response.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, q := range []string{
		`INSERT INTO users(id,username,nickname,password_hash) VALUES ('u','fixture','Fixture','unused')`,
		`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book'),('liked','Liked','SYSTEM','book')`,
		`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES ('s','lib','Series','/series','/cover.jpg')`,
		`INSERT INTO series_metadata(series_id,description,description_translated,authors,original_title) VALUES ('s','긴 설명','translated','["작가"]','原題')`,
		`INSERT INTO user_bookmarks(user_id,series_id) VALUES ('u','s')`,
	} {
		if _, err := database.DB.Exec(q); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
	}
	sr, vr := repository.NewSeriesRepository(), repository.NewVolumeRepository()
	h := &SeriesHandler{seriesRepo: sr, volumeRepo: vr, libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository(), seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), vr)}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() })
	app.Get("/api/v1/libraries/:libraryId/series", h.ListByLibrary)
	app.Get("/api/v1/series/:id", h.GetSeries)

	for _, route := range []string{"/api/v1/libraries/lib/series", "/api/v1/libraries/liked/series"} {
		resp, err := app.Test(httptest.NewRequest("GET", route, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Series []model.Series `json:"series"`
		}
		err = json.NewDecoder(resp.Body).Decode(&payload)
		resp.Body.Close()
		if err != nil || resp.StatusCode != 200 || len(payload.Series) != 1 {
			t.Fatalf("%s status=%d err=%v len=%d", route, resp.StatusCode, err, len(payload.Series))
		}
		s := payload.Series[0]
		if s.Description != "" || s.Metadata == nil || s.Metadata.Description != "" || s.Metadata.DescriptionTranslated != "" {
			t.Errorf("%s should omit descriptions: description=%q metadata=%+v", route, s.Description, s.Metadata)
		}
		if s.Metadata == nil || s.Metadata.Authors != `["작가"]` || s.Metadata.OriginalTitle != "原題" || !s.IsBookmarked {
			t.Errorf("%s dropped card fields: %+v bookmarked=%v", route, s.Metadata, s.IsBookmarked)
		}
	}

	resp, err := app.Test(httptest.NewRequest("GET", "/api/v1/series/s", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	var detail model.Series
	err = json.NewDecoder(resp.Body).Decode(&detail)
	resp.Body.Close()
	if err != nil || detail.Description != "긴 설명" || detail.Metadata == nil || detail.Metadata.DescriptionTranslated != "translated" {
		t.Fatalf("detail should keep descriptions: err=%v description=%q metadata=%+v", err, detail.Description, detail.Metadata)
	}
}
