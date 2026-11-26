package database

const seriesMetricsIndexesSQL = `
	CREATE INDEX IF NOT EXISTS idx_volumes_series_metrics ON volumes(series_id, id, parent_id, unit);
	CREATE INDEX IF NOT EXISTS idx_chapters_volume_metrics ON chapters(volume_id, id, duration, page_count, total_positions, has_audio);
`

func migrateSeriesMetricsIndexes() error {
	_, err := DB.Exec(seriesMetricsIndexesSQL)
	return err
}
