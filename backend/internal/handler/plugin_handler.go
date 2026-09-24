package handler

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	pluginruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	sdkconfig "github.com/kumiho-plugin/kumiho-plugin-sdk/config"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
)

type PluginHandler struct {
	manager          *pluginengine.Manager
	installService   *service.PluginInstallService
	secretService    *service.PluginSecretService
	updateCache      *service.PluginUpdateSummary
	updateChecked    time.Time
	updateMutex      sync.RWMutex
	updateRefreshing bool
	updateRetryAfter time.Time
	updateGeneration uint64
	manualChecks     map[string]int
	manualMutex      sync.Mutex
	authService      *service.PluginAuthService
}

type RegisterPluginRequest struct {
	Manifest    sdkmanifest.Manifest `json:"manifest"`
	InstallPath string               `json:"install_path"`
}

type pluginRecordResponse struct {
	ID          string               `json:"id"`
	Manifest    sdkmanifest.Manifest `json:"manifest"`
	State       string               `json:"state"`
	InstallPath string               `json:"install_path,omitempty"`
	LastError   string               `json:"last_error,omitempty"`
	CreatedAt   string               `json:"created_at"`
	UpdatedAt   string               `json:"updated_at"`
}

type updatePluginConfigRequest struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

type pluginAuthActionRequest struct {
	Values map[string]string `json:"values"`
}

type pluginConfigMutation func() (*service.PluginConfigStatus, error)

type pluginMutationError struct {
	err                  error
	pluginState          sdkstate.State
	reactivationRequired bool
	restoreFailed        bool
}

func (e *pluginMutationError) Error() string {
	return e.err.Error()
}

func (e *pluginMutationError) Unwrap() error {
	return e.err
}

func NewPluginHandler(manager *pluginengine.Manager, installService *service.PluginInstallService, secretService *service.PluginSecretService) *PluginHandler {
	return &PluginHandler{
		manager:        manager,
		installService: installService,
		secretService:  secretService,
		manualChecks:   make(map[string]int),
		authService:    service.NewPluginAuthService(nil),
	}
}

const pluginUpdateCacheTTL = 12 * time.Hour
const updateFailureCooldown = 10 * time.Minute

func (h *PluginHandler) invalidateUpdateCache() {
	h.updateMutex.Lock()
	defer h.updateMutex.Unlock()
	h.updateCache = nil
	h.updateChecked = time.Time{}
	h.updateRetryAfter = time.Time{}
	h.updateGeneration++
}

// List plugins
// GET /api/v1/plugins
func (h *PluginHandler) List(c *fiber.Ctx) error {
	records, err := h.manager.List()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	includePath := middleware.GetUserRole(c) == model.RoleMaster
	items := make([]pluginRecordResponse, 0, len(records))
	for _, record := range records {
		items = append(items, toPluginRecordResponse(record, includePath))
	}

	return c.JSON(fiber.Map{
		"plugins": items,
	})
}

// Get plugin details
// GET /api/v1/plugins/:id
func (h *PluginHandler) Get(c *fiber.Ctx) error {
	record, ok, err := h.manager.Get(c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	if !ok {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "plugin not found"})
	}

	return c.JSON(toPluginRecordResponse(record, middleware.GetUserRole(c) == model.RoleMaster))
}

// RegisterInstalled registers a plugin that is already present on disk.
// POST /api/v1/plugins/register-installed
func (h *PluginHandler) RegisterInstalled(c *fiber.Ctx) error {
	var req RegisterPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if req.Manifest.ID == "" || req.Manifest.Name == "" || req.Manifest.RuntimeType == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "manifest.id, manifest.name, and manifest.runtime_type are required"})
	}
	if req.Manifest.RuntimeType == sdkmanifest.RuntimeTypeBinary {
		if strings.TrimSpace(req.InstallPath) == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "install_path is required for binary runtime"})
		}
		if !filepath.IsAbs(req.InstallPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "install_path must be an absolute path for binary runtime"})
		}
	}

	record, err := h.manager.RegisterInstalled(req.Manifest, req.InstallPath)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	record, err = h.manager.MarkRegistered(record.ID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	h.invalidateUpdateCache()

	return c.Status(fiber.StatusCreated).JSON(toPluginRecordResponse(record, true))
}

