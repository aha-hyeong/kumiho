package runtime

import (
	"net"
	"slices"
	"strconv"
	"strings"
	"testing"
)

func TestBuildCommandEnvPrecedenceAndDeterminism(t *testing.T) {
	t.Setenv("KUMIHO_ENV_INHERITED", "keep=all=equals")
	t.Setenv("KUMIHO_ENV_REPLACED", "parent")
	t.Setenv("KUMIHO_PLUGIN_HOST", "parent-host")
	t.Setenv("KUMIHO_PLUGIN_PORT", "1")

	for _, tc := range []struct {
		name       string
		overrides  map[string]string
		host, port string
	}{
		{"defaults", nil, "127.0.0.1", "43210"},
		{"overrides", map[string]string{
			"KUMIHO_PLUGIN_HOST": "override-host", "KUMIHO_PLUGIN_PORT": "12345",
			"KUMIHO_ENV_REPLACED": "override", "KUMIHO_ENV_EMPTY": "", "": "ignored",
		}, "override-host", "12345"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			env := BuildCommandEnv("127.0.0.1", 43210, tc.overrides)
			if !slices.Equal(env, BuildCommandEnv("127.0.0.1", 43210, tc.overrides)) {
				t.Fatal("environment output is nondeterministic")
			}
			seen := make(map[string]string)
			last := ""
			for _, entry := range env {
				key, value, ok := strings.Cut(entry, "=")
				if !ok || key == "" || key <= last {
					t.Fatal("environment keys must be unique, nonempty and sorted")
				}
				last = key
				seen[key] = value
			}
			if seen["KUMIHO_ENV_INHERITED"] != "keep=all=equals" || seen["KUMIHO_PLUGIN_HOST"] != tc.host || seen["KUMIHO_PLUGIN_PORT"] != tc.port {
				t.Fatal("inheritance or host/port precedence changed")
			}
			replaced := "parent"
			if tc.overrides != nil {
				replaced = "override"
				if value, ok := seen["KUMIHO_ENV_EMPTY"]; !ok || value != "" {
					t.Fatal("empty override values must be preserved")
				}
			}
			if seen["KUMIHO_ENV_REPLACED"] != replaced {
				t.Fatal("parent/override precedence changed")
			}
		})
	}
}

func TestAllocatePortClosesListener(t *testing.T) {
	const host = "127.0.0.1"
	port, err := AllocatePort(host)
	if err != nil || port <= 0 || port > 65535 {
		t.Fatalf("AllocatePort() = %d, %v", port, err)
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("allocated listener was not closed: %v", err)
	}
	defer func() { _ = ln.Close() }()
	addr, ok := ln.Addr().(*net.TCPAddr)
	if !ok || addr.IP.String() != host || addr.Port != port {
		t.Fatalf("unexpected bind address: %v", ln.Addr())
	}
}

func TestAllocatePortReturnsBindError(t *testing.T) {
	port, err := AllocatePort("127.0.0.1:invalid")
	if err == nil || port != 0 {
		t.Fatalf("invalid host: AllocatePort() = %d, %v", port, err)
	}
}
