package handler

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
	sqlite3 "github.com/mattn/go-sqlite3"
)

// Count actual database/sql queries without optional SQLite trace build tags or
// production instrumentation. The embedded SQLite connection executes the SQL.
type homeQueryLog struct {
	sync.Mutex
	queries []string
}

func (l *homeQueryLog) reset() { l.Lock(); defer l.Unlock(); l.queries = nil }
func (l *homeQueryLog) snapshot() []string {
	l.Lock()
	defer l.Unlock()
	return append([]string(nil), l.queries...)
}

type homeCountDriver struct{ log *homeQueryLog }

func (d homeCountDriver) Open(name string) (driver.Conn, error) {
	conn, err := (&sqlite3.SQLiteDriver{}).Open(name)
	if err != nil {
		return nil, err
	}
	return &homeCountConn{SQLiteConn: conn.(*sqlite3.SQLiteConn), log: d.log}, nil
}

type homeCountConn struct {
	*sqlite3.SQLiteConn
	log *homeQueryLog
}

func (c *homeCountConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	c.log.Lock()
	c.log.queries = append(c.log.queries, q)
	c.log.Unlock()
	return c.SQLiteConn.QueryContext(ctx, q, args)
}

var homeDriverSequence uint64

func TestHomeHandlerQueryCountDoesNotGrowWithLibraries(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "home.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	log := &homeQueryLog{}
	name := fmt.Sprintf("home-counter-%d", atomic.AddUint64(&homeDriverSequence, 1))
	sql.Register(name, homeCountDriver{log: log})
	var err error
	database.DB, err = sql.Open(name, dbPath+"?_foreign_keys=on")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	exec := func(q string, args ...any) {
		t.Helper()
		if _, err := database.DB.Exec(q, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,username,nickname,password_hash,role) VALUES ('u','u','u','test','MASTER')`)
	for i := 0; i < 30; i++ {
		lib, id := fmt.Sprintf("lib%02d", i), fmt.Sprintf("s%02d", i)
		exec(`INSERT INTO libraries(id,name,type,library_type,original_title_override) VALUES (?,?,'LOCAL','book',?)`, lib, lib, i%2 == 0)
		// Deliberately nonexistent, distinct paths can also be checked with strace:
		// Home JSON should not stat/open any /home-json-cold-cover-probe/ path.
		exec(`INSERT INTO series(id,library_id,title,path,thumbnail_path,last_content_updated_at) VALUES (?,?,?,?,?,?)`, id, lib, id, "/"+id, "/home-json-cold-cover-probe/"+id+".jpg", time.Now())
		exec(`INSERT INTO series_metadata(series_id,original_titles) VALUES (?,?)`, id, `{"ko":"한국어","en":"English","ja":"日本語"}`)
		exec(`INSERT INTO user_bookmarks(user_id,series_id) VALUES ('u',?)`, id)
	}
	sr := repository.NewSeriesRepository()
	h := &SeriesHandler{seriesRepo: sr, libraryRepo: repository.NewLibraryRepository(), settingRepo: repository.NewSettingRepository(), seriesEnrichSvc: service.NewSeriesEnrichService(sr, repository.NewChapterRepository(), repository.NewVolumeRepository())}
	app := fiber.New()
	app.Get("/series/home", func(c *fiber.Ctx) error { c.Locals("userID", "u"); c.Locals("role", model.RoleMaster); return c.Next() }, h.GetHomeSeries)
	baseline := map[string]int{}
	for _, n := range []int{1, 5, 30} {
		for i := 0; i < 30; i++ {
			exec(`UPDATE series SET library_id=? WHERE id=?`, fmt.Sprintf("lib%02d", i%n), fmt.Sprintf("s%02d", i))
		}
		for _, locale := range []string{"en", "ja"} {
			if err := h.settingRepo.Update(nil, "original_title_locale", locale); err != nil {
				t.Fatal(err)
			}
			for _, section := range []string{"updated", "liked"} {
				log.reset()
				response, err := app.Test(httptest.NewRequest("GET", "/series/home?section="+section, nil), -1)
				if err != nil {
					t.Fatal(err)
				}
				var payload struct {
					Updated []model.Series `json:"updated_series"`
					Liked   []model.Series `json:"liked_series"`
				}
				err = json.NewDecoder(response.Body).Decode(&payload)
				response.Body.Close()
				if err != nil {
					t.Fatal(err)
				}
				cards := payload.Updated
				if section == "liked" {
					cards = payload.Liked
				}
				if response.StatusCode != 200 || len(cards) != 30 {
					t.Fatalf("status=%d cards=%d", response.StatusCode, len(cards))
				}
				queries := log.snapshot()
				for _, q := range queries {
					if strings.Contains(q, "FROM library_paths") {
						t.Errorf("Home title must not fetch library_paths: %s", q)
					}
				}
				if n == 1 {
					baseline[section] = len(queries)
				} else if len(queries) != baseline[section] {
					t.Errorf("%s SQL grew with libraries: 1 library=%d, %d libraries=%d", section, baseline[section], n, len(queries))
				}
				t.Logf("%s locale=%s: 30 cards / %d libraries => %d SQL", section, locale, n, len(queries))
				for _, s := range cards {
					var lib int
					if _, err := fmt.Sscanf(s.LibraryID, "lib%d", &lib); err != nil {
						t.Fatal(err)
					}
					want := s.Title
					if lib%2 == 0 {
						want = "English"
						if locale == "ja" {
							want = "日本語"
						}
					}
					if s.DisplayTitle != want {
						t.Errorf("%s display title=%q want=%q", s.ID, s.DisplayTitle, want)
					}
				}
			}
		}
	}
}
