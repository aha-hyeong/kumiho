package plugin

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

// Manager orchestrates plugin lifecycle and state transitions.
type Manager struct {
	store       Store
	runtimes    map[sdkmanifest.RuntimeType]runtime.Runtime
	envProvider pluginEnvProvider
}

type pluginEnvProvider interface {
	EnvironmentForPlugin(id string, manifest sdkmanifest.Manifest) (map[string]string, error)
	ValidateActivation(id string, manifest sdkmanifest.Manifest) error
}

func NewManager(store Store, runtimes ...runtime.Runtime) *Manager {
	registeredRuntimes := make(map[sdkmanifest.RuntimeType]runtime.Runtime, len(runtimes))
	for _, rt := range runtimes {
		if rt == nil {
			continue
		}
		registeredRuntimes[rt.Type()] = rt
	}

	return &Manager{
		store:    store,
		runtimes: registeredRuntimes,
	}
}

func (m *Manager) SetEnvProvider(provider pluginEnvProvider) {
	m.envProvider = provider
}

func (m *Manager) RegisterInstalled(pluginManifest sdkmanifest.Manifest, installPath string) (Record, error) {
	now := time.Now()
	record := Record{
		ID:          pluginManifest.ID,
		Manifest:    pluginManifest,
		State:       sdkstate.Installed,
		InstallPath: installPath,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	if existing, ok, err := m.store.Get(pluginManifest.ID); err != nil {
		return Record{}, err
	} else if ok {
		record.CreatedAt = existing.CreatedAt
	}

	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (m *Manager) MarkRegistered(id string) (Record, error) {
	return m.transition(id, sdkstate.Registered, "")
}

func (m *Manager) Disable(id string) (Record, error) {
	return m.transition(id, sdkstate.Disabled, "")
}

func (m *Manager) MarkError(id string, reason string) (Record, error) {
	return m.transition(id, sdkstate.Error, reason)
}

func (m *Manager) Activate(ctx context.Context, id string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}

	instance := toInstance(record)
	if m.envProvider != nil {
		if err := m.envProvider.ValidateActivation(record.ID, record.Manifest); err != nil {
			errorRecord, markErr := m.MarkError(id, err.Error())
			if markErr != nil {
				return Record{}, fmt.Errorf("validate activation: %w (also failed to mark error state: %v)", err, markErr)
			}
			return errorRecord, fmt.Errorf("validate activation: %w", err)
		}
		env, err := m.envProvider.EnvironmentForPlugin(record.ID, record.Manifest)
		if err != nil {
			errorRecord, markErr := m.MarkError(id, err.Error())
			if markErr != nil {
				return Record{}, fmt.Errorf("build plugin environment: %w (also failed to mark error state: %v)", err, markErr)
			}
			return errorRecord, fmt.Errorf("build plugin environment: %w", err)
		}
		instance.Env = env
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		runtimeErr := fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
		errorRecord, markErr := m.MarkError(id, runtimeErr.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("%w (also failed to mark error state: %v)", runtimeErr, markErr)
		}
		return errorRecord, runtimeErr
	}
	if record.State == sdkstate.ActivationPending || record.State == sdkstate.Active {
		if _, err := rt.Healthcheck(ctx, instance); err == nil {
			if record.State == sdkstate.ActivationPending {
				record.State = sdkstate.Active
				record.LastError = ""
				record.UpdatedAt = time.Now()
				if err := m.store.Save(record); err != nil {
					return Record{}, err
				}
			}
			return record, nil
		}
	}

	record.State = sdkstate.ActivationPending
	record.LastError = ""
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}

	if err := rt.Start(ctx, instance); err != nil {
		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("plugin start failed: %w (also failed to mark error state: %v)", err, markErr)
		}
		return errorRecord, fmt.Errorf("plugin start failed: %w", err)
	}

	record.State = sdkstate.Active
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		stopErr := rt.Stop(ctx, instance)
		if stopErr != nil {
			errorRecord, markErr := m.MarkError(id, err.Error())
			if markErr != nil {
				return Record{}, fmt.Errorf("save active state: %w (additionally failed to stop runtime: %v and mark error: %v)", err, stopErr, markErr)
			}
			return errorRecord, fmt.Errorf("save active state: %w (additionally failed to stop runtime: %v)", err, stopErr)
		}

		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("save active state: %w (runtime rolled back, but failed to mark error: %v)", err, markErr)
		}
		return errorRecord, fmt.Errorf("save active state: %w (runtime rolled back)", err)
	}
	return record, nil
}

