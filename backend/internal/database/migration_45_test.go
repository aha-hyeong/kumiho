package database

import (
	"testing"
)

func TestMigrateEpubFontSeriesSettings(t *testing.T) {
	openRawTestDB(t)

	// Create users and series tables first to satisfy foreign keys
	if _, err := DB.Exec(`
		CREATE TABLE users (
			id TEXT PRIMARY KEY
		)
	`); err != nil {
		t.Fatalf("create users error = %v", err)
	}

	if _, err := DB.Exec(`
		CREATE TABLE series (
			id TEXT PRIMARY KEY
		)
	`); err != nil {
		t.Fatalf("create series error = %v", err)
	}

	// Create user_series_settings without the new epub_font_size, epub_font_family, epub_line_height columns
	if _, err := DB.Exec(`
		CREATE TABLE user_series_settings (
			user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
			series_id TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
			reading_mode TEXT,
			epub_render_mode TEXT,
			epub_theme TEXT,
			epub_flow TEXT,
			epub_spread TEXT,
			epub_wheel_direction TEXT,
			epub_keyboard_direction TEXT,
			epub_click_direction TEXT,
			PRIMARY KEY (user_id, series_id)
		)
	`); err != nil {
		t.Fatalf("create user_series_settings error = %v", err)
	}

	// Insert dummy data
	if _, err := DB.Exec(`INSERT INTO users (id) VALUES ('user-1')`); err != nil {
		t.Fatalf("insert user error = %v", err)
	}
	if _, err := DB.Exec(`INSERT INTO series (id) VALUES ('series-1')`); err != nil {
		t.Fatalf("insert series error = %v", err)
	}
	if _, err := DB.Exec(`
		INSERT INTO user_series_settings (user_id, series_id, reading_mode)
		VALUES ('user-1', 'series-1', 'vertical')
	`); err != nil {
		t.Fatalf("insert user_series_settings error = %v", err)
	}

	// Run migration
	if err := migrateEpubFontSeriesSettings(); err != nil {
		t.Fatalf("migrateEpubFontSeriesSettings() error = %v", err)
	}

	// Check if the new columns exist
	if !columnExists("user_series_settings", "epub_font_size") {
		t.Error("epub_font_size column does not exist")
	}
	if !columnExists("user_series_settings", "epub_font_family") {
		t.Error("epub_font_family column does not exist")
	}
	if !columnExists("user_series_settings", "epub_line_height") {
		t.Error("epub_line_height column does not exist")
	}

	// Verify that the existing data was preserved and new columns are NULL
	var readingMode string
	var fontSize interface{}
	var fontFamily interface{}
	var lineHeight interface{}
	err := DB.QueryRow(`
		SELECT reading_mode, epub_font_size, epub_font_family, epub_line_height
		FROM user_series_settings
		WHERE user_id = 'user-1' AND series_id = 'series-1'
	`).Scan(&readingMode, &fontSize, &fontFamily, &lineHeight)
	if err != nil {
		t.Fatalf("query user_series_settings error = %v", err)
	}

	if readingMode != "vertical" {
		t.Errorf("reading_mode = %s, want vertical", readingMode)
	}
	if fontSize != nil {
		t.Errorf("epub_font_size = %v, want nil", fontSize)
	}
	if fontFamily != nil {
		t.Errorf("epub_font_family = %v, want nil", fontFamily)
	}
	if lineHeight != nil {
		t.Errorf("epub_line_height = %v, want nil", lineHeight)
	}

	// Run migration again to verify idempotency (should not error or crash)
	if err := migrateEpubFontSeriesSettings(); err != nil {
		t.Fatalf("second migrateEpubFontSeriesSettings() error = %v", err)
	}
}
