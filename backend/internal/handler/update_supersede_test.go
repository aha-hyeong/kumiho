package handler

import (
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

func TestSystemManualRefreshSupersedesInflightAutomatic(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			<-release
		}
		_, _ = w.Write([]byte(`[{"tag_name":"v99.0.0"}]`))
	}))
	t.Cleanup(func() { once.Do(func() { close(release) }); server.Close() })
	h := NewSystemHandler(nil)
	h.releaseClient, h.releaseBaseURL = server.Client(), server.URL
	app := fiber.New()
	app.Get("/version", h.GetVersion)
	pollUpdate(t, app, "/version?force=false")
	awaitUpdate(t, func() bool { return calls.Load() == 1 })
	response := pollUpdate(t, app, "/version?force=true")
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	once.Do(func() { close(release) })
	awaitUpdate(t, func() bool { h.cacheMutex.RLock(); defer h.cacheMutex.RUnlock(); return !h.refreshing })
	h.cacheMutex.Lock()
	h.lastChecked = time.Now().Add(-25 * time.Hour)
	h.cacheMutex.Unlock()
	pollUpdate(t, app, "/version?force=false")
	awaitUpdate(t, func() bool { return calls.Load() == 3 })
}

func TestPluginManualRefreshSupersedesInflightAutomatic(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) == 1 {
			<-release
		}
		_, _ = w.Write([]byte(`{"plugins":[]}`))
	}))
	t.Cleanup(func() { once.Do(func() { close(release) }); server.Close() })
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := service.NewPluginInstallService(&config.Config{PluginRegistryURL: server.URL}, server.Client(), manager, nil)
	h := NewPluginHandler(manager, svc, nil)
	app := fiber.New()
	app.Get("/updates", h.Updates)
	pollUpdate(t, app, "/updates?force=false")
	awaitUpdate(t, func() bool { return calls.Load() == 1 })
	response := pollUpdate(t, app, "/updates?force=true")
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	once.Do(func() { close(release) })
	awaitUpdate(t, func() bool { h.updateMutex.RLock(); defer h.updateMutex.RUnlock(); return !h.updateRefreshing })
	h.updateMutex.Lock()
	h.updateChecked = time.Now().Add(-13 * time.Hour)
	h.updateMutex.Unlock()
	pollUpdate(t, app, "/updates?force=false")
	awaitUpdate(t, func() bool { return calls.Load() == 3 })
}
