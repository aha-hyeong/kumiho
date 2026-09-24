package handler

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

func TestHomeSeriesEndpointAppliesACLAndPreservesLikedCards(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "home.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, statement := range []string{
		`INSERT INTO libraries(id,name,type,library_type) VALUES ('public','Public','LOCAL','book'),('private','Private','LOCAL','book')`,
		`INSERT INTO users(id,username,nickname,password_hash,role) VALUES ('u','u','u','hash','USER')`,
		`INSERT INTO user_libraries(user_id,library_id) VALUES ('u','public')`,
		`INSERT INTO series(id,library_id,title,path,last_content_updated_at) VALUES ('p','public','Public series','/p',datetime('now')),('secret','private','Secret series','/secret',datetime('now'))`,
		`INSERT INTO user_bookmarks(user_id,series_id) VALUES ('u','p'),('u','secret')`,
	} {
		if _, err := database.DB.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
	sr := repository.NewSeriesRepository()
	h := &SeriesHandler{seriesRepo: sr, libraryRepo: repository.NewLibraryRepository(), authService: service.NewAuthService(repository.NewUserRepository(), nil, nil), volumeRepo: repository.NewVolumeRepository(), seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), repository.NewVolumeRepository()), settingRepo: repository.NewSettingRepository()}
	app := fiber.New()
	app.Get("/series/home", func(c *fiber.Ctx) error {
		c.Locals("userID", "u")
		if c.Query("role") == "master" {
			c.Locals("role", model.RoleMaster)
		} else {
			c.Locals("role", model.RoleUser)
		}
		return c.Next()
	}, h.GetHomeSeries)
	for _, role := range []string{"user", "master"} {
		req := httptest.NewRequest("GET", "/series/home?role="+role, nil)
		response, err := app.Test(req, -1)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Updated []model.Series `json:"updated_series"`
			Liked   []model.Series `json:"liked_series"`
		}
		if err = json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if response.StatusCode != 200 {
			t.Fatalf("%s: %d", role, response.StatusCode)
		}
		want := 1
		if role == "master" {
			want = 2
		}
		if len(payload.Updated) != want || len(payload.Liked) != want {
			t.Fatalf("%s: updated=%+v liked=%+v", role, payload.Updated, payload.Liked)
		}
		if !payload.Liked[0].IsBookmarked || payload.Liked[0].ID != "p" {
			t.Fatalf("liked card: %+v", payload.Liked)
		}
		if payload.Updated[0].DisplayTitle != "Public series" || payload.Updated[0].LibraryType != "book" {
			t.Fatalf("card fields: %+v", payload.Updated[0])
		}
	}
	for _, section := range []string{"updated", "liked"} {
		response, err := app.Test(httptest.NewRequest("GET", "/series/home?role=user&section="+section, nil), -1)
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Updated []model.Series `json:"updated_series"`
			Liked   []model.Series `json:"liked_series"`
		}
		if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		if section == "updated" && (len(payload.Updated) != 1 || len(payload.Liked) != 0) {
			t.Fatalf("updated section: %+v", payload)
		}
		if section == "liked" && (len(payload.Updated) != 0 || len(payload.Liked) != 1) {
			t.Fatalf("liked section: %+v", payload)
		}
	}
	// Match the old browser's parseInt behavior for fractional settings.
	if err := h.settingRepo.Update(nil, "updated_series_period", "0.5"); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`UPDATE series SET last_content_updated_at=datetime('now','-2 days') WHERE id='p'`); err != nil {
		t.Fatal(err)
	}
	response, requestErr := app.Test(httptest.NewRequest("GET", "/series/home?role=user&section=updated", nil), -1)
	if requestErr != nil {
		t.Fatal(requestErr)
	}
	var periodPayload struct {
		Updated []model.Series `json:"updated_series"`
	}
	if err := json.NewDecoder(response.Body).Decode(&periodPayload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(periodPayload.Updated) != 1 {
		t.Fatalf("fractional zero falls back to seven days: status=%d cards=%+v", response.StatusCode, periodPayload.Updated)
	}
	if err := h.settingRepo.Update(nil, "updated_series_period", "2.5"); err != nil {
		t.Fatal(err)
	}
	response, requestErr = app.Test(httptest.NewRequest("GET", "/series/home?role=user&section=updated", nil), -1)
	if requestErr != nil {
		t.Fatal(requestErr)
	}
	if err := json.NewDecoder(response.Body).Decode(&periodPayload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(periodPayload.Updated) != 0 {
		t.Fatalf("truncated two day period: status=%d cards=%+v", response.StatusCode, periodPayload.Updated)
	}
	if _, err := database.DB.Exec(`UPDATE series SET last_content_updated_at=datetime('now','-1 day') WHERE id='p'`); err != nil {
		t.Fatal(err)
	}
	response, requestErr = app.Test(httptest.NewRequest("GET", "/series/home?role=user&section=updated", nil), -1)
	if requestErr != nil {
		t.Fatal(requestErr)
	}
	if err := json.NewDecoder(response.Body).Decode(&periodPayload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(periodPayload.Updated) != 1 {
		t.Fatalf("period includes recent: status=%d cards=%+v", response.StatusCode, periodPayload.Updated)
	}
	for i := 0; i < 31; i++ {
		id := fmt.Sprintf("extra-%02d", i)
		if _, err := database.DB.Exec(`INSERT INTO series(id,library_id,title,path) VALUES (?,'public',?,?)`, id, id, "/"+id); err != nil {
			t.Fatal(err)
		}
		if _, err := database.DB.Exec(`INSERT INTO user_bookmarks(user_id,series_id) VALUES ('u',?)`, id); err != nil {
			t.Fatal(err)
		}
	}
	response, requestErr = app.Test(httptest.NewRequest("GET", "/series/home?role=user&section=liked", nil), -1)
	if requestErr != nil {
		t.Fatal(requestErr)
	}
	var boundedPayload struct {
		Liked []model.Series `json:"liked_series"`
	}
	if err := json.NewDecoder(response.Body).Decode(&boundedPayload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(boundedPayload.Liked) != 30 {
		t.Fatalf("Home likes are bounded: status=%d cards=%d", response.StatusCode, len(boundedPayload.Liked))
	}
	if _, err := database.DB.Exec(`DELETE FROM user_libraries WHERE user_id='u'`); err != nil {
		t.Fatal(err)
	}
	response, requestErr = app.Test(httptest.NewRequest("GET", "/series/home?role=user", nil), -1)
	if requestErr != nil {
		t.Fatal(requestErr)
	}
	var emptyPayload struct {
		Updated []model.Series `json:"updated_series"`
		Liked   []model.Series `json:"liked_series"`
	}
	if err := json.NewDecoder(response.Body).Decode(&emptyPayload); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || len(emptyPayload.Updated) != 0 || len(emptyPayload.Liked) != 0 {
		t.Fatalf("revoked access: status=%d cards=%+v", response.StatusCode, emptyPayload)
	}
}
