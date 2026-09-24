package database

import "fmt"

// migrateThumbnailVersions supplies a DB-only cache key without repurposing
// updated_at, which the scanner also uses as the source file's modification time.
func migrateThumbnailVersions() error {
	for _, table := range []string{"series", "volumes"} {
		if err := addColumn(table, "thumbnail_version", "INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
		// Metadata-only updates may include thumbnail_path in SET. Bump only on
		// actual path changes; official same-path replacements bump explicitly.
		if _, err := DB.Exec(fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS %s_thumbnail_version
   AFTER UPDATE OF thumbnail_path ON %s
   WHEN OLD.thumbnail_path IS NOT NEW.thumbnail_path
   BEGIN
    UPDATE %s SET thumbnail_version=OLD.thumbnail_version+1 WHERE id=NEW.id;
   END`, table, table, table)); err != nil {
			return err
		}
	}
	return nil
}
