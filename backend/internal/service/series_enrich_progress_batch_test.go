package service

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	sqlite3 "github.com/mattn/go-sqlite3"
)

type progressQueryCounts struct {
	scalar, batch, total int
	failAtBatch          int
}

var progressCountDriverSequence atomic.Uint64

type progressCountDriver struct{ counts *progressQueryCounts }

func (d progressCountDriver) Open(name string) (driver.Conn, error) {
	conn, err := (&sqlite3.SQLiteDriver{}).Open(name)
	if err != nil {
		return nil, err
	}
	return &progressCountConn{SQLiteConn: conn.(*sqlite3.SQLiteConn), counts: d.counts}, nil
}

type progressCountConn struct {
	*sqlite3.SQLiteConn
	counts *progressQueryCounts
}

func (c *progressCountConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	c.counts.total++
	if strings.Contains(query, "WITH chapter_units AS") {
		if strings.Contains(query, "v.series_id IN (") {
			c.counts.batch++
			if c.counts.failAtBatch == c.counts.batch {
				return nil, errors.New("synthetic batch failure")
			}
		} else {
			c.counts.scalar++
		}
	}
	return c.SQLiteConn.QueryContext(ctx, query, args)
}

func progressListFixture(t testing.TB, count int) (*SeriesEnrichService, []model.Series, *progressQueryCounts) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "progress-list.db")
	if err := database.Connect(path); err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	counts := &progressQueryCounts{}
	name := fmt.Sprintf("progress-list-count-%d", progressCountDriverSequence.Add(1))
	sql.Register(name, progressCountDriver{counts: counts})
	db, err := sql.Open(name, path+"?_foreign_keys=on&_busy_timeout=30000&_journal_mode=WAL")
	if err != nil {
		t.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	database.DB = db
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Error(err)
		}
		database.DB = nil
	})
	tx, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(query, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('list-lib','Synthetic','LOCAL','book')`)
	exec(`INSERT INTO users(id,username,nickname,password_hash) VALUES ('list-reader','list-reader','Synthetic','unused')`)
	cover := "/synthetic/nonexistent-cover.jpg"
	list := make([]model.Series, count)
	for i := range list {
		id := fmt.Sprintf("s-%04d", i)
		exec(`INSERT INTO series(id,library_id,title,path,thumbnail_path) VALUES (?,'list-lib',?,?,?)`, id, id, "/synthetic/"+id, cover)
		exec(`INSERT INTO volumes(id,series_id,title,volume_number,path,unit) VALUES (?,?,'V',1,?,'volume')`, "v-"+id, id, "/synthetic/v-"+id)
		exec(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES (?,?,'C',1,?,100)`, "c-"+id, "v-"+id, "/synthetic/c-"+id)
		exec(`INSERT INTO reading_progress(id,user_id,series_id,volume_id,chapter_id,current_page,total_pages,progress_percent) VALUES (?,'list-reader',?,?,?,25,100,25)`, "p-"+id, id, "v-"+id, "c-"+id)
		list[i] = model.Series{ID: id, LibraryID: "list-lib", Title: id, Path: "/synthetic/" + id, ThumbnailPath: &cover, ReadPageCount: 999}
	}
	if err := tx.Commit(); err != nil {
		t.Fatal(err)
	}
	*counts = progressQueryCounts{}
	repo := repository.NewSeriesRepository()
	return NewSeriesEnrichService(repo, repository.NewChapterRepository(), repository.NewVolumeRepository()), list, counts
}

func TestSeriesEnrichListBatchesReadProgress(t *testing.T) {
	for _, tc := range []struct {
		name                         string
		count, failAt, batch, scalar int
		anonymous, single            bool
	}{
		{name: "measured-list-size", count: 353, batch: 1},
		{name: "chunk-boundary", count: 401, batch: 2},
		{name: "batch-failure-falls-back", count: 2, failAt: 1, batch: 1, scalar: 2},
		{name: "partial-batch-failure-falls-back", count: 401, failAt: 2, batch: 2, scalar: 401},
		{name: "no-user-preserves-existing-value", count: 3, anonymous: true},
		{name: "empty-list"},
		{name: "single-series-stays-scalar", count: 1, single: true, scalar: 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, list, counts := progressListFixture(t, tc.count)
			counts.failAtBatch = tc.failAt
			user := "list-reader"
			wantRead := 25
			if tc.anonymous {
				user = ""
				wantRead = 999
			}
			if tc.single {
				svc.EnrichSingle(&list[0], user)
			} else {
				svc.EnrichList(list, user)
			}
			if counts.batch != tc.batch || counts.scalar != tc.scalar {
				t.Errorf("read-progress queries: batch=%d scalar=%d, want batch=%d scalar=%d", counts.batch, counts.scalar, tc.batch, tc.scalar)
			}
			if tc.count == 0 && counts.total != 0 {
				t.Errorf("empty list executed %d queries", counts.total)
			}
			for _, s := range list {
				if s.ReadPageCount != wantRead || s.TotalPageCount != 100 || s.VolumeCount != 1 || s.ChapterCount != 1 || s.DisplayUnit != "volume" || s.ThumbnailURL == nil {
					t.Fatalf("series %s enrichment changed: read=%d total=%d volumes=%d chapters=%d display=%q", s.ID, s.ReadPageCount, s.TotalPageCount, s.VolumeCount, s.ChapterCount, s.DisplayUnit)
				}
			}
		})
	}
}
