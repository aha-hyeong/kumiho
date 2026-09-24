package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkplugin "github.com/kumiho-plugin/kumiho-plugin-sdk/plugin"
	sdkservice "github.com/kumiho-plugin/kumiho-plugin-sdk/service"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

const (
	EnvPluginHost    = "KUMIHO_PLUGIN_HOST"
	EnvPluginPort    = "KUMIHO_PLUGIN_PORT"
	maxStartAttempts = 3
)

type processState struct {
	cmd     *exec.Cmd
	cancel  context.CancelFunc
	baseURL string
	exited  chan struct{}
	ready   chan error
}

// Runtime is the current local bridge for service plugins.
// Phase 2 still launches the installed service artifact as a child process
// over the SDK HTTP contract. A container-backed runtime can replace this
// implementation later without changing the capability contract.
type Runtime struct {
	client    *http.Client
	stopGrace time.Duration

	mu        sync.RWMutex
	processes map[string]processState
	lastExit  map[string]error
}

func NewRuntime() *Runtime {
	return &Runtime{
		client: &http.Client{
			Timeout: pluginruntime.OperationTimeout,
		},
		stopGrace: 3 * time.Second,
		processes: make(map[string]processState),
		lastExit:  make(map[string]error),
	}
}

func (r *Runtime) Type() sdkmanifest.RuntimeType {
	return sdkmanifest.RuntimeTypeService
}

func newProcessLifecycle() (chan struct{}, chan error, context.Context, context.CancelFunc) {
	exited := make(chan struct{})
	ready := make(chan error, 1)
	procCtx, cancel := context.WithCancel(context.Background())
	return exited, ready, procCtx, cancel
}

func newAttemptLifecycle() (chan struct{}, context.Context, context.CancelFunc) {
	exited := make(chan struct{})
	procCtx, cancel := context.WithCancel(context.Background())
	return exited, procCtx, cancel
}

