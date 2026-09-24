package service

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

func benchmarkHomeLoad(b *testing.B, optimized bool) {
	if err := database.Connect(filepath.Join(b.TempDir(), "home-bench.db")); err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = database.Close(); database.DB = nil })
	tx, err := database.DB.Begin()
	if err != nil {
		b.Fatal(err)
	}
	if _, err = tx.Exec(`INSERT INTO libraries(id,name,type,library_type) VALUES ('lib','Lib','LOCAL','book')`); err != nil {
		b.Fatal(err)
	}
	if _, err = tx.Exec(`INSERT INTO users(id,username,nickname,password_hash,role) VALUES ('u','u','u','hash','USER')`); err != nil {
		b.Fatal(err)
	}
	for i := 0; i < 400; i++ {
		id := fmt.Sprintf("s-%04d", i)
		v := id + "-v"
		c := id + "-c"
		for _, row := range []struct {
			query string
			args  []any
		}{
			{`INSERT INTO series(id,library_id,title,path,thumbnail_path,last_content_updated_at) VALUES (?,'lib',?,?,?,?)`, []any{id, id, "/" + id, "/cover.jpg", time.Now()}},
			{`INSERT INTO volumes(id,series_id,title,volume_number,path) VALUES (?,?,?,1,?)`, []any{v, id, "V", "/" + v}},
			{`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES (?,?,?,1,?,20)`, []any{c, v, "C", "/" + c}},
		} {
			if _, err = tx.Exec(row.query, row.args...); err != nil {
				b.Fatal(err)
			}
		}
	}
	if err = tx.Commit(); err != nil {
		b.Fatal(err)
	}
	repo := repository.NewSeriesRepository()
	svc := NewSeriesEnrichService(repo, repository.NewChapterRepository(), repository.NewVolumeRepository())
	b.ResetTimer()
	var cards []model.Series
	for i := 0; i < b.N; i++ {
		if optimized {
			ids, e := repo.FindHomeRecentIDs(nil, time.Now().Add(-7*24*time.Hour), 30, nil, true)
			if e != nil {
				b.Fatal(e)
			}
			cards, e = repo.FindByIDs(nil, ids, "u")
			if e != nil {
				b.Fatal(e)
			}
			if e = svc.EnrichHomeList(cards, "u"); e != nil {
				b.Fatal(e)
			}
		} else {
			var e error
			cards, e = repo.FindByLibraryID(nil, "lib", "u")
			if e != nil {
				b.Fatal(e)
			}
			svc.EnrichList(cards, "u")
		}
	}
	b.StopTimer()
	data, err := json.Marshal(cards)
	if err != nil {
		b.Fatal(err)
	}
	b.ReportMetric(float64(len(data)), "bytes/response")
}

func BenchmarkHomeSeriesOld(b *testing.B) { benchmarkHomeLoad(b, false) }
func BenchmarkHomeSeriesNew(b *testing.B) { benchmarkHomeLoad(b, true) }
