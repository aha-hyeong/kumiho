package database

import "testing"

func TestSeriesMetricsIndexMigration(t *testing.T) {
	openRawTestDB(t)
	_, err := DB.Exec(`
		CREATE TABLE volumes (id TEXT PRIMARY KEY, series_id TEXT, parent_id TEXT, unit TEXT);
		CREATE TABLE chapters (id TEXT PRIMARY KEY, volume_id TEXT, duration REAL, page_count INTEGER, total_positions INTEGER, has_audio BOOLEAN);
		CREATE INDEX idx_volumes_series ON volumes(series_id);
		CREATE INDEX idx_chapters_volume ON chapters(volume_id);
		INSERT INTO volumes VALUES ('v', 's', NULL, 'volume');
		INSERT INTO chapters VALUES ('c', 'v', NULL, 42, 0, 0);
	`)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"idx_volumes_series_metrics", "idx_chapters_volume_metrics"} {
		if objectExists(t, "index", name) {
			t.Fatalf("index %s already exists before migration", name)
		}
	}

	for run := 1; run <= 2; run++ {
		if err := migrateSeriesMetricsIndexes(); err != nil {
			t.Fatalf("migration run %d: %v", run, err)
		}
		for _, name := range []string{"idx_volumes_series", "idx_chapters_volume", "idx_volumes_series_metrics", "idx_chapters_volume_metrics"} {
			if !objectExists(t, "index", name) {
				t.Errorf("index %s missing after run %d", name, run)
			}
		}
		var pages int
		err := DB.QueryRow(`SELECT c.page_count FROM chapters c JOIN volumes v ON v.id = c.volume_id WHERE v.series_id = 's'`).Scan(&pages)
		if err != nil || pages != 42 {
			t.Fatalf("chapter pages after run %d = %d, err = %v", run, pages, err)
		}
	}
}
