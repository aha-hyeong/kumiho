package middleware

import (
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
)

func TestProtectedSessionReuseAndThrottle(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "auth.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	auth := service.NewAuthService(repository.NewUserRepository(), repository.NewSessionRepository(), &config.Config{JWTSecret: "test-secret"})
	tokens, registerErr := auth.Register(&service.RegisterRequest{Username: "admin", Nickname: "Admin", Password: "password123"}, &service.LoginContext{UserAgent: "test", IPAddress: "127.0.0.1"})
	if registerErr != nil {
		t.Fatal(registerErr)
	}
	claims, validateErr := auth.ValidateToken(tokens.AccessToken)
	if validateErr != nil {
		t.Fatal(validateErr)
	}
	sid := claims["sid"].(string)
	app := fiber.New()
	app.Get("/protected", NewAuthMiddleware(auth).Protected(), func(c *fiber.Ctx) error {
		session, _ := c.Locals("session").(*model.Session)
		if session != nil && (session.ID != c.Locals("deviceID") || session.UserID != c.Locals("userID")) {
			return c.SendStatus(500)
		}
		return c.SendStatus(204)
	})
	request := func(token string) int {
		t.Helper()
		req := httptest.NewRequest("GET", "/protected", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := app.Test(req, -1)
		if err != nil {
			t.Fatal(err)
		}
		_ = res.Body.Close()
		return res.StatusCode
	}
	assertStatus := func(token string, want int) {
		t.Helper()
		if got := request(token); got != want {
			t.Fatalf("status = %d, want %d", got, want)
		}
	}
	readActivity := func() time.Time {
		t.Helper()
		var ts time.Time
		if err := database.DB.QueryRow(`SELECT last_active_at FROM sessions WHERE id=?`, sid).Scan(&ts); err != nil {
			t.Fatal(err)
		}
		return ts
	}
	assertStatus("", 401)
	assertStatus("malformed", 401)
	assertStatus(tokens.AccessToken, 204)
	initial := readActivity()
	assertStatus(tokens.AccessToken, 204)
	if !readActivity().Equal(initial) {
		t.Fatal("activity updated for recent session")
	}
	if _, err := database.DB.Exec(`UPDATE sessions SET last_active_at=datetime('now', '-6 minutes') WHERE id=?`, sid); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := request(tokens.AccessToken); got != 204 {
				t.Errorf("concurrent status = %d", got)
			}
		}()
	}
	wg.Wait()
	if time.Since(readActivity()) > time.Minute {
		t.Fatal("stale activity not updated")
	}
	otherClaims := jwt.MapClaims{"sub": "other-user", "sid": sid, "type": "access", "exp": time.Now().Add(time.Hour).Unix()}
	otherToken, signErr := jwt.NewWithClaims(jwt.SigningMethodHS256, otherClaims).SignedString([]byte("test-secret"))
	if signErr != nil {
		t.Fatal(signErr)
	}
	assertStatus(otherToken, 401)
	if _, err := database.DB.Exec(`UPDATE sessions SET expires_at=datetime('now', '-1 hour') WHERE id=?`, sid); err != nil {
		t.Fatal(err)
	}
	assertStatus(tokens.AccessToken, 401)
	if _, err := database.DB.Exec(`UPDATE sessions SET expires_at=datetime('now', '+1 hour') WHERE id=?`, sid); err != nil {
		t.Fatal(err)
	}
	if err := auth.RevokeSessionByAdmin(sid); err != nil {
		t.Fatal(err)
	}
	assertStatus(tokens.AccessToken, 401)
}
