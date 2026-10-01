package handler

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestViewerSwipePriority(t *testing.T) {
	for _, tc := range []struct{ name, series, user, server, want string }{
		{"series wins", "rtl", "ltr", "ltr", "rtl"},
		{"user fallback", "", "rtl", "ltr", "rtl"},
		{"hardcoded fallback", "", "", "", "ltr"},
		{"ignore server fallback", "", "", "rtl", "ltr"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, _ := newViewerSwipeTestApp(t)
			if tc.user != "" {
				if err := repository.NewUserSettingRepository().Update(nil, "u", "swipe_direction", tc.user); err != nil {
					t.Fatal(err)
				}
			}
			if tc.server != "" {
				if err := repository.NewSettingRepository().Update(nil, "swipe_direction", tc.server); err != nil {
					t.Fatal(err)
				}
			}
			if tc.series != "" {
				if err := repository.NewUserSeriesSettingRepository().Upsert(nil, &model.UserSeriesSetting{UserID: "u", SeriesID: "A", SwipeDirection: &tc.series}); err != nil {
					t.Fatal(err)
				}
			}
			var swipe ViewerSwipeSettings
			if err := json.Unmarshal(swipeTestGet(t, app, "/viewer/init/a")["swipe_settings"], &swipe); err != nil {
				t.Fatal(err)
			}
			if swipe.EffectiveDirection != tc.want {
				t.Fatalf("effective %q, want %q", swipe.EffectiveDirection, tc.want)
			}
		})
	}
}

func TestViewerSwipeSeriesIsolationAndAllChapters(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	userRepo := repository.NewUserSettingRepository()
	if err := userRepo.Update(nil, "u", "swipe_direction", "rtl"); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewUserSeriesSettingRepository()
	for _, series := range []string{"A", "B", "C"} {
		reading := "rtl"
		setting := &model.UserSeriesSetting{UserID: "u", SeriesID: series, ReadingDirection: &reading}
		if series == "B" {
			direction := "ltr"
			setting.SwipeDirection = &direction
		}
		if err := repo.Upsert(nil, setting); err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct{ chapter, want string }{{"a", "rtl"}, {"b1", "ltr"}, {"b2", "ltr"}, {"b3", "ltr"}, {"c", "rtl"}, {"a", "rtl"}} {
		var swipe ViewerSwipeSettings
		if err := json.Unmarshal(swipeTestGet(t, app, "/viewer/init/"+tc.chapter)["swipe_settings"], &swipe); err != nil {
			t.Fatal(err)
		}
		if swipe.EffectiveDirection != tc.want {
			t.Fatalf("chapter %s: %q, want %q", tc.chapter, swipe.EffectiveDirection, tc.want)
		}
	}
	request := httptest.NewRequest("PATCH", "/series/B/viewer-settings", strings.NewReader(`{"swipe_direction":"rtl"}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("PATCH: %d", response.StatusCode)
	}
	for _, chapterID := range []string{"b1", "b2", "b3"} {
		var swipe ViewerSwipeSettings
		if err := json.Unmarshal(swipeTestGet(t, app, "/viewer/init/"+chapterID)["swipe_settings"], &swipe); err != nil {
			t.Fatal(err)
		}
		if swipe.SeriesOverride == nil || *swipe.SeriesOverride != "rtl" || swipe.EffectiveDirection != "rtl" {
			t.Fatalf("saved override missing for chapter %s: %+v", chapterID, swipe)
		}
	}
	for _, series := range []string{"A", "C"} {
		setting, err := repo.Get(nil, "u", series)
		if err != nil {
			t.Fatal(err)
		}
		if setting.SwipeDirection != nil || setting.ReadingDirection == nil || *setting.ReadingDirection != "rtl" {
			t.Fatalf("unrelated series changed: %+v", setting)
		}
	}
	other, err := repo.Get(nil, "other", "B")
	if err != nil {
		t.Fatal(err)
	}
	if other != nil {
		t.Fatal("another user's settings were created")
	}
}

func TestViewerSwipeResetClearsOnlyTheOverride(t *testing.T) {
	app, _ := newViewerSwipeTestApp(t)
	if err := repository.NewUserSettingRepository().Update(nil, "u", "swipe_direction", "rtl"); err != nil {
		t.Fatal(err)
	}
	repo := repository.NewUserSeriesSettingRepository()
	ltr, rtl, mode := "ltr", "rtl", "double"
	for _, user := range []string{"u", "other"} {
		if err := repo.Upsert(nil, &model.UserSeriesSetting{UserID: user, SeriesID: "B", SwipeDirection: &ltr, ReadingDirection: &rtl, ReadingMode: &mode}); err != nil {
			t.Fatal(err)
		}
	}
	// An omitted or null PATCH field must retain the old semantics for ordinary partial updates.
	request := httptest.NewRequest("PATCH", "/series/B/viewer-settings", strings.NewReader(`{"swipe_direction":null,"fit_mode":"width"}`))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("PATCH: %d", response.StatusCode)
	}
	before, _ := repo.Get(nil, "u", "B")
	if before.SwipeDirection == nil || *before.SwipeDirection != "ltr" {
		t.Fatal("null PATCH unexpectedly cleared the override")
	}
	response, err = app.Test(httptest.NewRequest("DELETE", "/series/B/viewer-settings/swipe-direction", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		t.Fatalf("reset status = %d, want 200", response.StatusCode)
	}
	var swipe ViewerSwipeSettings
	if err := json.NewDecoder(response.Body).Decode(&swipe); err != nil {
		t.Fatal(err)
	}
	if swipe.SeriesOverride != nil || swipe.EffectiveDirection != "rtl" {
		t.Fatalf("reset result: %+v", swipe)
	}
	after, err := repo.Get(nil, "u", "B")
	if err != nil {
		t.Fatal(err)
	}
	if after.SwipeDirection != nil || *after.ReadingDirection != "rtl" || *after.ReadingMode != "double" || *after.FitMode != "width" {
		t.Fatalf("reset altered other fields: %+v", after)
	}
	other, _ := repo.Get(nil, "other", "B")
	if other.SwipeDirection == nil || *other.SwipeDirection != "ltr" {
		t.Fatal("reset changed another user")
	}
	var nullCount int
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM user_series_settings WHERE user_id='u' AND series_id='B' AND swipe_direction IS NULL`).Scan(&nullCount); err != nil || nullCount != 1 {
		t.Fatalf("actual SQL NULL count = %d, err %v", nullCount, err)
	}
	var effective ViewerSwipeSettings
	if err := json.Unmarshal(swipeTestGet(t, app, "/viewer/init/b3")["swipe_settings"], &effective); err != nil {
		t.Fatal(err)
	}
	if effective.EffectiveDirection != "rtl" {
		t.Fatal("reset not effective in another volume")
	}
}
