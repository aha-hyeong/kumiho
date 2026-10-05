package service

import (
	"context"
	"errors"
	"testing"

	"github.com/kumiho-plugin/kumiho-plugin-sdk/healthcheck"
)

func TestNewAttemptLifecycleIsIndependentPerRetry(t *testing.T) {
	firstExited, firstCtx, firstCancel := newAttemptLifecycle()
	firstCancel()

	select {
	case <-firstCtx.Done():
	default:
		t.Fatal("first attempt context should be canceled")
	}

	secondExited, secondCtx, secondCancel := newAttemptLifecycle()
	defer secondCancel()

	select {
	case <-secondCtx.Done():
		t.Fatal("second attempt context should be independent from first cancellation")
	default:
	}

	if firstExited == secondExited {
		t.Fatal("attempt lifecycles should not reuse the same exited channel")
	}
	if err := secondCtx.Err(); err != nil && err != context.Canceled {
		t.Fatalf("unexpected second context error: %v", err)
	}
}

func TestExitedErrorUsesRecordedExitWithoutConsumingSignal(t *testing.T) {
	rt := NewRuntime()
	exited := make(chan struct{})
	close(exited)

	rt.processes["plugin-a"] = processState{exited: exited}
	rt.lastExit["plugin-a"] = errors.New("process crashed")

	if err := rt.exitedError("plugin-a"); err == nil || err.Error() != "process crashed" {
		t.Fatalf("first exitedError() = %v, want process crashed", err)
	}
	if err := rt.exitedError("plugin-a"); err == nil || err.Error() != "process crashed" {
		t.Fatalf("second exitedError() = %v, want process crashed", err)
	}
}

func TestServiceRuntimeOperationNotClampedByHealthcheckTimeout(t *testing.T) {
	rt := NewRuntime()
	if rt.client.Timeout == healthcheck.DefaultTimeout {
		t.Fatalf("regression Issue #338: service runtime client uses healthcheck.DefaultTimeout (%v) which prematurely terminates valid plugin operations", rt.client.Timeout)
	}
}