// Activate starts the plugin runtime.
// POST /api/v1/plugins/:id/activate
func (h *PluginHandler) Activate(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	if h.installService != nil {
		if _, err := h.installService.SyncLocalDevelopmentInstallPath(ctx, c.Params("id")); err != nil &&
			!errors.Is(err, service.ErrPluginCatalogEntryNotFound) &&
			!errors.Is(err, service.ErrPluginRegistryNotConfigured) {
			return writePluginError(c, err)
		}
	}

	record, err := h.manager.Activate(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(toPluginRecordResponse(record, true))
}

// Deactivate stops the plugin runtime.
// POST /api/v1/plugins/:id/deactivate
func (h *PluginHandler) Deactivate(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	record, err := h.manager.Deactivate(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(toPluginRecordResponse(record, true))
}

// Healthcheck checks current plugin health.
// GET /api/v1/plugins/:id/health
func (h *PluginHandler) Healthcheck(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	resp, err := h.manager.Healthcheck(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(resp)
}

// Catalog lists installable plugins from the registry.
// GET /api/v1/plugins/catalog
func (h *PluginHandler) Catalog(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	catalog, err := h.installService.ListResolvedCatalog(ctx)
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(catalog)
}

// Updates returns installed plugin update availability from the registry.
// GET /api/v1/plugins/updates
func (h *PluginHandler) Updates(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}

	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	force := c.Query("force") == "true"
	if force {
		today := time.Now().Format("2006-01-02")
		h.manualMutex.Lock()
		if h.manualChecks[today] >= 10 {
			h.manualMutex.Unlock()
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "오늘의 수동 업데이트 확인 횟수(10회)를 초과했습니다.",
			})
		}
		h.manualChecks[today]++
		h.manualMutex.Unlock()
	}

	if !force {
		h.updateMutex.Lock()
		cached := service.PluginUpdateSummary{Plugins: []service.PluginUpdateItem{}}
		if h.updateCache != nil {
			cached = *h.updateCache
		}
		if (h.updateCache == nil || time.Since(h.updateChecked) >= pluginUpdateCacheTTL) &&
			!h.updateRefreshing && !time.Now().Before(h.updateRetryAfter) {
			h.updateRefreshing = true
			generation := h.updateGeneration
			go h.refreshAutomaticPluginUpdates(generation)
		}
		h.updateMutex.Unlock()
		return c.JSON(cached)
	}

	summary, err := h.installService.CheckUpdates(ctx)
	if err != nil {
		return writePluginError(c, err)
	}

	h.updateMutex.Lock()
	h.updateCache = summary
	h.updateChecked = time.Now()
	h.updateRetryAfter = time.Time{}
	h.updateGeneration++
	h.updateMutex.Unlock()

	return c.JSON(summary)
}

func (h *PluginHandler) refreshAutomaticPluginUpdates(generation uint64) {
	// The request context ends when the neutral response is sent. The HTTP client
	// enforces its own timeout for this detached, single-flight refresh.
	summary, err := h.installService.CheckUpdates(context.Background())
	h.updateMutex.Lock()
	defer h.updateMutex.Unlock()
	if generation != h.updateGeneration {
		h.updateRefreshing = false
		return // A manual refresh or plugin mutation superseded this result.
	}
	h.updateRefreshing = false
	if err != nil {
		h.updateRetryAfter = time.Now().Add(updateFailureCooldown)
		return
	}
	h.updateCache = summary
	h.updateChecked = time.Now()
	h.updateRetryAfter = time.Time{}
}

// Install downloads, verifies, and registers a plugin from the registry.
// POST /api/v1/plugins/install
func (h *PluginHandler) Install(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	var req service.InstallPluginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(req.PluginID) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "plugin_id is required"})
	}

	result, err := h.installService.Install(ctx, req.PluginID)
	if err != nil {
		return writePluginError(c, err)
	}
	h.invalidateUpdateCache()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"record":           toPluginRecordResponse(result.Record, true),
		"artifact_url":     result.ArtifactURL,
		"install_path":     result.InstallPath,
		"restart_required": result.RestartRequired,
	})
}

// Uninstall removes a plugin installation and its persisted record.
// DELETE /api/v1/plugins/:id
func (h *PluginHandler) Uninstall(c *fiber.Ctx) error {
	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	if h.installService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin install service is not configured"})
	}

	result, err := h.installService.Uninstall(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}
	h.invalidateUpdateCache()

	return c.JSON(result)
}

// GetConfig returns safe plugin configuration status without exposing secrets.
// GET /api/v1/plugins/:id/config
func (h *PluginHandler) GetConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	manifest, err := h.resolveManifest(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	status, err := h.secretService.Status(c.Params("id"), manifest)
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(status)
}

