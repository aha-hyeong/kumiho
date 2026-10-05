package sse

import (
	"fmt"
	"testing"
	"time"
)

func TestHubRetainsLifecycleAndUserCountNotifications(t *testing.T) {
	hub := NewHub()
	go hub.Run()
	keep := NewClient(hub, "a", "keep", "", "", "USER", "viewer")
	old := NewClient(hub, "a", "old", "", "", "USER", "viewer")
	other := NewClient(hub, "b", "other", "", "", "USER", "viewer")
	assertMessage := func(client *Client, want string) {
		t.Helper()
		select {
		case data, open := <-client.Message:
			if want == "" {
				if open {
					t.Fatalf("session %s: channel still open, message = %s", client.SessionID, data)
				}
			} else if !open || string(data) != want {
				t.Fatalf("session %s: message = %s, open = %v, want %s", client.SessionID, data, open, want)
			}
		case <-time.After(2 * time.Second):
			t.Fatalf("session %s: timed out waiting for message or close", client.SessionID)
		}
	}
	userCount := func(count int) string {
		return fmt.Sprintf("event: message\ndata: {\"type\":\"USER_COUNT\",\"payload\":{\"count\":%d}}\n\n", count)
	}

	hub.Register(keep)
	assertMessage(keep, userCount(1))
	hub.Register(old)
	assertMessage(keep, userCount(1))
	assertMessage(old, userCount(1))
	hub.Register(other)
	for _, client := range []*Client{keep, old, other} {
		assertMessage(client, userCount(2))
	}

	hub.ForceLogoutOtherSessions("a", "keep")
	assertMessage(old, "event: message\ndata: {\"type\":\"FORCE_LOGOUT\",\"payload\":{\"reason\":\"DUPLICATE_LOGIN\"}}\n\n")
	for _, client := range []*Client{keep, other} {
		select {
		case data := <-client.Message:
			t.Fatalf("session %s received another session's force logout: %s", client.SessionID, data)
		default:
		}
	}

	hub.DisconnectSession("a", "old")
	assertMessage(old, "")
	assertMessage(keep, userCount(2))
	assertMessage(other, userCount(2))

	stale := NewClient(hub, "a", "stale", "", "", "USER", "viewer")
	hub.Register(stale)
	for _, client := range []*Client{keep, stale, other} {
		assertMessage(client, userCount(2))
	}
	hub.DisconnectOtherSessions("a", "keep")
	assertMessage(stale, "")
	assertMessage(keep, userCount(2))
	assertMessage(other, userCount(2))

	hub.Unregister(other)
	assertMessage(other, "")
	assertMessage(keep, userCount(1))
	hub.TriggerUserCount()
	assertMessage(keep, userCount(1))
	hub.Unregister(keep)
	assertMessage(keep, "")
	hub.mu.RLock()
	defer hub.mu.RUnlock()
	if len(hub.clients) != 0 {
		t.Fatalf("connected users = %d, want 0", len(hub.clients))
	}
}
