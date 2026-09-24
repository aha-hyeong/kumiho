package middleware

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	sqlite3 "github.com/mattn/go-sqlite3"
)

type sessionSQLCounts struct {
	armed   atomic.Bool
	selects atomic.Int64
	updates atomic.Int64
	ready   chan struct{}
}

var sessionDriverSequence atomic.Uint64

type sessionCountDriver struct{ counts *sessionSQLCounts }

func (d sessionCountDriver) Open(name string) (driver.Conn, error) {
	conn, err := (&sqlite3.SQLiteDriver{}).Open(name)
	if err != nil {
		return nil, err
	}
	return &sessionCountConn{SQLiteConn: conn.(*sqlite3.SQLiteConn), counts: d.counts}, nil
}

type sessionCountConn struct {
	*sqlite3.SQLiteConn
	counts *sessionSQLCounts
}

func (c *sessionCountConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if c.counts.armed.Load() && strings.Contains(query, "FROM sessions WHERE id = ?") {
		if c.counts.selects.Add(1) == 20 {
			close(c.counts.ready)
		}
	}
	return c.SQLiteConn.QueryContext(ctx, query, args)
}

func (c *sessionCountConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if c.counts.armed.Load() && strings.HasPrefix(query, "UPDATE sessions SET last_active_at") {
		c.counts.updates.Add(1)
		// Hold the write until at least 20 session SELECTs have started.
		select {
		case <-c.counts.ready:
		case <-time.After(5 * time.Second):
		}
	}
	return c.SQLiteConn.ExecContext(ctx, query, args)
}

func TestProtectedSessionReuseAndThrottle(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "auth.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	counts := &sessionSQLCounts{ready: make(chan struct{})}
	driverName := fmt.Sprintf("auth-session-count-%d", sessionDriverSequence.Add(1))
	sql.Register(driverName, sessionCountDriver{counts: counts})
	var err error
	database.DB, err = sql.Open(driverName, dbPath+"?_foreign_keys=on&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
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
	staleSession, err := auth.GetSessionByID(sid)
	if err != nil {
		t.Fatal(err)
	}
	counts.armed.Store(true)
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
	// Each request validates its session; extra SELECTs are activity freshness
	// rechecks for stale snapshots, not a replacement for validity checks.
	if got := counts.selects.Load(); got < 20 || got > 40 {
		t.Errorf("session SELECTs = %d, want 20 validity checks plus at most 20 activity rechecks", got)
	}
	if got := counts.updates.Load(); got != 1 {
		t.Errorf("activity UPDATE statements = %d, want 1", got)
	}
	t.Logf("20 protected requests: session SELECTs=%d activity UPDATEs=%d", counts.selects.Load(), counts.updates.Load())
	counts.armed.Store(false)
	// A request that validated before the first write may reach the touch later.
	// It must not send a second UPDATE based on that stale snapshot.
	before := counts.updates.Load()
	counts.armed.Store(true)
	auth.UpdateSessionLastActive(staleSession)
	if got := counts.updates.Load(); got != before {
		t.Errorf("late stale snapshot issued %d additional activity UPDATEs, want 0", got-before)
	}
	counts.armed.Store(false)
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
