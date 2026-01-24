package config

import (
	"os"
)

type Config struct {
	Port         string
	DatabasePath string
	JWTSecret    string
	DataDir      string
	Environment  string
	CookieDomain string // 쿠키 도메인 (빈 값 = 현재 도메인)
	CookieSecure bool   // HTTPS 전용 쿠키 여부
}

func Load() *Config {
	env := getEnv("ENVIRONMENT", "development")
	return &Config{
		Port:         getEnv("PORT", "8080"),
		DatabasePath: getEnv("DATABASE_PATH", "./data/kumiho.db"),
		JWTSecret:    getEnv("JWT_SECRET", "your-super-secret-key-change-in-production"),
		DataDir:      getEnv("DATA_DIR", "./data"),
		Environment:  env,
		CookieDomain: getEnv("COOKIE_DOMAIN", ""),
		CookieSecure: env == "production", // 프로덕션에서만 Secure 쿠키
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}


