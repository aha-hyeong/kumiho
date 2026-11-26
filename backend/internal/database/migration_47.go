package database

func migrateSeriesCoverPage() error {
	if err := addColumn("series", "cover_page_id", "TEXT"); err != nil {
		return err
	}
	// Volume and chapter writes from the scanner update the series content time.
	// Invalidate in that same transaction, even if the timestamp is reused.
	_, err := DB.Exec(`
		CREATE TRIGGER IF NOT EXISTS series_invalidate_cover_page
		AFTER UPDATE OF last_content_updated_at ON series WHEN NEW.cover_page_id IS NOT NULL
		BEGIN
			UPDATE series SET cover_page_id = NULL WHERE id = NEW.id;
		END;

		CREATE TRIGGER IF NOT EXISTS first_volume_invalidate_series_thumbnail
		AFTER UPDATE OF thumbnail_version ON volumes
		WHEN OLD.thumbnail_version <> NEW.thumbnail_version AND NEW.id = (
			SELECT id FROM volumes WHERE series_id = NEW.series_id ORDER BY volume_number, id LIMIT 1
		)
		BEGIN
			UPDATE series SET thumbnail_version = thumbnail_version + 1
			WHERE id = NEW.series_id AND COALESCE(thumbnail_path, '') = '';
		END;`)
	return err
}
