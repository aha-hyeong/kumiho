package binary

import (
	"context"
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

func TestBinaryRuntimeOperationNotClampedByHealthcheckTimeout(t *testing.T) {
	rt := NewRuntime()
	if rt.client.Timeout == healthcheck.DefaultTimeout {
		t.Fatalf("regression Issue #338: binary runtime client uses healthcheck.DefaultTimeout (%v) which prematurely terminates valid plugin operations", rt.client.Timeout)
	}
}
