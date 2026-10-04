package handler

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

func newViewerSwipeTestApp(t *testing.T) (*fiber.App, *SeriesHandler) {
	t.Helper()
	if err := database.Connect(filepath.Join(t.TempDir(), "viewer-swipe.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	for _, query := range []string{
		`INSERT INTO users(id,username,nickname,password_hash,role) VALUES ('u','u','u','test','USER'),('other','other','other','test','USER')`,
		`INSERT INTO libraries(id,name) VALUES ('lib','Library')`,
		`INSERT INTO series(id,library_id,title,path) VALUES ('A','lib','A','/A'),('B','lib','B','/B'),('C','lib','C','/C')`,
		`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES ('A1','A','A1',1,'/A/1'),('B1','B','B1',1,'/B/1'),('B2','B','B2',2,'/B/2'),('C1','C','C1',1,'/C/1')`,
		`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES ('a','A1','a',1,'/A/1/a.cbz',1),('b1','B1','b1',1,'/B/1/b1.cbz',1),('b2','B1','b2',2,'/B/1/b2.cbz',1),('b3','B2','b3',1,'/B/2/b3.cbz',1),('c','C1','c',1,'/C/1/c.cbz',1)`,
	} {
		if _, err := database.DB.Exec(query); err != nil {
			t.Fatal(err)
		}
	}
	h := &SeriesHandler{
		chapterRepo: repository.NewChapterRepository(), volumeRepo: repository.NewVolumeRepository(),
		seriesRepo: repository.NewSeriesRepository(), libraryRepo: repository.NewLibraryRepository(),
		progressRepo: repository.NewReadingProgressRepository(), pageRepo: repository.NewPageRepository(),
		userSeriesSettingRepo: repository.NewUserSeriesSettingRepository(), settingRepo: repository.NewSettingRepository(),
		userSettingRepo: repository.NewUserSettingRepository(),
	}
	app := fiber.New()
	app.Use(func(c *fiber.Ctx) error {
		userID := c.Get("X-Test-User")
		if userID == "" {
			userID = "u"
		}
		c.Locals("userID", userID)
		c.Locals("role", model.RoleUser)
		return c.Next()
	})
	app.Get("/viewer/init/:chapterId", h.GetViewerInitData)
	settings := NewSettingHandler(repository.NewSettingRepository(), repository.NewUserSettingRepository(), nil)
	app.Get("/settings", settings.ListSettings)
	app.Put("/settings/:key", settings.UpdateSetting)
	app.Patch("/series/:id/viewer-settings", h.UpdateViewerSettings)
	app.Get("/series/:id/viewer-settings/swipe-direction", h.GetSwipeSettings)
	app.Delete("/series/:id/viewer-settings/swipe-direction", h.ResetSwipeDirection)
	return app, h
}

func swipeTestGet(t *testing.T, app *fiber.App, path string) map[string]json.RawMessage {
	t.Helper()
	response, err := app.Test(httptest.NewRequest("GET", path, nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("GET %s: status %d", path, response.StatusCode)
	}
	var body map[string]json.RawMessage
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	return body
}

func TestViewerSwipeUserDefaultIsSeparateFromServerSettings(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	if err := repository.NewUserSettingRepository().Update(nil, "u", "swipe_direction", "rtl"); err != nil {
		t.Fatal(err)
	}
	if err := repository.NewSettingRepository().Update(nil, "swipe_direction", "ltr"); err != nil {
		t.Fatal(err)
	}
	body := swipeTestGet(t, app, "/viewer/init/a")
	var swipe struct {
		UserDefault        string `json:"user_default"`
		EffectiveDirection string `json:"effective_direction"`
	}
	if err := json.Unmarshal(body["swipe_settings"], &swipe); err != nil {
		t.Fatalf("missing typed swipe settings: %v", err)
	}
	if swipe.UserDefault != "rtl" || swipe.EffectiveDirection != "rtl" {
		t.Fatalf("swipe settings = %+v, want user rtl/effective rtl", swipe)
	}
}

func TestViewerSwipeGlobalSettingsUserQueryFailure(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	// Fail only the user settings read; the server settings query still succeeds.
	if _, err := database.DB.Exec(`ALTER TABLE user_settings RENAME TO unavailable_user_settings`); err != nil {
		t.Fatal(err)
	}
	response, err := app.Test(httptest.NewRequest("GET", "/settings", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("user settings DB error: status %d, want 500 (not a successful ltr fallback)", response.StatusCode)
	}
}

func TestViewerSwipeGlobalSettingsIgnoreServerFallback(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	if err := repository.NewSettingRepository().Update(nil, "swipe_direction", "rtl"); err != nil {
		t.Fatal(err)
	}
	body := swipeTestGet(t, app, "/settings")
	var direction string
	if err := json.Unmarshal(body["swipe_direction"], &direction); err != nil {
		t.Fatal(err)
	}
	if direction != "ltr" {
		t.Fatalf("global viewer direction = %q, want ltr without a user default", direction)
	}
}
