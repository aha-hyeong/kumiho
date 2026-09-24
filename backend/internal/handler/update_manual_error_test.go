package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
	"github.com/gofiber/fiber/v2"
)

func TestManualVersionFailureReportsErrorDespiteCachedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	h := NewSystemHandler(nil)
	h.releaseClient, h.releaseBaseURL = server.Client(), server.URL
	h.versionCache = &VersionInfo{CurrentVersion: version.Version, LatestVersion: version.Version}
	h.lastChecked = time.Now()
	h.retryAfter = time.Now().Add(time.Hour)
	app := fiber.New()
	app.Get("/version", h.GetVersion)
	response := pollUpdate(t, app, "/version?force=true")
	if response.StatusCode == 200 {
		t.Fatal("manual network failure was reported as successful version check")
	}
}

func TestManualPluginFailureReportsErrorDespiteCachedStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(503) }))
	defer server.Close()
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := service.NewPluginInstallService(&config.Config{PluginRegistryURL: server.URL}, server.Client(), manager, nil)
	h := NewPluginHandler(manager, svc, nil)
	h.updateCache = &service.PluginUpdateSummary{Plugins: []service.PluginUpdateItem{}}
	h.updateChecked = time.Now()
	h.updateRetryAfter = time.Now().Add(time.Hour)
	app := fiber.New()
	app.Get("/updates", h.Updates)
	response := pollUpdate(t, app, "/updates?force=true")
	if response.StatusCode == 200 {
		t.Fatal("manual network failure was reported as successful plugin check")
	}
}