func (h *PluginHandler) resolveManifest(ctx context.Context, pluginID string) (sdkmanifest.Manifest, error) {
	record, ok, err := h.manager.Get(pluginID)
	if err != nil {
		return sdkmanifest.Manifest{}, err
	}
	if ok {
		return record.Manifest, nil
	}
	if h.installService != nil {
		manifest, err := h.installService.LoadManifestFromCatalog(ctx, pluginID)
		if err != nil && !errors.Is(err, service.ErrPluginCatalogEntryNotFound) {
			return sdkmanifest.Manifest{}, err
		}
		if err == nil {
			return manifest, nil
		}
	}
	return sdkmanifest.Manifest{}, pluginengine.ErrPluginNotFound
}

func resolveAuthAction(manifest sdkmanifest.Manifest, actionID string) (sdkconfig.AuthAction, error) {
	if manifest.Auth == nil {
		return sdkconfig.AuthAction{}, pluginerrors.New(pluginerrors.ErrCodeUnsupported, "plugin does not declare any auth actions")
	}
	for _, action := range manifest.Auth.Actions {
		if action.ID == actionID {
			return action, nil
		}
	}
	return sdkconfig.AuthAction{}, pluginerrors.New(pluginerrors.ErrCodeConfigInvalid, "unsupported auth action")
}

// UpdateConfig stores an encrypted plugin secret and leaves the plugin disabled
// until the next activation so the new env takes effect on process start.
// PUT /api/v1/plugins/:id/config
func (h *PluginHandler) UpdateConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	var req updatePluginConfigRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}
	if strings.TrimSpace(req.Field) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "field is required"})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	manifest, err := h.resolveManifest(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	status, reactivationRequired, err := h.mutatePluginSecrets(ctx, c.Params("id"), func() (*service.PluginConfigStatus, error) {
		return h.secretService.SetSecret(c.Params("id"), manifest, req.Field, req.Value)
	})
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(fiber.Map{
		"config":                status,
		"reactivation_required": reactivationRequired,
		"message":               "config saved; activate the plugin again to apply it",
	})
}

// DeleteConfig removes a stored plugin secret. Environment variable fallback may still apply.
// DELETE /api/v1/plugins/:id/config/:field
func (h *PluginHandler) DeleteConfig(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	manifest, err := h.resolveManifest(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}

	status, reactivationRequired, err := h.mutatePluginSecrets(ctx, c.Params("id"), func() (*service.PluginConfigStatus, error) {
		return h.secretService.DeleteSecret(c.Params("id"), manifest, c.Params("field"))
	})
	if err != nil {
		return writePluginError(c, err)
	}
	return c.JSON(fiber.Map{
		"config":                status,
		"reactivation_required": reactivationRequired,
		"message":               "config deleted; activate the plugin again to apply it",
	})
}

// AuthAction executes a manifest-declared auth action and stores mapped secrets.
// POST /api/v1/plugins/:id/auth/:action
func (h *PluginHandler) AuthAction(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}
	if h.authService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin auth service is not configured"})
	}

	var req pluginAuthActionRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	manifest, err := h.resolveManifest(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}
	action, err := resolveAuthAction(manifest, c.Params("action"))
	if err != nil {
		return writePluginError(c, err)
	}

	result, err := h.authService.Execute(ctx, action, req.Values)
	if err != nil {
		return writePluginError(c, err)
	}

	status, reactivationRequired, err := h.mutatePluginSecrets(ctx, c.Params("id"), func() (*service.PluginConfigStatus, error) {
		return h.secretService.SetSecrets(ctx, c.Params("id"), manifest, result.Secrets)
	})
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(fiber.Map{
		"config":                status,
		"reactivation_required": reactivationRequired,
		"message":               "auth action succeeded; activate the plugin again to apply it",
		"expires_in":            result.Metadata["expires_in"],
		"token_type":            result.Metadata["token_type"],
	})
}

// DeleteAuthAction removes secrets stored by a manifest-declared auth action.
// DELETE /api/v1/plugins/:id/auth/:action
func (h *PluginHandler) DeleteAuthAction(c *fiber.Ctx) error {
	if h.secretService == nil {
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{"error": "plugin secret service is not configured"})
	}

	ctx := c.UserContext()
	if ctx == nil {
		ctx = context.Background()
	}
	manifest, err := h.resolveManifest(ctx, c.Params("id"))
	if err != nil {
		return writePluginError(c, err)
	}
	action, err := resolveAuthAction(manifest, c.Params("action"))
	if err != nil {
		return writePluginError(c, err)
	}

	status, reactivationRequired, err := h.mutatePluginSecrets(ctx, c.Params("id"), func() (*service.PluginConfigStatus, error) {
		fieldKeys := make([]string, 0, len(action.StoreMappings))
		for targetKey := range action.StoreMappings {
			fieldKeys = append(fieldKeys, targetKey)
		}
		return h.secretService.DeleteSecrets(ctx, c.Params("id"), manifest, fieldKeys)
	})
	if err != nil {
		return writePluginError(c, err)
	}

	return c.JSON(fiber.Map{
		"config":                status,
		"message":               "stored auth tokens removed",
		"deleted":               true,
		"plugin_id":             c.Params("id"),
		"reactivation_required": reactivationRequired,
	})
}

