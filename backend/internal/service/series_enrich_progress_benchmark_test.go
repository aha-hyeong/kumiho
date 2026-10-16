package service

import (
	"fmt"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
)

// Compare the unchanged scalar query and its batch equivalent on the same
// synthetic DB. This is not a NAS/API performance claim.
func BenchmarkReadProgressAggregation(b *testing.B) {
	_, list, counts := progressListFixture(b, 353)
	ids := make([]string, len(list))
	tx, err := database.DB.Begin()
	if err != nil {
		b.Fatal(err)
	}
	defer tx.Rollback()
	chapter, err := tx.Prepare(`INSERT INTO chapters(id,volume_id,title,chapter_number,path,page_count) VALUES (?,?,'Synthetic',?,?,100)`)
	if err != nil {
		b.Fatal(err)
	}
	defer chapter.Close()
	completion, err := tx.Prepare(`INSERT INTO chapter_completions(id,user_id,chapter_id) VALUES (?,'list-reader',?)`)
	if err != nil {
		b.Fatal(err)
	}
	defer completion.Close()
	for i, s := range list {
		ids[i] = s.ID
		for j := 1; j <= 20; j++ {
			id := fmt.Sprintf("history-%s-%02d", s.ID, j)
			if _, err := chapter.Exec(id, "v-"+s.ID, j+1, "/synthetic/"+id); err != nil {
				b.Fatal(err)
			}
			if _, err := completion.Exec("done-"+id, id); err != nil {
				b.Fatal(err)
			}
		}
	}
	if err := tx.Commit(); err != nil {
		b.Fatal(err)
	}
	repo := repository.NewSeriesRepository()
	scalar := func() (map[string]int, error) {
		values := make(map[string]int, len(ids))
		for _, id := range ids {
			value, err := repo.GetReadProgressUnits(nil, "list-reader", id)
			if err != nil {
				return nil, err
			}
			values[id] = value
		}
		return values, nil
	}
	batch := func() (map[string]int, error) { return repo.GetReadProgressUnitsBatch(nil, "list-reader", ids) }
	want, err := scalar()
	if err != nil {
		b.Fatal(err)
	}
	got, err := batch()
	if err != nil {
		b.Fatal(err)
	}
	for _, id := range ids {
		if got[id] != want[id] {
			b.Fatalf("batch/scalar mismatch for %s", id)
		}
	}
	for _, tc := range []struct {
		name string
		run  func() (map[string]int, error)
	}{{"scalar", scalar}, {"batch", batch}} {
		b.Run(tc.name, func(b *testing.B) {
			if _, err := tc.run(); err != nil {
				b.Fatal(err)
			}
			counts.scalar, counts.batch = 0, 0
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := tc.run(); err != nil {
					b.Fatal(err)
				}
			}
			b.StopTimer()
			b.ReportMetric(float64(counts.scalar+counts.batch)/float64(b.N), "progress_queries/op")
		})
	}
}
