package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
	"github.com/gofiber/fiber/v2"
)

func pollUpdate(t *testing.T, app *fiber.App, path string) *http.Response {
	t.Helper()
	response, err := app.Test(httptest.NewRequest(http.MethodGet, path, nil), 1000)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = response.Body.Close() })
	return response
}

func awaitUpdate(t *testing.T, predicate func() bool) {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for !predicate() {
		select {
		case <-deadline:
			t.Fatal("timed out waiting for refresh")
		default:
			time.Sleep(time.Millisecond)
		}
	}
}

func writeVersionReleaseFixture(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path == "/releases/latest" {
		_, _ = w.Write([]byte(`{"tag_name":"v99.0.0"}`))
		return
	}
	_, _ = w.Write([]byte(`[{"tag_name":"v99.0.0"}]`))
}

func TestSystemAutomaticRefreshSingleFlightSuccessAndManual(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		<-release
		writeVersionReleaseFixture(w, r)
	}))
	defer server.Close()
	h := NewSystemHandler(nil)
	h.releaseClient, h.releaseBaseURL = server.Client(), server.URL
	app := fiber.New()
	app.Get("/version", h.GetVersion)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); resp := pollUpdate(t, app, "/version?force=false"); _ = resp.Body.Close() }()
	}
	wg.Wait()
	awaitUpdate(t, func() bool { return calls.Load() == 1 })
	close(release)
	awaitUpdate(t, func() bool {
		h.cacheMutex.RLock()
		defer h.cacheMutex.RUnlock()
		return h.versionCache != nil && !h.refreshing
	})
	response := pollUpdate(t, app, "/version?force=false")
	var info VersionInfo
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.LatestVersion != "v99.0.0" || !info.NeedsUpdate || calls.Load() != 1 {
		t.Fatalf("cached info=%+v, calls=%d", info, calls.Load())
	}
	response = pollUpdate(t, app, "/version?force=true")
	if response.StatusCode != 200 || calls.Load() != 2 {
		t.Fatalf("manual status=%d calls=%d", response.StatusCode, calls.Load())
	}
	for range 9 {
		pollUpdate(t, app, "/version?force=true")
	}
	response = pollUpdate(t, app, "/version?force=true")
	if response.StatusCode != http.StatusTooManyRequests || calls.Load() != 11 {
		t.Fatalf("limit status=%d calls=%d", response.StatusCode, calls.Load())
	}
	_ = version.Version
}

func TestSystemAutomaticFailureCooldownManualBypass(t *testing.T) {
	var calls atomic.Int32
	var healthy atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if !healthy.Load() {
			w.WriteHeader(503)
			return
		}
		writeVersionReleaseFixture(w, r)
	}))
	defer server.Close()
	h := NewSystemHandler(nil)
	h.releaseClient, h.releaseBaseURL = server.Client(), server.URL
	app := fiber.New()
	app.Get("/version", h.GetVersion)
	response := pollUpdate(t, app, "/version?force=false")
	if response.StatusCode != 200 {
		t.Fatal(response.StatusCode)
	}
	awaitUpdate(t, func() bool {
		h.cacheMutex.RLock()
		defer h.cacheMutex.RUnlock()
		return !h.retryAfter.IsZero() && !h.refreshing
	})
	for range 5 {
		pollUpdate(t, app, "/version?force=false")
	}
	if calls.Load() != 1 {
		t.Fatalf("retry during cooldown: %d", calls.Load())
	}
	healthy.Store(true)
	response = pollUpdate(t, app, "/version?force=true")
	if response.StatusCode != 200 || calls.Load() != 2 {
		t.Fatalf("manual status=%d calls=%d", response.StatusCode, calls.Load())
	}
	pollUpdate(t, app, "/version?force=false")
	if calls.Load() != 2 {
		t.Fatalf("cache not used after manual success: %d", calls.Load())
	}
}

func TestPluginAutomaticRefreshSingleFlightAndFailureCooldown(t *testing.T) {
	release := make(chan struct{})
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		<-release
		w.WriteHeader(503)
	}))
	defer server.Close()
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := service.NewPluginInstallService(&config.Config{PluginRegistryURL: server.URL}, server.Client(), manager, nil)
	h := NewPluginHandler(manager, svc, nil)
	app := fiber.New()
	app.Get("/updates", h.Updates)
	var wg sync.WaitGroup
	for range 12 {
		wg.Add(1)
		go func() { defer wg.Done(); resp := pollUpdate(t, app, "/updates?force=false"); _ = resp.Body.Close() }()
	}
	wg.Wait()
	awaitUpdate(t, func() bool { return calls.Load() == 1 })
	close(release)
	awaitUpdate(t, func() bool {
		h.updateMutex.RLock()
		defer h.updateMutex.RUnlock()
		return !h.updateRetryAfter.IsZero() && !h.updateRefreshing
	})
	for range 5 {
		pollUpdate(t, app, "/updates?force=false")
	}
	if calls.Load() != 1 {
		t.Fatalf("retry during cooldown: %d", calls.Load())
	}
	response := pollUpdate(t, app, "/updates?force=true")
	if calls.Load() != 2 || response.StatusCode == 200 {
		t.Fatalf("force did not fetch or show error: status=%d calls=%d", response.StatusCode, calls.Load())
	}
}

func TestPluginAutomaticRefreshSuccessAndManualRateLimit(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write([]byte(`{"plugins":[]}`))
	}))
	defer server.Close()
	manager := pluginengine.NewManager(pluginengine.NewMemoryStore())
	svc := service.NewPluginInstallService(&config.Config{PluginRegistryURL: server.URL}, server.Client(), manager, nil)
	h := NewPluginHandler(manager, svc, nil)
	app := fiber.New()
	app.Get("/updates", h.Updates)
	pollUpdate(t, app, "/updates?force=false")
	awaitUpdate(t, func() bool {
		h.updateMutex.RLock()
		defer h.updateMutex.RUnlock()
		return h.updateCache != nil && !h.updateRefreshing
	})
	response := pollUpdate(t, app, "/updates?force=false")
	var info service.PluginUpdateSummary
	if err := json.NewDecoder(response.Body).Decode(&info); err != nil {
		t.Fatal(err)
	}
	if info.Plugins == nil || calls.Load() != 1 {
		t.Fatalf("summary=%+v calls=%d", info, calls.Load())
	}
	for range 10 {
		pollUpdate(t, app, "/updates?force=true")
	}
	response = pollUpdate(t, app, "/updates?force=true")
	if response.StatusCode != http.StatusTooManyRequests || calls.Load() != 11 {
		t.Fatalf("limit status=%d calls=%d", response.StatusCode, calls.Load())
	}
}
