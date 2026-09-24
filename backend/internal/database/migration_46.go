package database

import "fmt"

// migrateThumbnailVersions supplies a DB-only cache key without repurposing
// updated_at, which the scanner also uses as the source file's modification time.
func migrateThumbnailVersions() error {
	for _, table := range []string{"series", "volumes"} {
		if err := addColumn(table, "thumbnail_version", "INTEGER NOT NULL DEFAULT 0"); err != nil {
			return err
		}
		// Fire even when the path is unchanged: manual uploads and metadata plugins
		// overwrite cover bytes in place. The version write does not retrigger this
		// UPDATE OF thumbnail_path trigger and rolls back with the original write.
		if _, err := DB.Exec(fmt.Sprintf(`CREATE TRIGGER IF NOT EXISTS %s_thumbnail_version
   AFTER UPDATE OF thumbnail_path ON %s
   BEGIN
    UPDATE %s SET thumbnail_version=OLD.thumbnail_version+1 WHERE id=NEW.id;
   END`, table, table, table)); err != nil {
			return err
		}
	}
	return nil
}
