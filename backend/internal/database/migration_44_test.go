package database

import (
	"testing"
)

func TestMigrateEpubLineHeightToScale(t *testing.T) {
	openRawTestDB(t)

	// Create user_settings and server_settings tables
	if _, err := DB.Exec(`
		CREATE TABLE user_settings (
			user_id TEXT NOT NULL,
			key TEXT NOT NULL,
			value TEXT NOT NULL,
			PRIMARY KEY (user_id, key)
		)
	`); err != nil {
		t.Fatalf("create user_settings error = %v", err)
	}

	if _, err := DB.Exec(`
		CREATE TABLE server_settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL
		)
	`); err != nil {
		t.Fatalf("create server_settings error = %v", err)
	}

	// Insert test data
	// user_settings legacy values (> 1.25 ~ 2.0) and new scale values (0.75 ~ 1.25)
	testData := []struct {
		userID string
		key    string
		val    string
	}{
		{"user1", "epub_line_height", "1.6"},        // legacy default -> should become 1.0
		{"user1", "epub_line_height_mobile", "1.1"}, // already scale mobile -> should stay 1.1
		{"user2", "epub_line_height", "1.2"},        // already scale -> should stay 1.2
		{"user2", "epub_line_height_mobile", "1.1"}, // already scale mobile -> should stay 1.1
		{"user3", "epub_line_height", "2.0"},        // legacy max -> should become 1.25
		{"user4", "epub_line_height", "1.0"},        // already scale -> should stay 1.0
		{"user4", "epub_font_size", "100"},          // non-target key -> should stay 100
		{"user5", "epub_line_height_mobile", "1.6"}, // legacy mobile -> should become 1.0
		{"user6", "epub_line_height", "1.3"},        // legacy value just above 1.25 -> should become 0.81
	}

	for _, d := range testData {
		if _, err := DB.Exec(`INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)`, d.userID, d.key, d.val); err != nil {
			t.Fatalf("insert user_settings error = %v", err)
		}
	}

	// server_settings data
	if _, err := DB.Exec(`INSERT INTO server_settings (key, value) VALUES ('epub_line_height', '1.6')`); err != nil {
		t.Fatalf("insert server_settings error = %v", err)
	}

	// Run migration
	if err := migrateEpubLineHeightToScale(); err != nil {
		t.Fatalf("migrateEpubLineHeightToScale() error = %v", err)
	}

	// Verify user_settings
	var val1, val2, val3, val3mobile, val4, val5, val5mobile, val6 string
	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user1' AND key = 'epub_line_height'`).Scan(&val1); err != nil {
		t.Fatalf("query val1 error = %v", err)
	}
	if val1 != "1.0" {
		t.Errorf("user1 epub_line_height = %s, want 1.0", val1)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user1' AND key = 'epub_line_height_mobile'`).Scan(&val2); err != nil {
		t.Fatalf("query val2 error = %v", err)
	}
	if val2 != "1.1" {
		t.Errorf("user1 epub_line_height_mobile = %s, want 1.1", val2)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user2' AND key = 'epub_line_height'`).Scan(&val3); err != nil {
		t.Fatalf("query val3 error = %v", err)
	}
	if val3 != "1.2" {
		t.Errorf("user2 epub_line_height = %s, want 1.2 (no change)", val3)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user2' AND key = 'epub_line_height_mobile'`).Scan(&val3mobile); err != nil {
		t.Fatalf("query val3mobile error = %v", err)
	}
	if val3mobile != "1.1" {
		t.Errorf("user2 epub_line_height_mobile = %s, want 1.1", val3mobile)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user3' AND key = 'epub_line_height'`).Scan(&val4); err != nil {
		t.Fatalf("query val4 error = %v", err)
	}
	if val4 != "1.25" {
		t.Errorf("user3 epub_line_height = %s, want 1.25", val4)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user4' AND key = 'epub_line_height'`).Scan(&val5); err != nil {
		t.Fatalf("query val5 error = %v", err)
	}
	if val5 != "1.0" {
		t.Errorf("user4 epub_line_height = %s, want 1.0 (no change)", val5)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user5' AND key = 'epub_line_height_mobile'`).Scan(&val5mobile); err != nil {
		t.Fatalf("query val5mobile error = %v", err)
	}
	if val5mobile != "1.0" {
		t.Errorf("user5 epub_line_height_mobile = %s, want 1.0 (converted from legacy)", val5mobile)
	}

	if err := DB.QueryRow(`SELECT value FROM user_settings WHERE user_id = 'user6' AND key = 'epub_line_height'`).Scan(&val6); err != nil {
		t.Fatalf("query val6 error = %v", err)
	}
	if val6 != "0.81" {
		t.Errorf("user6 epub_line_height = %s, want 0.81 (converted from legacy 1.3)", val6)
	}

	// Verify server_settings
	var serverVal string
	if err := DB.QueryRow(`SELECT value FROM server_settings WHERE key = 'epub_line_height'`).Scan(&serverVal); err != nil {
		t.Fatalf("query serverVal error = %v", err)
	}
	if serverVal != "1.0" {
		t.Errorf("server_settings epub_line_height = %s, want 1.0", serverVal)
	}
}
