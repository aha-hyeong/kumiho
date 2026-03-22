package service

import (
	"path/filepath"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func TestRegisterOnFreshDatabaseCreatesAdminAndSession(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	authService := NewAuthService(
		repository.NewUserRepository(),
		repository.NewSessionRepository(),
		&config.Config{JWTSecret: "test-secret"},
	)

	tokens, err := authService.Register(&RegisterRequest{
		Username: "admin",
		Nickname: "관리자",
		Password: "password123",
	}, &LoginContext{
		UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
		IPAddress: "127.0.0.1",
	})
	if err != nil {
		t.Fatalf("Register() error = %v", err)
	}

	if tokens.User == nil {
		t.Fatal("Register() returned nil user")
	}
	if tokens.User.Role != model.RoleMaster {
		t.Fatalf("Register() role = %s, want %s", tokens.User.Role, model.RoleMaster)
	}
	if !tokens.User.CanDownload {
		t.Fatal("Register() can_download = false, want true")
	}

	userCount, err := repository.NewUserRepository().Count(nil)
	if err != nil {
		t.Fatalf("UserRepository.Count() error = %v", err)
	}
	if userCount != 1 {
		t.Fatalf("UserRepository.Count() = %d, want 1", userCount)
	}

	sessionCount := 0
	if err := database.DB.QueryRow(`SELECT COUNT(*) FROM sessions`).Scan(&sessionCount); err != nil {
		t.Fatalf("count sessions error = %v", err)
	}
	if sessionCount != 1 {
		t.Fatalf("sessions count = %d, want 1", sessionCount)
	}
}

func TestRegisterRollsBackWhenSessionCreationFails(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	if _, err := database.DB.Exec(`DROP TABLE sessions`); err != nil {
		t.Fatalf("DROP TABLE sessions error = %v", err)
	}

	authService := NewAuthService(
		repository.NewUserRepository(),
		repository.NewSessionRepository(),
		&config.Config{JWTSecret: "test-secret"},
	)

	_, err := authService.Register(&RegisterRequest{
		Username: "admin",
		Nickname: "관리자",
		Password: "password123",
	}, &LoginContext{
		UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/123.0.0.0 Safari/537.36",
		IPAddress: "127.0.0.1",
	})
	if err == nil {
		t.Fatal("Register() error = nil, want error")
	}

	userCount, err := repository.NewUserRepository().Count(nil)
	if err != nil {
		t.Fatalf("UserRepository.Count() error = %v", err)
	}
	if userCount != 0 {
		t.Fatalf("UserRepository.Count() = %d, want 0", userCount)
	}
}
