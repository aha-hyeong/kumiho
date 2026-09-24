package binary

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkservice "github.com/kumiho-plugin/kumiho-plugin-sdk/service"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

type timeoutTransport func(*http.Request) (*http.Response, error)

func (fn timeoutTransport) RoundTrip(req *http.Request) (*http.Response, error) { return fn(req) }

func TestHTTPTimeoutPoliciesAndCapabilities(t *testing.T) {
	rt := NewRuntime()
	if rt.client.Timeout != pluginruntime.OperationTimeout || rt.client.Timeout <= 10*time.Second || rt.client.Timeout <= healthcheck.DefaultTimeout {
		t.Fatalf("operation timeout = %v, want bounded policy above 10s and distinct from healthcheck", rt.client.Timeout)
	}
	inst := pluginruntime.Instance{ID: "test"}
	rt.processes[inst.ID] = processState{baseURL: "http://plugin.test"}
	paths := make([]string, 0, 5)
	rt.client.Transport = timeoutTransport(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		if !ok {
			t.Errorf("%s has no deadline", req.URL.Path)
		} else {
			remaining := time.Until(deadline)
			if req.URL.Path == sdkservice.PathHealth {
				if remaining > healthcheck.DefaultTimeout || remaining < healthcheck.DefaultTimeout-time.Second {
					t.Errorf("health deadline remaining %v", remaining)
				}
			} else if remaining > pluginruntime.OperationTimeout || remaining < pluginruntime.OperationTimeout-time.Second {
				t.Errorf("operation %s deadline remaining %v", req.URL.Path, remaining)
			}
		}
		paths = append(paths, req.URL.Path)
		return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("{}")), Header: make(http.Header)}, nil
	})
	if _, err := rt.Healthcheck(context.Background(), inst); err != nil {
		t.Fatal(err)
	}
	calls := []struct {
		path string
		run  func() error
	}{
		{sdkservice.PathSearch, func() error { _, err := rt.Search(context.Background(), inst, &sdktypes.SearchRequest{}); return err }},
		{sdkservice.PathFetch, func() error { _, err := rt.Fetch(context.Background(), inst, &sdktypes.FetchRequest{}); return err }},
		{sdkservice.PathTranslate, func() error {
			_, err := rt.Translate(context.Background(), inst, &sdktypes.TranslateRequest{})
			return err
		}},
		{sdkservice.PathDetect, func() error { _, err := rt.Detect(context.Background(), inst, &sdktypes.DetectRequest{}); return err }},
	}
	for _, call := range calls {
		if err := call.run(); err != nil {
			t.Errorf("%s: %v", call.path, err)
		}
	}
	if len(paths) != len(calls)+1 {
		t.Fatalf("called %v paths, want health and 4 capabilities", paths)
	}
	for i, call := range calls {
		if paths[i+1] != call.path {
			t.Errorf("operation path %d = %q, want %q", i, paths[i+1], call.path)
		}
	}
}

func TestOperationRespectsCallerCancellationAndTimeout(t *testing.T) {
	started := make(chan struct{}, 1)
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		select {
		case started <- struct{}{}:
		default:
		}
		select {
		case <-req.Context().Done():
		case <-release:
		}
	}))
	defer server.Close()
	defer close(release)
	rt := NewRuntime()
	inst := pluginruntime.Instance{ID: "test"}
	rt.processes[inst.ID] = processState{baseURL: server.URL}
	ctx, cancel := context.WithCancel(context.Background())
	result := make(chan error, 1)
	go func() { _, err := rt.Search(ctx, inst, &sdktypes.SearchRequest{}); result <- err }()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("operation did not start")
	}
	cancel()
	select {
	case err := <-result:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled operation error = %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("operation ignored caller cancellation")
	}
	rt.client.Timeout = 30 * time.Millisecond
	_, err := rt.Search(context.Background(), inst, &sdktypes.SearchRequest{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("operation timeout error = %v", err)
	}
	shortCtx, stop := context.WithTimeout(context.Background(), 15*time.Millisecond)
	defer stop()
	rt.client.Timeout = time.Second
	_, err = rt.Search(shortCtx, inst, &sdktypes.SearchRequest{})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("short caller deadline error = %v", err)
	}
}
