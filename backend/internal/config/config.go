package config

import (
	"os"
	"path/filepath"
)

const defaultPluginRegistryURL = "https://raw.githubusercontent.com/kumiho-plugin/kumiho-plugin-registry/main/index.json"

type Config struct {
	Port              string
	DatabasePath      string
	JWTSecret         string
	PluginSecretKey   string
	DataDir           string
	PluginDir         string
	PluginRegistryURL string
	CookieDomain      string // 쿠키 도메인 (빈 값 = 현재 도메인)
	CookieSecure      bool   // HTTPS 전용 쿠키 여부
}

func Load() *Config {
	env := getEnv("ENVIRONMENT", "development")
	dataDir := getEnv("DATA_DIR", "./data")
	return &Config{
		Port:              getEnv("PORT", "9999"),
		DatabasePath:      getEnv("DATABASE_PATH", filepath.Join(dataDir, "kumiho.db")),
		JWTSecret:         getEnv("JWT_SECRET", "your-super-secret-key-change-in-production"),
		PluginSecretKey:   getEnv("PLUGIN_SECRET_KEY", ""),
		DataDir:           dataDir,
		PluginDir:         getEnv("PLUGIN_DIR", filepath.Join(dataDir, "plugins")),
		PluginRegistryURL: getEnv("PLUGIN_REGISTRY_URL", defaultPluginRegistryURL),
		CookieDomain:      getEnv("COOKIE_DOMAIN", ""),
		CookieSecure:      env == "production", // 프로덕션에서만 Secure 쿠키
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