func buildCommandEnv(host string, port int, overrides map[string]string) []string {
	envMap := make(map[string]string)
	for _, entry := range os.Environ() {
		key, value, ok := strings.Cut(entry, "=")
		if !ok || key == "" {
			continue
		}
		envMap[key] = value
	}

	envMap[EnvPluginHost] = host
	envMap[EnvPluginPort] = strconv.Itoa(port)
	for key, value := range overrides {
		if key == "" {
			continue
		}
		envMap[key] = value
	}

	keys := make([]string, 0, len(envMap))
	for key := range envMap {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	env := make([]string, 0, len(keys))
	for _, key := range keys {
		env = append(env, key+"="+envMap[key])
	}
	return env
}

func (r *Runtime) Start(ctx context.Context, inst pluginruntime.Instance) error {
	if inst.InstallPath == "" {
		return errors.New("install path is required")
	}
	if inst.Manifest.RuntimeType != "" && inst.Manifest.RuntimeType != sdkmanifest.RuntimeTypeService {
		return fmt.Errorf("plugin runtime type %q is not service", inst.Manifest.RuntimeType)
	}

	r.mu.Lock()
	if state, alreadyRunning := r.processes[inst.ID]; alreadyRunning {
		r.mu.Unlock()
		if state.ready != nil {
			return waitForStart(ctx, state.ready)
		}

		select {
		case <-state.exited:
			r.mu.Lock()
			current, exists := r.processes[inst.ID]
			if exists && current.exited == state.exited {
				delete(r.processes, inst.ID)
			}
			exitErr := r.lastExit[inst.ID]
			r.mu.Unlock()
			if exitErr != nil {
				log.Printf("service plugin process %s exited before restart: %v", inst.ID, exitErr)
			}
		default:
			return nil
		}

		r.mu.Lock()
		if state, alreadyRunning = r.processes[inst.ID]; alreadyRunning {
			r.mu.Unlock()
			if state.ready != nil {
				return waitForStart(ctx, state.ready)
			}
			return nil
		}
		delete(r.lastExit, inst.ID)
		_, ready, _, _ := newProcessLifecycle()
		r.processes[inst.ID] = processState{ready: ready}
		r.mu.Unlock()

		return r.startFresh(ctx, inst, ready)
	}
	delete(r.lastExit, inst.ID)
	_, ready, _, _ := newProcessLifecycle()
	r.processes[inst.ID] = processState{ready: ready}
	r.mu.Unlock()

	return r.startFresh(ctx, inst, ready)
}

func (r *Runtime) startFresh(ctx context.Context, inst pluginruntime.Instance, ready chan error) error {
	absPath, err := filepath.Abs(inst.InstallPath)
	if err != nil {
		r.finishStart(inst.ID, fmt.Errorf("resolve install path: %w", err))
		r.remove(inst.ID)
		return fmt.Errorf("resolve install path: %w", err)
	}
	if _, statErr := os.Stat(absPath); statErr != nil {
		r.finishStart(inst.ID, fmt.Errorf("stat install path: %w", statErr))
		r.remove(inst.ID)
		return fmt.Errorf("stat install path: %w", statErr)
	}

	var lastErr error
	for attempt := 1; attempt <= maxStartAttempts; attempt++ {
		if err := ctx.Err(); err != nil {
			r.finishStart(inst.ID, err)
			r.remove(inst.ID)
			return err
		}

		host := "127.0.0.1"
		port, err := allocatePort(host)
		if err != nil {
			lastErr = fmt.Errorf("allocate plugin port: %w", err)
			break
		}
		baseURL := fmt.Sprintf("http://%s:%d", host, port)

		exited, procCtx, cancel := newAttemptLifecycle()
		cmd := exec.CommandContext(procCtx, absPath)
		cmd.Env = buildCommandEnv(host, port, inst.Env)
		cmd.Stdout = log.Writer()
		cmd.Stderr = log.Writer()

		if err := cmd.Start(); err != nil {
			cancel()
			lastErr = fmt.Errorf("start service plugin process: %w", err)
			break
		}

		r.mu.Lock()
		r.processes[inst.ID] = processState{cmd: cmd, cancel: cancel, baseURL: baseURL, exited: exited, ready: ready}
		r.mu.Unlock()

		cmdExited := exited
		go func(cmd *exec.Cmd, exited chan struct{}, id string) {
			err := cmd.Wait()
			r.mu.Lock()
			r.lastExit[id] = err
			r.mu.Unlock()
			close(exited)
			r.mu.Lock()
			if current, exists := r.processes[id]; exists && current.exited == exited {
				delete(r.processes, id)
			}
			r.mu.Unlock()
			if err != nil {
				log.Printf("service plugin process %s exited: %v", id, err)
			}
		}(cmd, cmdExited, inst.ID)

		if err := r.waitUntilReady(ctx, inst.ID, baseURL, inst.Manifest.ID); err == nil {
			r.finishStart(inst.ID, nil)
			return nil
		} else {
			lastErr = err
			_ = r.Stop(context.Background(), inst)
			if attempt < maxStartAttempts {
				r.mu.Lock()
				delete(r.lastExit, inst.ID)
				r.processes[inst.ID] = processState{ready: ready}
				r.mu.Unlock()
				time.Sleep(150 * time.Millisecond)
				continue
			}
		}
	}

	r.finishStart(inst.ID, lastErr)
	r.remove(inst.ID)
	return lastErr
}

func (r *Runtime) Stop(ctx context.Context, inst pluginruntime.Instance) error {
	state, ok := r.get(inst.ID)
	if !ok {
		return nil
	}

	if state.cmd == nil || state.cmd.Process == nil {
		if state.cancel != nil {
			state.cancel()
		}
		if state.ready != nil {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-state.ready:
			}
		}

		refreshed, ok := r.get(inst.ID)
		if !ok {
			return nil
		}
		if refreshed.cmd == nil || refreshed.cmd.Process == nil {
			r.mu.Lock()
			if current, exists := r.processes[inst.ID]; exists && current.exited == refreshed.exited {
				delete(r.processes, inst.ID)
			}
			r.mu.Unlock()
			return nil
		}
		state = refreshed
	}

	_ = state.cmd.Process.Signal(syscall.SIGTERM)

	timeout := r.stopGrace
	if deadline, ok := ctx.Deadline(); ok {
		if until := time.Until(deadline); until > 0 && until < timeout {
			timeout = until
		}
	}

	select {
	case <-ctx.Done():
		state.cancel()
		_ = state.cmd.Process.Kill()
		<-state.exited
		return ctx.Err()
	case <-time.After(timeout):
		state.cancel()
		_ = state.cmd.Process.Kill()
		<-state.exited
		return pluginruntime.ErrStopTimeout
	case <-state.exited:
	}
	return nil
}