func (m *Manager) Deactivate(ctx context.Context, id string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return m.Disable(id)
	}

	if err := rt.Stop(ctx, toInstance(record)); err != nil {
		errorRecord, markErr := m.MarkError(id, err.Error())
		if markErr != nil {
			return Record{}, fmt.Errorf("failed to stop plugin: %w (also failed to mark error: %v)", err, markErr)
		}
		return errorRecord, err
	}
	return m.Disable(id)
}

func (m *Manager) Healthcheck(ctx context.Context, id string) (*healthcheck.Response, error) {
	record, err := m.require(id)
	if err != nil {
		return nil, err
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return nil, fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
	}

	return rt.Healthcheck(ctx, toInstance(record))
}

func (m *Manager) Search(ctx context.Context, id string, req *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Search(ctx, toInstance(record), req)
}

func (m *Manager) Fetch(ctx context.Context, id string, req *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Fetch(ctx, toInstance(record), req)
}

func (m *Manager) Translate(ctx context.Context, id string, req *sdktypes.TranslateRequest) (*sdktypes.TranslateResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Translate(ctx, toInstance(record), req)
}

func (m *Manager) Detect(ctx context.Context, id string, req *sdktypes.DetectRequest) (*sdktypes.DetectResponse, error) {
	record, rt, err := m.requireActiveRuntime(id)
	if err != nil {
		return nil, err
	}
	return rt.Detect(ctx, toInstance(record), req)
}

func (m *Manager) Get(id string) (Record, bool, error) {
	return m.store.Get(id)
}

func (m *Manager) List() ([]Record, error) {
	return m.store.List()
}

func (m *Manager) Remove(id string) error {
	return m.store.Delete(id)
}

// Bootstrap reconciles persisted plugin states on process startup.
// Plugins that were active before shutdown are started again so a core restart
// does not silently disable usable plugins. Newly installed plugins still
// require an explicit activation step.
func (m *Manager) Bootstrap(ctx context.Context) error {
	records, err := m.store.List()
	if err != nil {
		return err
	}
	for _, record := range records {
		if shouldCheckInstallPath(record) {
			exists, statErr := installPathExists(record.InstallPath)
			if statErr != nil {
				if _, err := m.MarkError(record.ID, fmt.Sprintf("failed to stat install path: %v", statErr)); err != nil {
					return err
				}
				continue
			}
			if !exists {
				if _, err := m.MarkError(record.ID, "installed artifact is missing"); err != nil {
					return err
				}
				continue
			}
		}
		switch record.State {
		case sdkstate.Installed, sdkstate.Unhealthy:
			if _, err := m.transition(record.ID, sdkstate.Registered, ""); err != nil {
				return err
			}
		case sdkstate.ActivationPending, sdkstate.Active:
			if _, err := m.Activate(ctx, record.ID); err != nil {
				log.Printf("plugin %s failed to activate during bootstrap: %v", record.ID, err)
				continue
			}
		}
	}
	return nil
}

func (m *Manager) transition(id string, next sdkstate.State, lastError string) (Record, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, err
	}
	record.State = next
	record.LastError = lastError
	record.UpdatedAt = time.Now()
	if err := m.store.Save(record); err != nil {
		return Record{}, err
	}
	return record, nil
}

func (m *Manager) require(id string) (Record, error) {
	record, ok, err := m.store.Get(id)
	if err != nil {
		return Record{}, err
	}
	if !ok {
		return Record{}, ErrPluginNotFound
	}
	return record, nil
}

func (m *Manager) requireActiveRuntime(id string) (Record, runtime.Runtime, error) {
	record, err := m.require(id)
	if err != nil {
		return Record{}, nil, err
	}
	if record.State != sdkstate.Active {
		return Record{}, nil, fmt.Errorf("plugin %q is not active", id)
	}

	rt, ok := m.runtimes[record.Manifest.RuntimeType]
	if !ok {
		return Record{}, nil, fmt.Errorf("runtime %q is not registered", record.Manifest.RuntimeType)
	}
	return record, rt, nil
}

func toInstance(record Record) runtime.Instance {
	return runtime.Instance{
		ID:          record.ID,
		Manifest:    record.Manifest,
		InstallPath: record.InstallPath,
	}
}

func shouldCheckInstallPath(record Record) bool {
	return sdkstate.IsInstalled(record.State)
}

func installPathExists(installPath string) (bool, error) {
	installPath = strings.TrimSpace(installPath)
	if installPath == "" {
		return false, nil
	}
	_, err := os.Stat(installPath)
	if err == nil {
		return true, nil
	}
	if os.IsNotExist(err) {
		return false, nil
	}
	return false, err
}
