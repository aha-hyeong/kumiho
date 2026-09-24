package runtime

import (
	"context"
	"errors"
	"time"

	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

// OperationTimeout bounds plugin requests independently of healthchecks.
// Metadata providers may legitimately take 10 seconds or more.
const OperationTimeout = 15 * time.Second

var (
	ErrNotImplemented = errors.New("runtime not implemented")
	ErrNotRunning     = errors.New("plugin process is not running")
	ErrStopTimeout    = errors.New("plugin stop timed out and was force killed")
)

// Instance is the runtime-facing view of a plugin installation.
type Instance struct {
	ID          string
	Manifest    sdkmanifest.Manifest
	InstallPath string
	Env         map[string]string
}

// Runtime manages plugin lifecycle for a specific runtime type.
type Runtime interface {
	Type() sdkmanifest.RuntimeType
	Start(ctx context.Context, inst Instance) error
	Stop(ctx context.Context, inst Instance) error
	Healthcheck(ctx context.Context, inst Instance) (*healthcheck.Response, error)
	Search(ctx context.Context, inst Instance, req *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error)
	Fetch(ctx context.Context, inst Instance, req *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error)
	Translate(ctx context.Context, inst Instance, req *sdktypes.TranslateRequest) (*sdktypes.TranslateResponse, error)
	Detect(ctx context.Context, inst Instance, req *sdktypes.DetectRequest) (*sdktypes.DetectResponse, error)
}

// StubRuntime is used until a concrete runtime adapter is implemented.
type StubRuntime struct {
	runtimeType sdkmanifest.RuntimeType
}

func NewStubRuntime(runtimeType sdkmanifest.RuntimeType) *StubRuntime {
	return &StubRuntime{runtimeType: runtimeType}
}

func (r *StubRuntime) Type() sdkmanifest.RuntimeType {
	return r.runtimeType
}

func (r *StubRuntime) Start(context.Context, Instance) error {
	return ErrNotImplemented
}

func (r *StubRuntime) Stop(context.Context, Instance) error {
	return ErrNotImplemented
}

func (r *StubRuntime) Healthcheck(context.Context, Instance) (*healthcheck.Response, error) {
	return nil, ErrNotImplemented
}

func (r *StubRuntime) Search(context.Context, Instance, *sdktypes.SearchRequest) (*sdktypes.SearchResponse, error) {
	return nil, ErrNotImplemented
}

func (r *StubRuntime) Fetch(context.Context, Instance, *sdktypes.FetchRequest) (*sdktypes.FetchResponse, error) {
	return nil, ErrNotImplemented
}

func (r *StubRuntime) Translate(context.Context, Instance, *sdktypes.TranslateRequest) (*sdktypes.TranslateResponse, error) {
	return nil, ErrNotImplemented
}

func (r *StubRuntime) Detect(context.Context, Instance, *sdktypes.DetectRequest) (*sdktypes.DetectResponse, error) {
	return nil, ErrNotImplemented
}