func (h *PluginHandler) mutatePluginSecrets(ctx context.Context, pluginID string, mutate pluginConfigMutation) (*service.PluginConfigStatus, bool, error) {
	record, ok, err := h.manager.Get(pluginID)
	if err != nil {
		return nil, false, fmt.Errorf("read plugin state: %w", err)
	}

	reactivationRequired := ok && record.State == sdkstate.Active
	if reactivationRequired {
		if _, deactivateErr := h.manager.Deactivate(ctx, record.ID); deactivateErr != nil {
			return nil, false, deactivateErr
		}
	}

	status, err := mutate()
	if err != nil {
		if reactivationRequired {
			if _, reactivateErr := h.manager.Activate(ctx, pluginID); reactivateErr != nil {
				pluginState := sdkstate.State("")
				if current, currentOK, getErr := h.manager.Get(pluginID); getErr == nil && currentOK {
					pluginState = current.State
				}
				return nil, false, &pluginMutationError{
					err:                  fmt.Errorf("plugin config mutation failed: %w (also failed to restore active state: %v)", err, reactivateErr),
					pluginState:          pluginState,
					reactivationRequired: true,
					restoreFailed:        true,
				}
			}
		}
		pluginState := sdkstate.State("")
		if reactivationRequired {
			pluginState = sdkstate.Active
		} else if ok {
			pluginState = record.State
		}
		return nil, false, &pluginMutationError{
			err:                  err,
			pluginState:          pluginState,
			reactivationRequired: reactivationRequired,
		}
	}

	return status, reactivationRequired, nil
}

func toPluginRecordResponse(record pluginengine.Record, includePath bool) pluginRecordResponse {
	resp := pluginRecordResponse{
		ID:        record.ID,
		Manifest:  record.Manifest,
		State:     string(record.State),
		LastError: record.LastError,
		CreatedAt: record.CreatedAt.Format("2006-01-02T15:04:05Z07:00"),
		UpdatedAt: record.UpdatedAt.Format("2006-01-02T15:04:05Z07:00"),
	}
	if includePath {
		resp.InstallPath = record.InstallPath
	}
	return resp
}

func writePluginError(c *fiber.Ctx, err error) error {
	var mutationErr *pluginMutationError
	_ = errors.As(err, &mutationErr)
	body := func(message string, code ...string) fiber.Map {
		payload := fiber.Map{"error": message}
		if len(code) > 0 && code[0] != "" {
			payload["code"] = code[0]
		}
		if mutationErr != nil {
			if mutationErr.pluginState != "" {
				payload["plugin_state"] = string(mutationErr.pluginState)
			}
			payload["reactivation_required"] = mutationErr.reactivationRequired
			payload["restore_failed"] = mutationErr.restoreFailed
		}
		return payload
	}

	switch {
	case errors.Is(err, pluginengine.ErrPluginNotFound):
		return c.Status(fiber.StatusNotFound).JSON(body(err.Error()))
	case errors.Is(err, pluginruntime.ErrNotRunning):
		return c.Status(fiber.StatusConflict).JSON(body(err.Error()))
	default:
		var pluginErr *pluginerrors.PluginError
		if errors.As(err, &pluginErr) {
			status := fiber.StatusBadRequest
			switch pluginErr.Code {
			case pluginerrors.ErrCodeArtifactNotFound:
				status = fiber.StatusNotFound
			case pluginerrors.ErrCodeChecksumMismatch, pluginerrors.ErrCodeIncompatibleVersion:
				status = fiber.StatusConflict
			}
			return c.Status(status).JSON(body(pluginErr.Message, string(pluginErr.Code)))
		}
		switch {
		case errors.Is(err, service.ErrPluginRegistryNotConfigured):
			return c.Status(fiber.StatusNotImplemented).JSON(body(err.Error()))
		case errors.Is(err, service.ErrPluginCatalogEntryNotFound):
			return c.Status(fiber.StatusNotFound).JSON(body(err.Error()))
		}
		return c.Status(fiber.StatusInternalServerError).JSON(body(err.Error()))
	}
}
