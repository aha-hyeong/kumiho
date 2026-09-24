package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
	"github.com/gofiber/fiber/v2"
)

func TestAutomaticPluginUpdateReturnsBeforeRegistry(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	registry := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-release:
			_, _ = w.Write([]byte(`{"plugins":[]}`))
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); registry.Close() })
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := service.NewPluginInstallService(&config.Config{PluginRegistryURL: registry.URL}, registry.Client(), manager, nil)
	handler := NewPluginHandler(manager, svc, nil)
	app := fiber.New()
	app.Get("/plugins/updates", handler.Updates)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/plugins/updates?force=false", nil), 300)
	if err != nil {
		t.Fatalf("automatic request waited on registry: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	var body service.PluginUpdateSummary
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.HasUpdates || body.Count != 0 || body.Plugins == nil {
		t.Fatalf("invalid neutral summary: %+v", body)
	}
	deadline := time.After(time.Second)
	for calls.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("background registry check never started")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func TestAutomaticSystemVersionReturnsBeforeGitHub(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		select {
		case <-release:
			_, _ = w.Write([]byte(`{"tag_name":"v99.0.0"}`))
		case <-r.Context().Done():
		}
	}))
	t.Cleanup(func() { close(release); server.Close() })
	h := NewSystemHandler(nil)
	h.releaseClient = server.Client()
	h.releaseBaseURL = server.URL
	app := fiber.New()
	app.Get("/system/version", h.GetVersion)
	response, err := app.Test(httptest.NewRequest(http.MethodGet, "/system/version?force=false", nil), 300)
	if err != nil {
		t.Fatalf("automatic request waited on GitHub: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", response.StatusCode)
	}
	var body VersionInfo
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.CurrentVersion != version.Version || body.NeedsUpdate || body.LatestVersion == "" {
		t.Fatalf("invalid neutral version: %+v", body)
	}
	deadline := time.After(time.Second)
	for calls.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("background version check never started")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}
