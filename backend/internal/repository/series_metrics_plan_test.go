package repository

import (
	"database/sql"
	"strings"
	"testing"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

type metricsPlanQueryer struct {
	database.Queryer
	plans [][]string
}

func (q *metricsPlanQueryer) Query(query string, args ...any) (*sql.Rows, error) {
	rows, err := q.Queryer.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var plan []string
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			return nil, err
		}
		plan = append(plan, detail)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	q.plans = append(q.plans, plan)
	return q.Queryer.Query(query, args...)
}

func TestSeriesMetricsUseCoveringIndexes(t *testing.T) {
	connectSeriesRepositoryTestDB(t)
	q := &metricsPlanQueryer{Queryer: database.DB}
	ids := []string{"first", "second"}
	seriesRepo := NewSeriesRepository()
	if _, err := NewVolumeRepository().FindRootDisplayUnitsBySeriesIDs(q, ids); err != nil {
		t.Fatal(err)
	}
	if _, err := seriesRepo.GetListMetricsBatch(q, ids); err != nil {
		t.Fatal(err)
	}
	if _, err := seriesRepo.GetHomeMetrics(q, "reader", ids); err != nil {
		t.Fatal(err)
	}

	want := []struct {
		query  string
		tables []string
	}{
		{"root display units", []string{"volumes"}},
		{"list volume count", []string{"volumes"}},
		{"list chapter count and units", []string{"v", "c"}},
		{"home volume count and display units", []string{"volumes"}},
		{"home chapter count and units", []string{"v", "c"}},
	}
	if len(q.plans) != len(want) {
		t.Fatalf("captured %d plans, want %d", len(q.plans), len(want))
	}
	indexes := map[string]string{
		"volumes": "idx_volumes_series_metrics",
		"v":       "idx_volumes_series_metrics",
		"c":       "idx_chapters_volume_metrics",
	}
	for i, expected := range want {
		t.Logf("%s: %v", expected.query, q.plans[i])
		for _, table := range expected.tables {
			accesses := 0
			for _, detail := range q.plans[i] {
				if detail != "SCAN "+table && !strings.HasPrefix(detail, "SCAN "+table+" ") && !strings.HasPrefix(detail, "SEARCH "+table+" ") {
					continue
				}
				accesses++
				if !strings.Contains(detail, " USING COVERING INDEX "+indexes[table]+" ") {
					t.Errorf("%s: expected covering index %s for %s, got %s", expected.query, indexes[table], table, detail)
				}
			}
			if accesses == 0 {
				t.Errorf("%s: missing access to %s", expected.query, table)
			}
		}
	}
}
