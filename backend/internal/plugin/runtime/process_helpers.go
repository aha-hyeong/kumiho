package runtime

import (
	"errors"
	"net"
	"os"
	"sort"
	"strconv"
	"strings"
)

const (
	EnvPluginHost = "KUMIHO_PLUGIN_HOST"
	EnvPluginPort = "KUMIHO_PLUGIN_PORT"
)

// BuildCommandEnv inherits the parent environment, then applies host/port and overrides.
func BuildCommandEnv(host string, port int, overrides map[string]string) []string {
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

// AllocatePort asks the OS for an available TCP port on host and closes the listener.
func AllocatePort(host string) (int, error) {
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
