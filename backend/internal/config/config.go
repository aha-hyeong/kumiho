package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port         string
	DatabasePath string
	JWTSecret    string
	DataDir      string
	Environment  string
}

func Load() *Config {
	return &Config{
		Port:         getEnv("PORT", "8080"),
		DatabasePath: getEnv("DATABASE_PATH", "./data/kumiho.db"),
		JWTSecret:    getEnv("JWT_SECRET", "your-super-secret-key-change-in-production"),
		DataDir:      getEnv("DATA_DIR", "./data"),
		Environment:  getEnv("ENVIRONMENT", "development"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