func (r *Runtime) Healthcheck(ctx context.Context, inst pluginruntime.Instance) (*healthcheck.Response, error) {
	state, ok := r.get(inst.ID)
	if !ok || state.baseURL == "" {
		return nil, pluginruntime.ErrNotRunning
	}
	ctx, cancel := context.WithTimeout(ctx, healthcheck.DefaultTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, state.baseURL+sdkservice.PathHealth, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set(sdkservice.HeaderAccept, sdkservice.ContentTypeJSON)

	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != sdkservice.StatusOK {
		return nil, fmt.Errorf("healthcheck returned status %d", resp.StatusCode)
	}

	var payload healthcheck.Response
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func (r *Runtime) Search(ctx context.Context, inst pluginruntime.Instance, req *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	payload := &sdktypes.SearchResponse{}
	if err := r.doJSON(ctx, inst.ID, http.MethodPost, sdkservice.PathSearch, req, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (r *Runtime) Fetch(ctx context.Context, inst pluginruntime.Instance, req *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	payload := &sdktypes.FetchResponse{}
	if err := r.doJSON(ctx, inst.ID, http.MethodPost, sdkservice.PathFetch, req, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (r *Runtime) Translate(ctx context.Context, inst pluginruntime.Instance, req *sdktypes.TranslateRequest) (*sdktypes.TranslateResponse, error) {
	payload := &sdktypes.TranslateResponse{}
	if err := r.doJSON(ctx, inst.ID, http.MethodPost, sdkservice.PathTranslate, req, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (r *Runtime) Detect(ctx context.Context, inst pluginruntime.Instance, req *sdktypes.DetectRequest) (*sdktypes.DetectResponse, error) {
	payload := &sdktypes.DetectResponse{}
	if err := r.doJSON(ctx, inst.ID, http.MethodPost, sdkservice.PathDetect, req, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (r *Runtime) waitUntilReady(ctx context.Context, id string, baseURL string, expectedManifestID string) error {
	deadline := time.Now().Add(sdkplugin.StartupTimeout)
	for time.Now().Before(deadline) {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := r.exitedError(id); err != nil {
			return fmt.Errorf("plugin process exited before readiness: %w", err)
		}

		checkCtx, cancel := context.WithTimeout(ctx, healthcheck.DefaultTimeout)
		health, err := r.Healthcheck(checkCtx, pluginruntime.Instance{ID: id})
		cancel()
		if err == nil && health != nil {
			if expectedManifestID != "" {
				if err := r.validateManifest(ctx, id, expectedManifestID); err != nil {
					return err
				}
			}
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}

	return fmt.Errorf("plugin did not become ready within %s: %s", sdkplugin.StartupTimeout, baseURL)
}

func (r *Runtime) validateManifest(parent context.Context, id string, expectedID string) error {
	state, ok := r.get(id)
	if !ok || state.baseURL == "" {
		return pluginruntime.ErrNotRunning
	}

	ctx, cancel := context.WithTimeout(parent, healthcheck.DefaultTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, state.baseURL+sdkservice.PathManifest, nil)
	if err != nil {
		return err
	}
	req.Header.Set(sdkservice.HeaderAccept, sdkservice.ContentTypeJSON)

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != sdkservice.StatusOK {
		return fmt.Errorf("manifest returned status %d", resp.StatusCode)
	}

	var payload sdkmanifest.Manifest
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return err
	}
	if payload.ID != expectedID {
		return fmt.Errorf("manifest id mismatch: got %q want %q", payload.ID, expectedID)
	}
	return nil
}

func (r *Runtime) get(id string) (processState, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	state, ok := r.processes[id]
	return state, ok
}

func (r *Runtime) finishStart(id string, err error) {
	r.mu.Lock()
	state, ok := r.processes[id]
	if !ok || state.ready == nil {
		r.mu.Unlock()
		return
	}

	ready := state.ready
	state.ready = nil
	r.processes[id] = state
	r.mu.Unlock()

	ready <- err
	close(ready)
}

func (r *Runtime) remove(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.processes, id)
}

func (r *Runtime) exitedError(id string) error {
	state, ok := r.get(id)
	if !ok {
		r.mu.RLock()
		err, exists := r.lastExit[id]
		r.mu.RUnlock()
		if exists {
			if err == nil {
				return pluginruntime.ErrNotRunning
			}
			return err
		}
		return pluginruntime.ErrNotRunning
	}

	select {
	case <-state.exited:
		r.mu.RLock()
		err := r.lastExit[id]
		r.mu.RUnlock()
		if err == nil {
			return pluginruntime.ErrNotRunning
		}
		return err
	default:
		return nil
	}
}

func waitForStart(ctx context.Context, ready <-chan error) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err, ok := <-ready:
		if !ok {
			return nil
		}
		return err
	}
}

func allocatePort(host string) (int, error) {
	ln, err := net.Listen("tcp", net.JoinHostPort(host, "0"))
	if err != nil {
		return 0, err
	}
	defer func() { _ = ln.Close() }()

	tcpAddr, ok := ln.Addr().(*net.TCPAddr)
	if !ok {
		return 0, errors.New("unexpected listener address type")
	}
	return tcpAddr.Port, nil
}

func (r *Runtime) doJSON(ctx context.Context, id string, method string, path string, payload any, target any) error {
	state, ok := r.get(id)
	if !ok || state.baseURL == "" {
		return pluginruntime.ErrNotRunning
	}

	var body *bytes.Reader
	if payload == nil {
		body = bytes.NewReader(nil)
	} else {
		raw, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		body = bytes.NewReader(raw)
	}

	req, err := http.NewRequestWithContext(ctx, method, state.baseURL+path, body)
	if err != nil {
		return err
	}
	req.Header.Set(sdkservice.HeaderAccept, sdkservice.ContentTypeJSON)
	if payload != nil {
		req.Header.Set(sdkservice.HeaderContentType, sdkservice.ContentTypeJSON)
	}

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return fmt.Errorf("%s returned status %d", path, resp.StatusCode)
	}
	if target == nil || resp.StatusCode == http.StatusNoContent {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(target)
}
