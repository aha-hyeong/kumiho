package handler

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestViewerSwipeInitReadFailureDoesNotGuess(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	if _, err := database.DB.Exec(`DROP TABLE user_series_settings`); err != nil {
		t.Fatal(err)
	}
	response, err := app.Test(httptest.NewRequest("GET", "/viewer/init/a", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 500 {
		t.Fatalf("status %d: should not guess after a preference read failure", response.StatusCode)
	}
}

func TestViewerSwipeResetReadFailureRollsBackClear(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	repo := repository.NewUserSeriesSettingRepository()
	ltr := "ltr"
	if err := repo.Upsert(nil, &model.UserSeriesSetting{UserID: "u", SeriesID: "B", SwipeDirection: &ltr}); err != nil {
		t.Fatal(err)
	}
	if _, err := database.DB.Exec(`DROP TABLE user_settings`); err != nil {
		t.Fatal(err)
	}
	response, err := app.Test(httptest.NewRequest("DELETE", "/series/B/viewer-settings/swipe-direction", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 500 {
		t.Fatalf("status = %d", response.StatusCode)
	}
	persisted, err := repo.Get(nil, "u", "B")
	if err != nil || persisted.SwipeDirection == nil || *persisted.SwipeDirection != "ltr" {
		t.Fatalf("failed read committed clear: %+v, %v", persisted, err)
	}
}

func TestViewerSwipeSettingsOnlyReadIsUserScoped(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	if err := repository.NewUserSettingRepository().Update(nil, "u", "swipe_direction", "rtl"); err != nil {
		t.Fatal(err)
	}
	var swipe ViewerSwipeSettings
	if err := json.Unmarshal(swipeTestGet(t, app, "/series/A/viewer-settings/swipe-direction")["effective_direction"], &swipe.EffectiveDirection); err != nil {
		t.Fatal(err)
	}
	if swipe.EffectiveDirection != "rtl" {
		t.Fatal("settings-only read lost user default")
	}
	request := httptest.NewRequest("GET", "/series/A/viewer-settings/swipe-direction", nil)
	request.Header.Set("X-Test-User", "other")
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(&swipe); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 || swipe.EffectiveDirection != "ltr" {
		t.Fatal("another user's default leaked")
	}
}
