package scanner

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/fsnotify/fsnotify"
)

var tinyPNG = []byte{
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
	0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
	0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
	0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
	0x00, 0x03, 0x01, 0x01, 0x00, 0xc9, 0xfe, 0x92,
	0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
	0x44, 0xae, 0x42, 0x60, 0x82,
}

func writeTestZipArchive(t *testing.T, archivePath string, files map[string][]byte) {
	t.Helper()

	file, err := os.Create(archivePath)
	if err != nil {
		t.Fatalf("os.Create(%s) error = %v", archivePath, err)
	}
	defer func() { _ = file.Close() }()

	zw := zip.NewWriter(file)
	for name, data := range files {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip.Create(%s) error = %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("zip write(%s) error = %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip.Close() error = %v", err)
	}
}

type scannerTestSettingRepo struct {
	values map[string]string
}

func (r *scannerTestSettingRepo) GetByKey(_ database.Queryer, key string) (*model.Setting, error) {
	value, ok := r.values[key]
	if !ok {
		return nil, nil
	}
	return &model.Setting{Key: key, Value: value}, nil
}

func (r *scannerTestSettingRepo) GetAll(_ database.Queryer) ([]model.Setting, error) {
	return nil, nil
}

func (r *scannerTestSettingRepo) Update(_ database.Queryer, key, value string) error {
	if r.values == nil {
		r.values = make(map[string]string)
	}
	r.values[key] = value
	return nil
}

func TestIsOriginalTitleOverrideEnabledPrefersNewKeyAndFallsBackToLegacyKey(t *testing.T) {
	t.Run("new key takes precedence", func(t *testing.T) {
		repo := &scannerTestSettingRepo{
			values: map[string]string{
				"original_title_override": "false",
				"epub_title_override":     "true",
			},
		}

		if repository.IsOriginalTitleOverrideEnabled(repo) {
			t.Fatal("IsOriginalTitleOverrideEnabled() = true, want false when new key is false")
		}
	})

	t.Run("legacy key is used as fallback", func(t *testing.T) {
		repo := &scannerTestSettingRepo{
			values: map[string]string{
				"epub_title_override": "true",
			},
		}

		if !repository.IsOriginalTitleOverrideEnabled(repo) {
			t.Fatal("IsOriginalTitleOverrideEnabled() = false, want true from legacy key fallback")
		}
	})
}

func TestResolveSeriesTitleFromOriginalTitle(t *testing.T) {
	metadata := &model.SeriesMetadata{OriginalTitle: "강철의 연금술사"}

	got := ResolveSeriesTitleFromOriginalTitle("/library/Fullmetal Alchemist.epub", "Fullmetal Alchemist.epub", metadata, true, "ko")
	if got != "강철의 연금술사" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want original title", got)
	}

	got = ResolveSeriesTitleFromOriginalTitle("/library/Fullmetal Alchemist.epub", "Fullmetal Alchemist.epub", metadata, false, "ko")
	if got != "Fullmetal Alchemist" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want path title when override disabled", got)
	}

	got = ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", &model.SeriesMetadata{}, true, "ko")
	if got != "Series Folder" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want fallback path title when original title missing", got)
	}

	metadata.OriginalTitle = ""
	metadata.OriginalTitles = `{"ko":"한국어 원제","en":"English Title","ja":"日本語タイトル"}`

	got = ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "ko")
	if got != "한국어 원제" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want Korean title for ko locale", got)
	}

	got = ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "ja")
	if got != "日本語タイトル" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want Japanese title for ja locale", got)
	}

	got = ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "en")
	if got != "English Title" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want English title for en locale", got)
	}
}

func TestResolveSeriesTitleFromOriginalTitlePrefersManualOriginalTitle(t *testing.T) {
	metadata := &model.SeriesMetadata{
		OriginalTitle:  "사용자 지정 원제",
		OriginalTitles: `{"ko":"한국어 원제","en":"English Title","ja":"日本語タイトル","_manual_title":"사용자 지정 원제"}`,
	}

	got := ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "ja")
	if got != "사용자 지정 원제" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want manual original title", got)
	}
}

func TestResolveSeriesTitleFromOriginalTitleReappliesLocaleWhenOriginalTitleWasAutoResolved(t *testing.T) {
	metadata := &model.SeriesMetadata{
		OriginalTitle:  "한국어 원제",
		OriginalTitles: `{"ko":"한국어 원제","en":"English Title","ja":"日本語タイトル"}`,
	}

	got := ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "en")
	if got != "English Title" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want English title after locale switch", got)
	}
}

func TestResolveSeriesTitleFromOriginalTitleKeepsManualSelectedLocaleValue(t *testing.T) {
	metadata := &model.SeriesMetadata{
		OriginalTitle:  "한국어 원제",
		OriginalTitles: `{"ko":"한국어 원제","en":"English Title","ja":"日本語タイトル","_manual_title":"한국어 원제"}`,
	}

	got := ResolveSeriesTitleFromOriginalTitle("/library/Series Folder", "Series Folder", metadata, true, "ja")
	if got != "한국어 원제" {
		t.Fatalf("ResolveSeriesTitleFromOriginalTitle() = %q, want manually selected Korean title", got)
	}
}

func TestParseVolumeNumberPrefersExplicitMarkersOverKoreanSeriesSuffix(t *testing.T) {
	t.Run("explicit chapter marker wins over earlier korean part suffix", func(t *testing.T) {
		gotNum, gotUnit, ok := parseVolumeNumber("열렙전사 1부 - c001")
		if !ok {
			t.Fatal("parseVolumeNumber() = not matched, want explicit chapter match")
		}
		if gotNum != 1 || gotUnit != "chapter" {
			t.Fatalf("parseVolumeNumber() = (%d, %q), want (1, %q)", gotNum, gotUnit, "chapter")
		}
	})

	t.Run("explicit volume marker still wins when both volume and chapter markers exist", func(t *testing.T) {
		gotNum, gotUnit, ok := parseVolumeNumber("둥굴레차! - v029 c001_시즌1 후기")
		if !ok {
			t.Fatal("parseVolumeNumber() = not matched, want explicit volume match")
		}
		if gotNum != 29 || gotUnit != "volume" {
			t.Fatalf("parseVolumeNumber() = (%d, %q), want (29, %q)", gotNum, gotUnit, "volume")
		}
	})
}

func TestParseVolumeNumberPrologueAndExistingPatterns(t *testing.T) {
	for _, tt := range []struct {
		name   string
		number int
		unit   string
		ok     bool
	}{
		{"프롤로그.cbz", 0, "volume", true},
		{"2부 프롤로그.cbz", 0, "volume", true},
		{"Prologue.cbz", 0, "volume", true},
		{"0000화 프롤로그.cbz", 0, "chapter", true},
		{"0170화 2부 프롤로그.cbz", 170, "chapter", true},
		{"0220화 3부 프롤로그.cbz", 220, "chapter", true},
		{"2부 0170회 PROLOGUE.cbz", 170, "chapter", true},
		{"0170화.cbz", 170, "chapter", true},
		{"12회.cbz", 12, "chapter", true},
		{"03권.cbz", 3, "volume", true},
		{"2부.cbz", 2, "volume", true},
		{"열렙전사 1부 - c001.cbz", 1, "chapter", true},
		{"둥굴레차! - v029 c001_시즌1 후기.cbz", 29, "volume", true},
		{"Volume 3.cbz", 3, "volume", true},
		{"Chapter 12.cbz", 12, "chapter", true},
		{"시리즈 - 005.cbz", 5, "volume", true},
		{"v003 prologue.cbz", 0, "volume", true},
		{"c003 prologue.cbz", 0, "volume", true},
		{"제목.cbz", 0, "volume", false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			name := strings.TrimSuffix(tt.name, filepath.Ext(tt.name))
			number, unit, ok := parseVolumeNumber(name)
			if number != tt.number || unit != tt.unit || ok != tt.ok {
				t.Errorf("parseVolumeNumber(%q) = (%d, %q, %t), want (%d, %q, %t)", name, number, unit, ok, tt.number, tt.unit, tt.ok)
			}
		})
	}
}

func newPrologueScanTest(t *testing.T) (*Scanner, *model.Library, *model.Series) {
	t.Helper()
	if err := database.Connect(filepath.Join(t.TempDir(), "scan.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	library := &model.Library{Name: "Prologue regression", Paths: []string{t.TempDir()}, LibraryType: "book"}
	s := NewScanner(repository.NewLibraryRepository(), repository.NewSeriesRepository(), repository.NewVolumeRepository(), repository.NewChapterRepository(), repository.NewPageRepository(), repository.NewSettingRepository(), &config.Config{DataDir: t.TempDir()})
	if err := s.libraryRepo.Create(nil, library); err != nil {
		t.Fatal(err)
	}
	series := &model.Series{LibraryID: library.ID, Title: "Series", Path: filepath.Join(library.Paths[0], "Series")}
	if err := os.MkdirAll(series.Path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := s.seriesRepo.Create(nil, series); err != nil {
		t.Fatal(err)
	}
	return s, library, series
}

func TestScanSeriesPrologueNaturalOrder(t *testing.T) {
	for _, tt := range []struct {
		name    string
		titles  []string
		numbers []int
	}{
		{"natural", []string{"1화", "2화", "10화"}, []int{1, 2, 10}},
		{"standalone prologue", []string{"프롤로그", "1화", "2화", "10화"}, []int{0, 1, 2, 10}},
		{"middle prologues", []string{"169화", "0170화 2부 프롤로그", "171화", "219화", "0220화 3부 프롤로그", "221화"}, []int{169, 170, 171, 219, 220, 221}},
		// Keep the existing Monotonic Assignment: duplicate 170 advances to 171,
		// then the following 171 advances to 172. Titles retain the source episode.
		{"duplicate", []string{"169화", "170화", "170화 2부 프롤로그", "171화"}, []int{169, 170, 171, 172}},
	} {
		for _, format := range []string{"cbz", "folder", "mixed"} {
			t.Run(tt.name+"/"+format, func(t *testing.T) {
				s, library, series := newPrologueScanTest(t)
				for i, title := range tt.titles {
					path := filepath.Join(series.Path, title)
					if format == "folder" || format == "mixed" && i%2 == 0 {
						if err := os.MkdirAll(path, 0o755); err != nil {
							t.Fatal(err)
						}
						if err := os.WriteFile(filepath.Join(path, "001.png"), tinyPNG, 0o644); err != nil {
							t.Fatal(err)
						}
					} else {
						writeTestZipArchive(t, path+".cbz", map[string][]byte{"001.png": tinyPNG})
					}
				}
				for scan := 0; scan < 2; scan++ {
					var result *ScanResult
					var err error
					if format == "cbz" {
						result, err = s.ScanLibrary(context.Background(), library)
					} else {
						result, err = s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 4}, "book")
					}
					if err != nil || len(result.Errors) != 0 {
						t.Fatalf("scan: result=%+v, err=%v", result, err)
					}
					// These are the repository queries used by ListVolumes and the viewer.
					for _, query := range []func(database.Queryer, string) ([]model.Volume, error){s.volumeRepo.FindBySeriesID, s.volumeRepo.FindRootVolumesBySeriesID} {
						volumes, queryErr := query(nil, series.ID)
						if queryErr != nil {
							t.Fatal(queryErr)
						}
						var titles []string
						var numbers []int
						for _, v := range volumes {
							titles = append(titles, v.Title)
							numbers = append(numbers, v.VolumeNumber)
						}
						if !slices.Equal(titles, tt.titles) || !slices.Equal(numbers, tt.numbers) {
							t.Errorf("scan %d: titles=%v numbers=%v, want %v %v", scan, titles, numbers, tt.titles, tt.numbers)
						}
					}
					chapters, err := s.chapterRepo.FindBySeriesID(nil, series.ID)
					if err != nil {
						t.Fatal(err)
					}
					var titles []string
					for _, c := range chapters {
						titles = append(titles, c.Title)
					}
					if !slices.Equal(titles, tt.titles) {
						t.Errorf("chapter order=%v, want %v", titles, tt.titles)
					}
				}
			})
		}
	}
}

func prologueReadingSnapshot(t *testing.T) map[string]string {
	t.Helper()
	snapshot := make(map[string]string)
	for _, table := range []string{"reading_progress", "volume_completions", "chapter_completions", "bookmarks", "user_bookmarks", "pages"} {
		rows, err := database.DB.Query("SELECT * FROM " + table + " ORDER BY 1")
		if err != nil {
			t.Fatal(err)
		}
		columns, err := rows.Columns()
		if err != nil {
			_ = rows.Close()
			t.Fatal(err)
		}
		var records [][]any
		for rows.Next() {
			values := make([]any, len(columns))
			pointers := make([]any, len(columns))
			for i := range values {
				pointers[i] = &values[i]
			}
			if scanErr := rows.Scan(pointers...); scanErr != nil {
				_ = rows.Close()
				t.Fatal(scanErr)
			}
			records = append(records, values)
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			_ = rows.Close()
			t.Fatal(rowsErr)
		}
		_ = rows.Close()
		data, err := json.Marshal(records)
		if err != nil {
			t.Fatal(err)
		}
		snapshot[table] = string(data)
	}
	return snapshot
}

func seedPrologueReadingData(t *testing.T, volume *model.Volume, chapter model.Chapter) {
	t.Helper()
	for _, seed := range []struct {
		query string
		args  []any
	}{
		{`INSERT INTO users (id, username, nickname, password_hash) VALUES ('reader', 'reader', 'Fixture reader', 'not-a-login-hash')`, nil},
		{`INSERT INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, read_time_seconds, anchor_page, offset_ratio, device_id) VALUES ('progress', 'reader', ?, ?, ?, 1, 2, 50, 37, 1, 0.25, 'fixture-device')`, []any{volume.SeriesID, volume.ID, chapter.ID}},
		{`INSERT INTO volume_completions (id, user_id, volume_id) VALUES ('volume-completion', 'reader', ?)`, []any{volume.ID}},
		{`INSERT INTO chapter_completions (id, user_id, chapter_id) VALUES ('chapter-completion', 'reader', ?)`, []any{chapter.ID}},
		{`INSERT INTO bookmarks (id, user_id, series_id, volume_id, chapter_id, title, description, page_number) VALUES ('bookmark', 'reader', ?, ?, ?, 'Saved position', 'Keep this note', 1)`, []any{volume.SeriesID, volume.ID, chapter.ID}},
		{`INSERT INTO user_bookmarks (user_id, series_id) VALUES ('reader', ?)`, []any{volume.SeriesID}},
	} {
		if _, err := database.DB.Exec(seed.query, seed.args...); err != nil {
			t.Fatal(err)
		}
	}
}

func TestScanPrologueMetadataPreservesReadingData(t *testing.T) {
	for _, tt := range []struct {
		title  string
		number int
	}{
		{"0170화 2부 프롤로그", 170},
		{"0220화 3부 프롤로그", 220},
		{"0000화 프롤로그", 0},
		{"0170화", 170},
	} {
		for _, format := range []string{"cbz", "folder"} {
			t.Run(tt.title+"/"+format, func(t *testing.T) {
				s, library, series := newPrologueScanTest(t)
				path := filepath.Join(series.Path, tt.title)
				var data *scannedVolume
				var err error
				if format == "cbz" {
					path += ".cbz"
					writeTestZipArchive(t, path, map[string][]byte{"001.png": tinyPNG, "002.png": tinyPNG})
					data, err = s.analyzeArchiveAsVolume(path, "프롤로그", 0, "volume")
				} else {
					if mkdirErr := os.MkdirAll(path, 0o755); mkdirErr != nil {
						t.Fatal(mkdirErr)
					}
					for _, page := range []string{"001.png", "002.png"} {
						if writeErr := os.WriteFile(filepath.Join(path, page), tinyPNG, 0o644); writeErr != nil {
							t.Fatal(writeErr)
						}
					}
					data, err = s.analyzeVolumeRecursive(path, "프롤로그", 0, "volume", nil, "book")
				}
				if err != nil {
					t.Fatal(err)
				}
				data.Description, data.Authors, data.PublicationYear = "Keep description", "Keep author", "2025"
				if _, saveErr := s.saveVolumeRecursive(database.DB, series.ID, nil, data); saveErr != nil {
					t.Fatal(saveErr)
				}
				before, err := s.volumeRepo.FindByPath(nil, path)
				if err != nil || before == nil {
					t.Fatalf("legacy volume: %+v, %v", before, err)
				}
				chapters, err := s.chapterRepo.FindByVolumeID(nil, before.ID)
				if err != nil || len(chapters) != 1 {
					t.Fatalf("legacy chapters: %+v, %v", chapters, err)
				}
				seedPrologueReadingData(t, before, chapters[0])
				readingBefore := prologueReadingSnapshot(t)
				seriesBefore, err := s.seriesRepo.FindByID(nil, series.ID, "")
				if err != nil {
					t.Fatal(err)
				}
				for scan := 0; scan < 2; scan++ {
					var result *ScanResult
					if format == "cbz" {
						result, err = s.ScanLibrary(context.Background(), library)
					} else {
						result, err = s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
					}
					if err != nil || len(result.Errors) != 0 {
						t.Fatalf("scan %d: %+v, %v", scan, result, err)
					}
					after, err := s.volumeRepo.FindByPath(nil, path)
					if err != nil || after == nil {
						t.Fatalf("updated volume: %+v, %v", after, err)
					}
					if after.ID != before.ID {
						t.Errorf("volume ID=%s, want %s", after.ID, before.ID)
					}
					if after.VolumeNumber != tt.number || after.Unit != "chapter" || after.Title != tt.title {
						t.Errorf("metadata=(%d, %q, %q), want (%d, chapter, %q)", after.VolumeNumber, after.Unit, after.Title, tt.number, tt.title)
					}
					if after.Description != before.Description || after.Authors != before.Authors || after.PublicationYear != before.PublicationYear || after.Extension != before.Extension || !after.UpdatedAt.Equal(before.UpdatedAt) || !after.CreatedAt.Equal(before.CreatedAt) {
						t.Error("existing volume metadata or content timestamps changed")
					}
					afterChapters, err := s.chapterRepo.FindByVolumeID(nil, after.ID)
					if err != nil || len(afterChapters) != 1 {
						t.Fatalf("updated chapters: %+v, %v", afterChapters, err)
					}
					if afterChapters[0].ID != chapters[0].ID || afterChapters[0].Title != tt.title || !afterChapters[0].UpdatedAt.Equal(chapters[0].UpdatedAt) {
						t.Errorf("chapter ID/title/timestamp not preserved and updated: %+v", afterChapters[0])
					}
					readingAfter := prologueReadingSnapshot(t)
					for table, before := range readingBefore {
						if after := readingAfter[table]; after != before {
							t.Errorf("%s changed: %s -> %s", table, before, after)
						}
					}
					seriesAfter, err := s.seriesRepo.FindByID(nil, series.ID, "")
					if err != nil {
						t.Fatal(err)
					}
					if !seriesAfter.UpdatedAt.Equal(seriesBefore.UpdatedAt) || !seriesAfter.LastContentUpdatedAt.Equal(seriesBefore.LastContentUpdatedAt) {
						t.Error("metadata-only rescan bumped series content timestamps")
					}
				}
			})
		}
	}
}

func TestScanLibraryPrologueContentChangesStillRecreate(t *testing.T) {
	for _, change := range []string{"newer mtime same layout", "same page count", "added page", "zero page repair"} {
		t.Run(change, func(t *testing.T) {
			s, library, series := newPrologueScanTest(t)
			path := filepath.Join(series.Path, "0170화 2부 프롤로그.cbz")
			writeTestZipArchive(t, path, map[string][]byte{"001.png": tinyPNG, "002.png": tinyPNG})
			// Seed the old parser result, so a content change and a number change coincide.
			data, err := s.analyzeArchiveAsVolume(path, "프롤로그", 0, "volume")
			if err != nil {
				t.Fatal(err)
			}
			if _, saveErr := s.saveVolumeRecursive(database.DB, series.ID, nil, data); saveErr != nil {
				t.Fatal(saveErr)
			}
			before, err := s.volumeRepo.FindByPath(nil, path)
			if err != nil || before == nil {
				t.Fatalf("volume: %+v, %v", before, err)
			}
			chapters, err := s.chapterRepo.FindByVolumeID(nil, before.ID)
			if err != nil || len(chapters) != 1 {
				t.Fatalf("chapters: %+v, %v", chapters, err)
			}
			seedPrologueReadingData(t, before, chapters[0])
			switch change {
			case "same page count":
				writeTestZipArchive(t, path, map[string][]byte{"001.png": tinyPNG, "003.png": tinyPNG})
			case "added page":
				writeTestZipArchive(t, path, map[string][]byte{"001.png": tinyPNG, "002.png": tinyPNG, "003.png": tinyPNG})
			case "zero page repair":
				if _, updateErr := database.DB.Exec(`UPDATE chapters SET page_count = 0 WHERE id = ?`, chapters[0].ID); updateErr != nil {
					t.Fatal(updateErr)
				}
			}
			if change != "zero page repair" {
				newTime := before.UpdatedAt.Add(time.Hour)
				if timeErr := os.Chtimes(path, newTime, newTime); timeErr != nil {
					t.Fatal(timeErr)
				}
			}
			result, err := s.ScanLibrary(context.Background(), library)
			if err != nil || len(result.Errors) != 0 {
				t.Fatalf("scan: %+v, %v", result, err)
			}
			after, err := s.volumeRepo.FindByPath(nil, path)
			if err != nil || after == nil {
				t.Fatalf("volume: %+v, %v", after, err)
			}
			if after.ID == before.ID {
				t.Error("content change kept old volume ID")
			}
			afterChapters, err := s.chapterRepo.FindByVolumeID(nil, after.ID)
			if err != nil || len(afterChapters) != 1 {
				t.Fatalf("chapters: %+v, %v", afterChapters, err)
			}
			if afterChapters[0].ID == chapters[0].ID {
				t.Error("content change kept old chapter ID")
			}
			wantPages := 2
			if change == "added page" {
				wantPages = 3
			}
			if afterChapters[0].PageCount != wantPages {
				t.Errorf("page count=%d, want %d", afterChapters[0].PageCount, wantPages)
			}
			for table, rows := range prologueReadingSnapshot(t) {
				if table != "pages" && table != "user_bookmarks" && rows != "null" {
					t.Errorf("%s no longer cascades on content replacement", table)
				}
			}
		})
	}
}

func TestScanPrologueMetadataUpdateFailurePreservesReadingData(t *testing.T) {
	for _, table := range []string{"volumes", "chapters"} {
		t.Run(table, func(t *testing.T) {
			s, library, series := newPrologueScanTest(t)
			path := filepath.Join(series.Path, "0170화 2부 프롤로그.cbz")
			writeTestZipArchive(t, path, map[string][]byte{"001.png": tinyPNG, "002.png": tinyPNG})
			data, err := s.analyzeArchiveAsVolume(path, "프롤로그", 0, "volume")
			if err != nil {
				t.Fatal(err)
			}
			if _, saveErr := s.saveVolumeRecursive(database.DB, series.ID, nil, data); saveErr != nil {
				t.Fatal(saveErr)
			}
			before, err := s.volumeRepo.FindByPath(nil, path)
			if err != nil || before == nil {
				t.Fatalf("volume: %+v, %v", before, err)
			}
			chapters, err := s.chapterRepo.FindByVolumeID(nil, before.ID)
			if err != nil || len(chapters) != 1 {
				t.Fatalf("chapters: %+v, %v", chapters, err)
			}
			seedPrologueReadingData(t, before, chapters[0])
			snapshot := prologueReadingSnapshot(t)
			if _, triggerErr := database.DB.Exec("CREATE TRIGGER reject_metadata BEFORE UPDATE ON " + table + " BEGIN SELECT RAISE(ABORT, 'fixture blocked'); END"); triggerErr != nil {
				t.Fatal(triggerErr)
			}
			result, err := s.ScanLibrary(context.Background(), library)
			if err != nil || len(result.Errors) == 0 {
				t.Fatalf("want reported UPDATE failure, got %+v, %v", result, err)
			}
			after, err := s.volumeRepo.FindByPath(nil, path)
			if err != nil || after == nil {
				t.Fatalf("volume: %+v, %v", after, err)
			}
			if after.ID != before.ID || after.Title != before.Title || after.VolumeNumber != before.VolumeNumber || after.Unit != before.Unit {
				t.Error("failed metadata transaction changed/replaced volume")
			}
			afterChapters, err := s.chapterRepo.FindByVolumeID(nil, before.ID)
			if err != nil || len(afterChapters) != 1 || afterChapters[0].ID != chapters[0].ID || afterChapters[0].Title != chapters[0].Title {
				t.Fatalf("failed transaction changed chapter: %+v, %v", afterChapters, err)
			}
			for table, after := range prologueReadingSnapshot(t) {
				if after != snapshot[table] {
					t.Errorf("%s changed after failed UPDATE", table)
				}
			}
		})
	}
}

func TestScanNestedArchiveChaptersUseNaturalTitleOrder(t *testing.T) {
	for _, relativePath := range []string{"1권", filepath.Join("1권", "Season 1")} {
		t.Run(relativePath, func(t *testing.T) {
			s, _, series := newPrologueScanTest(t)
			folder := filepath.Join(series.Path, relativePath)
			if mkdirErr := os.MkdirAll(folder, 0o755); mkdirErr != nil {
				t.Fatal(mkdirErr)
			}
			want := []string{"170화", "170화 2부 프롤로그", "171화"}
			for _, title := range want {
				writeTestZipArchive(t, filepath.Join(folder, title+".cbz"), map[string][]byte{"001.png": tinyPNG})
			}
			result, scanErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
			if scanErr != nil || len(result.Errors) != 0 {
				t.Fatalf("scan: %+v, %v", result, scanErr)
			}
			chapters, queryErr := s.chapterRepo.FindBySeriesID(nil, series.ID)
			if queryErr != nil {
				t.Fatal(queryErr)
			}
			var titles []string
			var numbers []int
			for _, chapter := range chapters {
				titles = append(titles, chapter.Title)
				numbers = append(numbers, chapter.ChapterNumber)
			}
			if !slices.Equal(titles, want) || !slices.Equal(numbers, []int{1, 2, 3}) {
				t.Fatalf("viewer chapter order=%v %v, want %v [1 2 3]", titles, numbers, want)
			}
		})
	}
}

func TestScanDottedVolumeFolderKeepsLegacyTitleAndNumber(t *testing.T) {
	for _, tt := range []struct {
		folder string
		title  string
		number int
	}{
		{"1권.특별편", "1권", 1},
		{"2부.프롤로그", "2부", 2},
	} {
		t.Run(tt.folder, func(t *testing.T) {
			s, _, series := newPrologueScanTest(t)
			folder := filepath.Join(series.Path, tt.folder)
			if mkdirErr := os.MkdirAll(folder, 0o755); mkdirErr != nil {
				t.Fatal(mkdirErr)
			}
			writeTestZipArchive(t, filepath.Join(folder, "1화.cbz"), map[string][]byte{"001.png": tinyPNG})
			result, scanErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 1}, "book")
			if scanErr != nil || len(result.Errors) != 0 {
				t.Fatalf("scan: %+v, %v", result, scanErr)
			}
			volumes, queryErr := s.volumeRepo.FindBySeriesID(nil, series.ID)
			if queryErr != nil || len(volumes) != 1 {
				t.Fatalf("volumes=%+v, err=%v", volumes, queryErr)
			}
			if volumes[0].Title != tt.title || volumes[0].VolumeNumber != tt.number || volumes[0].Unit != "volume" {
				t.Errorf("folder metadata=(%q, %d, %q), want (%q, %d, volume)", volumes[0].Title, volumes[0].VolumeNumber, volumes[0].Unit, tt.title, tt.number)
			}
		})
	}
}

func seedLegacyNestedPrologue(t *testing.T, format string, deep bool) (*Scanner, *model.Series, *model.Volume, []model.Chapter) {
	t.Helper()
	s, _, series := newPrologueScanTest(t)
	root := filepath.Join(series.Path, "1권")
	folder := root
	if deep {
		folder = filepath.Join(root, "Season 1")
	}
	if mkdirErr := os.MkdirAll(folder, 0o755); mkdirErr != nil {
		t.Fatal(mkdirErr)
	}
	titles := []string{"170화", "170화 2부 프롤로그", "171화"}
	if format == "folder" {
		titles = []string{"169화", "0170화 2부 프롤로그", "171화"}
	}
	for _, title := range titles {
		path := filepath.Join(folder, title)
		if format == "cbz" {
			writeTestZipArchive(t, path+".cbz", map[string][]byte{"001.png": tinyPNG, "002.png": tinyPNG})
		} else {
			if mkdirErr := os.MkdirAll(path, 0o755); mkdirErr != nil {
				t.Fatal(mkdirErr)
			}
			for _, page := range []string{"001.png", "002.png"} {
				if writeErr := os.WriteFile(filepath.Join(path, page), tinyPNG, 0o644); writeErr != nil {
					t.Fatal(writeErr)
				}
			}
		}
	}
	data, analyzeErr := s.analyzeVolumeRecursive(root, "1권", 1, "volume", nil, "book")
	if analyzeErr != nil {
		t.Fatal(analyzeErr)
	}
	leaf := data
	if deep {
		if len(data.SubVolumes) != 1 {
			t.Fatalf("subvolumes=%d, want 1", len(data.SubVolumes))
		}
		leaf = data.SubVolumes[0]
	}
	for i := range leaf.Chapters {
		chapter := &leaf.Chapters[i]
		if rePrologue.MatchString(chapter.Title) {
			chapter.Title = "프롤로그"
			chapter.ChapterNumber = 0
			if format == "cbz" {
				chapter.ChapterNumber = 1
			}
		} else if format == "cbz" && chapter.Title == "170화" {
			chapter.ChapterNumber = 2
		}
	}
	if _, saveErr := s.saveVolumeRecursive(database.DB, series.ID, nil, data); saveErr != nil {
		t.Fatal(saveErr)
	}
	volume, volumeErr := s.volumeRepo.FindByPath(nil, folder)
	if volumeErr != nil || volume == nil {
		t.Fatalf("volume=%+v, err=%v", volume, volumeErr)
	}
	chapters, chapterErr := s.chapterRepo.FindByVolumeID(nil, volume.ID)
	if chapterErr != nil || len(chapters) != 3 {
		t.Fatalf("chapters=%+v, err=%v", chapters, chapterErr)
	}
	// The legacy prologue is first (0 for image folders, 1 for archive chapters).
	seedPrologueReadingData(t, volume, chapters[0])
	return s, series, volume, chapters
}

func TestNestedPrologueMetadataRescanPreservesHistory(t *testing.T) {
	for _, format := range []string{"folder", "cbz"} {
		for _, deep := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/season=%t", format, deep), func(t *testing.T) {
				s, series, volume, beforeChapters := seedLegacyNestedPrologue(t, format, deep)
				beforeVolumes, volumeErr := s.volumeRepo.FindBySeriesID(nil, series.ID)
				if volumeErr != nil {
					t.Fatal(volumeErr)
				}
				beforeSeries, seriesErr := s.seriesRepo.FindByID(nil, series.ID, "")
				if seriesErr != nil {
					t.Fatal(seriesErr)
				}
				beforeReading := prologueReadingSnapshot(t)
				wantTitles := []string{"170화", "170화 2부 프롤로그", "171화"}
				wantNumbers := []int{1, 2, 3}
				if format == "folder" {
					wantTitles = []string{"169화", "0170화 2부 프롤로그", "171화"}
					wantNumbers = []int{169, 170, 171}
				}
				for scan := 0; scan < 2; scan++ {
					result, scanErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
					if scanErr != nil || len(result.Errors) != 0 {
						t.Fatalf("scan: %+v, %v", result, scanErr)
					}
					chapters, chapterErr := s.chapterRepo.FindByVolumeID(nil, volume.ID)
					if chapterErr != nil || len(chapters) != len(beforeChapters) {
						t.Fatalf("chapters=%+v, err=%v", chapters, chapterErr)
					}
					for i, chapter := range chapters {
						if chapter.Title != wantTitles[i] || chapter.ChapterNumber != wantNumbers[i] {
							t.Errorf("scan %d chapter %d=(%q, %d), want (%q, %d)", scan, i, chapter.Title, chapter.ChapterNumber, wantTitles[i], wantNumbers[i])
						}
						var old *model.Chapter
						for j := range beforeChapters {
							if beforeChapters[j].ID == chapter.ID {
								old = &beforeChapters[j]
							}
						}
						if old == nil {
							t.Fatalf("chapter ID replaced: %s", chapter.ID)
						}
						chapter.Title, chapter.ChapterNumber = old.Title, old.ChapterNumber
						if !reflect.DeepEqual(chapter, *old) {
							t.Error("non-metadata chapter fields changed")
						}
					}
					afterVolumes, queryErr := s.volumeRepo.FindBySeriesID(nil, series.ID)
					if queryErr != nil || !reflect.DeepEqual(afterVolumes, beforeVolumes) {
						t.Fatalf("volume tree changed: %+v, %v", afterVolumes, queryErr)
					}
					if !reflect.DeepEqual(prologueReadingSnapshot(t), beforeReading) {
						t.Error("progress/completions/bookmarks/pages changed")
					}
					afterSeries, querySeriesErr := s.seriesRepo.FindByID(nil, series.ID, "")
					if querySeriesErr != nil || !afterSeries.UpdatedAt.Equal(beforeSeries.UpdatedAt) || !afterSeries.LastContentUpdatedAt.Equal(beforeSeries.LastContentUpdatedAt) {
						t.Fatalf("series content timestamps changed: %v", querySeriesErr)
					}
				}
			})
		}
	}
}

func TestNestedMetadataUpdateFailureRollsBackWholeTree(t *testing.T) {
	s, series, _, _ := seedLegacyNestedPrologue(t, "cbz", true)
	// Require a root volume correction as well as multiple child chapter corrections.
	if _, updateErr := database.DB.Exec(`UPDATE volumes SET title = 'legacy root', volume_number = 99 WHERE parent_id IS NULL AND series_id = ?`, series.ID); updateErr != nil {
		t.Fatal(updateErr)
	}
	beforeVolumes, volumeErr := s.volumeRepo.FindBySeriesID(nil, series.ID)
	if volumeErr != nil {
		t.Fatal(volumeErr)
	}
	beforeChapters, chapterErr := s.chapterRepo.FindBySeriesID(nil, series.ID)
	if chapterErr != nil {
		t.Fatal(chapterErr)
	}
	beforeReading := prologueReadingSnapshot(t)
	// The ordinary chapter is updated first; reject the following prologue update.
	if _, triggerErr := database.DB.Exec(`CREATE TRIGGER reject_nested_metadata BEFORE UPDATE ON chapters WHEN OLD.title = '프롤로그' BEGIN SELECT RAISE(ABORT, 'fixture blocked'); END`); triggerErr != nil {
		t.Fatal(triggerErr)
	}
	result, scanErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
	if scanErr != nil || len(result.Errors) == 0 {
		t.Fatalf("want metadata failure: %+v, %v", result, scanErr)
	}
	afterVolumes, queryVolumeErr := s.volumeRepo.FindBySeriesID(nil, series.ID)
	if queryVolumeErr != nil || !reflect.DeepEqual(afterVolumes, beforeVolumes) {
		t.Fatalf("failed transaction changed/replaced volume tree: %+v, %v", afterVolumes, queryVolumeErr)
	}
	afterChapters, queryChapterErr := s.chapterRepo.FindBySeriesID(nil, series.ID)
	if queryChapterErr != nil || !reflect.DeepEqual(afterChapters, beforeChapters) {
		t.Fatalf("failed transaction changed/replaced chapters: %+v, %v", afterChapters, queryChapterErr)
	}
	if !reflect.DeepEqual(prologueReadingSnapshot(t), beforeReading) {
		t.Error("failed transaction changed progress/completions/bookmarks/pages")
	}
	if _, dropErr := database.DB.Exec(`DROP TRIGGER reject_nested_metadata`); dropErr != nil {
		t.Fatal(dropErr)
	}
	retry, retryErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
	if retryErr != nil || len(retry.Errors) != 0 {
		t.Fatalf("metadata retry: %+v, %v", retry, retryErr)
	}
	root, rootErr := s.volumeRepo.FindByPath(nil, filepath.Join(series.Path, "1권"))
	if rootErr != nil || root == nil || root.Title != "1권" || root.VolumeNumber != 1 {
		t.Fatalf("root metadata not corrected: %+v, %v", root, rootErr)
	}
	for _, old := range beforeVolumes {
		preserved, preservedErr := s.volumeRepo.FindByID(nil, old.ID)
		if preservedErr != nil || preserved == nil {
			t.Fatalf("metadata retry replaced volume %s: %v", old.ID, preservedErr)
		}
	}
	if !reflect.DeepEqual(prologueReadingSnapshot(t), beforeReading) {
		t.Error("metadata retry changed progress/completions/bookmarks/pages")
	}
}

func TestNestedContentChangesStillRecreate(t *testing.T) {
	for _, format := range []string{"folder", "cbz"} {
		for _, deep := range []bool{false, true} {
			t.Run(fmt.Sprintf("%s/season=%t", format, deep), func(t *testing.T) {
				s, series, _, beforeChapters := seedLegacyNestedPrologue(t, format, deep)
				rootPath := filepath.Join(series.Path, "1권")
				root, rootErr := s.volumeRepo.FindByPath(nil, rootPath)
				if rootErr != nil || root == nil {
					t.Fatalf("root=%+v, err=%v", root, rootErr)
				}
				chapterPath := beforeChapters[0].Path
				// Replace a page name without changing page count. The existing newer-mtime
				// policy must still rebuild, rather than treating equal counts as metadata-only.
				if format == "cbz" {
					writeTestZipArchive(t, chapterPath, map[string][]byte{"001.png": tinyPNG, "003.png": tinyPNG})
				} else if renameErr := os.Rename(filepath.Join(chapterPath, "002.png"), filepath.Join(chapterPath, "003.png")); renameErr != nil {
					t.Fatal(renameErr)
				}
				newTime := root.UpdatedAt.Add(time.Hour)
				if timeErr := os.Chtimes(rootPath, newTime, newTime); timeErr != nil {
					t.Fatal(timeErr)
				}
				result, scanErr := s.scanSeriesContent(context.Background(), series, nil, nil, scanPerfConfig{VolumeConcurrent: 2}, "book")
				if scanErr != nil || len(result.Errors) != 0 {
					t.Fatalf("scan: %+v, %v", result, scanErr)
				}
				afterRoot, queryRootErr := s.volumeRepo.FindByPath(nil, rootPath)
				if queryRootErr != nil || afterRoot == nil || afterRoot.ID == root.ID {
					t.Fatalf("content replacement kept root ID: %+v, %v", afterRoot, queryRootErr)
				}
				chapters, queryChapterErr := s.chapterRepo.FindBySeriesID(nil, series.ID)
				if queryChapterErr != nil || len(chapters) != len(beforeChapters) {
					t.Fatalf("chapters=%+v, err=%v", chapters, queryChapterErr)
				}
				for _, chapter := range chapters {
					for _, old := range beforeChapters {
						if chapter.ID == old.ID {
							t.Error("content replacement kept old chapter ID")
						}
					}
					if chapter.Path == chapterPath && chapter.PageCount != 2 {
						t.Errorf("replacement page count=%d, want 2", chapter.PageCount)
					}
				}
				for table, rows := range prologueReadingSnapshot(t) {
					if table != "pages" && table != "user_bookmarks" && rows != "null" {
						t.Errorf("%s no longer cascades on content replacement", table)
					}
				}
			})
		}
	}
}

func TestNormalizeStoredSeriesTitlesUpdatesLegacyStoredTitles(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{filepath.Join(t.TempDir(), "library")},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	series := &model.Series{
		LibraryID: library.ID,
		Title:     "20th Century Boys",
		Path:      filepath.Join(library.Paths[0], "20세기 소년 완전판"),
		Metadata: &model.SeriesMetadata{
			Status:        "ONGOING",
			OriginalTitle: "20th Century Boys",
		},
	}
	if err := seriesRepo.Create(nil, series); err != nil {
		t.Fatalf("SeriesRepository.Create() error = %v", err)
	}

	s := &Scanner{
		libraryRepo: libraryRepo,
		seriesRepo:  seriesRepo,
	}

	if err := s.NormalizeStoredSeriesTitles(); err != nil {
		t.Fatalf("NormalizeStoredSeriesTitles() error = %v", err)
	}

	updated, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByID() error = %v", err)
	}
	if updated.Title != "20세기 소년 완전판" {
		t.Fatalf("Title = %q, want normalized path-based title", updated.Title)
	}

	if applyErr := s.NormalizeStoredSeriesTitles(); applyErr != nil {
		t.Fatalf("NormalizeStoredSeriesTitles() error = %v", applyErr)
	}

	restored, err := seriesRepo.FindByID(nil, series.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByID() after restore error = %v", err)
	}
	if restored.Title != "20세기 소년 완전판" {
		t.Fatalf("Title = %q, want normalized path-based title after restore", restored.Title)
	}
}

func TestScanLibraryBumpsSeriesUpdatedAtWhenLeafSeriesContentChanges(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "library")
	seriesPath := filepath.Join(libraryPath, "테스트 시리즈")

	if err := os.MkdirAll(seriesPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(seriesPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(001.png) error = %v", err)
	}

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	chapterRepo := repository.NewChapterRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		repository.NewVolumeRepository(),
		chapterRepo,
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatalf("ScanLibrary() initial error = %v", err)
	}

	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 1 {
		t.Fatalf("len(seriesList) = %d, want 1", len(seriesList))
	}

	staleUpdatedAt := time.Now().Add(-48 * time.Hour).UTC().Truncate(time.Second)
	err = seriesRepo.UpdateUpdatedAt(nil, seriesList[0].ID, staleUpdatedAt)
	if err != nil {
		t.Fatalf("SeriesRepository.UpdateUpdatedAt() error = %v", err)
	}

	err = os.WriteFile(filepath.Join(seriesPath, "002.png"), tinyPNG, 0o644)
	if err != nil {
		t.Fatalf("os.WriteFile(002.png) error = %v", err)
	}
	err = os.Chtimes(seriesPath, staleUpdatedAt, staleUpdatedAt)
	if err != nil {
		t.Fatalf("os.Chtimes(seriesPath) error = %v", err)
	}

	_, err = s.ScanLibrary(context.Background(), library)
	if err != nil {
		t.Fatalf("ScanLibrary() rescan error = %v", err)
	}

	updatedSeries, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() after rescan error = %v", err)
	}
	if len(updatedSeries) != 1 {
		t.Fatalf("len(updatedSeries) = %d, want 1", len(updatedSeries))
	}
	if !updatedSeries[0].UpdatedAt.After(staleUpdatedAt) {
		t.Fatalf("UpdatedAt = %v, want after %v", updatedSeries[0].UpdatedAt, staleUpdatedAt)
	}

	chapterCount, err := chapterRepo.CountBySeriesID(nil, updatedSeries[0].ID)
	if err != nil {
		t.Fatalf("ChapterRepository.CountBySeriesID() error = %v", err)
	}
	if chapterCount != 1 {
		t.Fatalf("chapterCount = %d, want 1", chapterCount)
	}
}

func TestScanLibraryRecursivelyCollectsLeafSeriesFolders(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "books")
	if err := os.MkdirAll(filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "가면라이더"), 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.MkdirAll(filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "괴수 8호"), 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	writeTestZipArchive(t, filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "가면라이더", "001.cbz"), map[string][]byte{
		"001.png": tinyPNG,
	})
	writeTestZipArchive(t, filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "괴수 8호", "001.cbz"), map[string][]byte{
		"001.png": tinyPNG,
	})

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatalf("ScanLibrary() error = %v", err)
	}

	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 2 {
		t.Fatalf("len(seriesList) = %d, want 2", len(seriesList))
	}

	paths := []string{seriesList[0].Path, seriesList[1].Path}
	titles := []string{seriesList[0].Title, seriesList[1].Title}
	slices.Sort(paths)
	slices.Sort(titles)

	expectedPaths := []string{
		filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "가면라이더"),
		filepath.Join(libraryPath, "만화(정발)", "1.단편", "[ ㄱ ]", "괴수 8호"),
	}
	expectedTitles := []string{"가면라이더", "괴수 8호"}

	if !slices.Equal(paths, expectedPaths) {
		t.Fatalf("paths = %v, want %v", paths, expectedPaths)
	}
	if !slices.Equal(titles, expectedTitles) {
		t.Fatalf("titles = %v, want %v", titles, expectedTitles)
	}
}

func TestScanLibraryTreatsDirectImageLeafFoldersAsSeries(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "books")
	part1Path := filepath.Join(libraryPath, "초인의 시대", "Part 1")
	part2Path := filepath.Join(libraryPath, "초인의 시대", "Part 2")
	if err := os.MkdirAll(part1Path, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(part1) error = %v", err)
	}
	if err := os.MkdirAll(part2Path, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(part2) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(part1Path, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(part1 image) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(part2Path, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(part2 image) error = %v", err)
	}

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	volumeRepo := repository.NewVolumeRepository()
	chapterRepo := repository.NewChapterRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		volumeRepo,
		chapterRepo,
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatalf("ScanLibrary() error = %v", err)
	}

	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 2 {
		t.Fatalf("len(seriesList) = %d, want 2", len(seriesList))
	}

	for _, series := range seriesList {
		volumeCount, volumeErr := volumeRepo.CountBySeriesID(nil, series.ID)
		if volumeErr != nil {
			t.Fatalf("VolumeRepository.CountBySeriesID() error = %v", volumeErr)
		}
		chapterCount, chapterErr := chapterRepo.CountBySeriesID(nil, series.ID)
		if chapterErr != nil {
			t.Fatalf("ChapterRepository.CountBySeriesID() error = %v", chapterErr)
		}
		if volumeCount != 1 {
			t.Fatalf("volumeCount = %d, want 1 for %s", volumeCount, series.Title)
		}
		if chapterCount != 1 {
			t.Fatalf("chapterCount = %d, want 1 for %s", chapterCount, series.Title)
		}
	}
}

func TestCollectSeriesScanTargetsWarnsForMixedFolders(t *testing.T) {
	libraryPath := filepath.Join(t.TempDir(), "books")
	mixedPath := filepath.Join(libraryPath, "혼합 폴더")
	childLeafPath := filepath.Join(mixedPath, "하위 폴더")
	if err := os.MkdirAll(childLeafPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(mixedPath, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(childLeafPath, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(child leaf) error = %v", err)
	}

	s := NewScanner(
		repository.NewLibraryRepository(),
		repository.NewSeriesRepository(),
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: t.TempDir()},
	)

	targets, warnings, err := s.collectSeriesScanTargets(context.Background(), libraryPath, nil, "book")
	if err != nil {
		t.Fatalf("collectSeriesScanTargets() error = %v", err)
	}
	if len(targets) != 1 {
		t.Fatalf("len(targets) = %d, want 1", len(targets))
	}
	if targets[0].Path != childLeafPath {
		t.Fatalf("targets[0].Path = %q, want %q", targets[0].Path, childLeafPath)
	}
	if len(warnings) != 1 {
		t.Fatalf("len(warnings) = %d, want 1", len(warnings))
	}
}

func TestScanLibraryKeepsDirectImageLeafVolumeTreeWhenContentUnchanged(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "books")
	seriesPath := filepath.Join(libraryPath, "테스트 시리즈")
	if err := os.MkdirAll(seriesPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(seriesPath) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(001.png) error = %v", err)
	}

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	volumeRepo := repository.NewVolumeRepository()
	chapterRepo := repository.NewChapterRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		volumeRepo,
		chapterRepo,
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatalf("ScanLibrary() initial error = %v", err)
	}

	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 1 {
		t.Fatalf("len(seriesList) = %d, want 1", len(seriesList))
	}

	initialVolumes, err := volumeRepo.FindBySeriesID(nil, seriesList[0].ID)
	if err != nil {
		t.Fatalf("VolumeRepository.FindBySeriesID() error = %v", err)
	}
	if len(initialVolumes) != 1 {
		t.Fatalf("len(initialVolumes) = %d, want 1", len(initialVolumes))
	}

	initialChapters, err := chapterRepo.FindBySeriesID(nil, seriesList[0].ID)
	if err != nil {
		t.Fatalf("ChapterRepository.FindBySeriesID() error = %v", err)
	}
	if len(initialChapters) != 1 {
		t.Fatalf("len(initialChapters) = %d, want 1", len(initialChapters))
	}

	initialVolumeID := initialVolumes[0].ID
	initialChapterID := initialChapters[0].ID
	initialUpdatedAt := seriesList[0].UpdatedAt

	if _, rescanErr := s.ScanLibrary(context.Background(), library); rescanErr != nil {
		t.Fatalf("ScanLibrary() unchanged rescan error = %v", rescanErr)
	}

	updatedVolumes, err := volumeRepo.FindBySeriesID(nil, seriesList[0].ID)
	if err != nil {
		t.Fatalf("VolumeRepository.FindBySeriesID() after rescan error = %v", err)
	}
	updatedChapters, err := chapterRepo.FindBySeriesID(nil, seriesList[0].ID)
	if err != nil {
		t.Fatalf("ChapterRepository.FindBySeriesID() after rescan error = %v", err)
	}
	updatedSeries, err := seriesRepo.FindByID(nil, seriesList[0].ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByID() after rescan error = %v", err)
	}

	if len(updatedVolumes) != 1 || updatedVolumes[0].ID != initialVolumeID {
		t.Fatalf("updatedVolumes = %v, want preserved volume ID %q", updatedVolumes, initialVolumeID)
	}
	if len(updatedChapters) != 1 || updatedChapters[0].ID != initialChapterID {
		t.Fatalf("updatedChapters = %v, want preserved chapter ID %q", updatedChapters, initialChapterID)
	}
	if !updatedSeries.UpdatedAt.Equal(initialUpdatedAt) {
		t.Fatalf("UpdatedAt = %v, want unchanged %v", updatedSeries.UpdatedAt, initialUpdatedAt)
	}
}

func TestScanLibraryPreservesArchiveCountsWhenArchiveUnchanged(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "books")
	if err := os.MkdirAll(libraryPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll(libraryPath) error = %v", err)
	}

	archivePath := filepath.Join(libraryPath, "archive-series.cbz")
	writeTestZipArchive(t, archivePath, map[string][]byte{
		"001.png": tinyPNG,
		"002.png": tinyPNG,
	})

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()

	library := &model.Library{
		Name:        "테스트 라이브러리",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	initialResult, err := s.ScanLibrary(context.Background(), library)
	if err != nil {
		t.Fatalf("ScanLibrary() initial error = %v", err)
	}
	if initialResult.SeriesCount != 1 || initialResult.VolumeCount != 1 || initialResult.ChapterCount != 1 || initialResult.PageCount != 2 {
		t.Fatalf("initial result = %+v, want series=1 volume=1 chapter=1 page=2", initialResult)
	}

	unchangedResult, err := s.ScanLibrary(context.Background(), library)
	if err != nil {
		t.Fatalf("ScanLibrary() unchanged rescan error = %v", err)
	}
	if unchangedResult.SeriesCount != 1 || unchangedResult.VolumeCount != 1 || unchangedResult.ChapterCount != 1 || unchangedResult.PageCount != 2 {
		t.Fatalf("unchanged result = %+v, want series=1 volume=1 chapter=1 page=2", unchangedResult)
	}
}

func TestScanLibraryRepairsLegacyZeroCountPDF(t *testing.T) {
	if err := database.Connect(filepath.Join(t.TempDir(), "scan.db")); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close(); database.DB = nil })
	libraryPath := t.TempDir()
	pdf := filepath.Join(libraryPath, "book.pdf")
	// Minimal valid single-page PDF with an xref; no external fixture dependency.
	var content strings.Builder
	content.WriteString("%PDF-1.4\n")
	objects := []string{
		"<</Type /Catalog /Pages 2 0 R>>",
		"<</Type /Pages /Kids [3 0 R] /Count 1>>",
		"<</Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Resources <<>>>>",
	}
	offsets := []int{0}
	for i, obj := range objects {
		offsets = append(offsets, content.Len())
		fmt.Fprintf(&content, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := content.Len()
	fmt.Fprintf(&content, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&content, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&content, "trailer\n<</Size %d /Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	if err := os.WriteFile(pdf, []byte(content.String()), 0o600); err != nil {
		t.Fatal(err)
	}
	if count, err := util.GetPdfPageCount(pdf); err != nil || count != 1 {
		t.Fatalf("fixture page count=%d, err=%v", count, err)
	}
	libraryRepo := repository.NewLibraryRepository()
	library := &model.Library{Name: "PDF", Paths: []string{libraryPath}, LibraryType: "book"}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatal(err)
	}
	s := NewScanner(libraryRepo, repository.NewSeriesRepository(), repository.NewVolumeRepository(), repository.NewChapterRepository(), repository.NewPageRepository(), repository.NewSettingRepository(), &config.Config{DataDir: t.TempDir()})
	checkCount := func(want int) {
		t.Helper()
		var count int
		if err := database.DB.QueryRow(`SELECT page_count FROM chapters WHERE path=?`, pdf).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("PDF page count=%d, want %d", count, want)
		}
	}
	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatal(err)
	}
	checkCount(1)
	if _, err := database.DB.Exec(`UPDATE chapters SET page_count=0 WHERE path=?`, pdf); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ScanLibrary(context.Background(), library); err != nil {
		t.Fatal(err)
	}
	checkCount(1)
}

func TestHasScannedVolumeContentChangeTreatsSentinelPageCountAsUnchanged(t *testing.T) {
	s := &Scanner{}

	existingVol := &model.Volume{ID: "volume-1", VolumeNumber: 1, Unit: "volume", HasAudio: false}
	volData := &scannedVolume{
		VolumeNumber: 1,
		Unit:         "volume",
		HasAudio:     false,
		Chapters: []scannedChapter{
			{
				Title:         "챕터 1",
				ChapterNumber: 1,
				Path:          "/library/series/chapter-1",
				PageCount:     0,
				Pages:         nil,
				HasAudio:      false,
			},
		},
	}

	changed, err := s.hasScannedVolumeContentChange(
		volData,
		existingVol,
		map[string][]*model.Volume{},
		map[string][]model.Chapter{
			"volume-1": {
				{
					VolumeID:      "volume-1",
					Title:         "챕터 1",
					ChapterNumber: 1,
					Path:          "/library/series/chapter-1",
					PageCount:     -1,
					HasAudio:      false,
				},
			},
		},
		map[string]bool{
			"volume-1": true,
		},
	)
	if err != nil {
		t.Fatalf("hasScannedVolumeContentChange() error = %v", err)
	}

	if changed {
		t.Fatal("hasScannedVolumeContentChange() = true, want false")
	}
}

func TestAnalyzeVolumeRecursiveSetsMixExtensionForMixedChapterFormats(t *testing.T) {
	baseDir := t.TempDir()
	seriesPath := filepath.Join(baseDir, "mixed-series")
	if err := os.MkdirAll(seriesPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "001.jpg"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(001.jpg) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "002.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(002.png) error = %v", err)
	}

	s := &Scanner{}
	vol, err := s.analyzeVolumeRecursive(seriesPath, "mixed-series", 1, "volume", nil, "book")
	if err != nil {
		t.Fatalf("analyzeVolumeRecursive() error = %v", err)
	}
	if vol.Extension != "MIX" {
		t.Fatalf("Extension = %q, want %q", vol.Extension, "MIX")
	}
}

func TestHasDirectPageLikeSeriesContentRequiresNoVolumeCandidates(t *testing.T) {
	baseDir := t.TempDir()
	s := &Scanner{}

	t.Run("direct images only", func(t *testing.T) {
		seriesPath := filepath.Join(baseDir, "images-only")
		if err := os.MkdirAll(seriesPath, 0o755); err != nil {
			t.Fatalf("os.MkdirAll() error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(seriesPath, "001.png"), tinyPNG, 0o644); err != nil {
			t.Fatalf("os.WriteFile() error = %v", err)
		}
		entries, err := os.ReadDir(seriesPath)
		if err != nil {
			t.Fatalf("os.ReadDir() error = %v", err)
		}
		if !s.hasDirectPageLikeSeriesContent(entries, nil, "book") {
			t.Fatal("hasDirectPageLikeSeriesContent() = false, want true for direct image leaf")
		}
	})

	t.Run("cover image with chapter dir", func(t *testing.T) {
		seriesPath := filepath.Join(baseDir, "cover-and-dir")
		if err := os.MkdirAll(filepath.Join(seriesPath, "Chapter 01"), 0o755); err != nil {
			t.Fatalf("os.MkdirAll() error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(seriesPath, "cover.jpg"), tinyPNG, 0o644); err != nil {
			t.Fatalf("os.WriteFile() error = %v", err)
		}
		entries, err := os.ReadDir(seriesPath)
		if err != nil {
			t.Fatalf("os.ReadDir() error = %v", err)
		}
		if s.hasDirectPageLikeSeriesContent(entries, nil, "book") {
			t.Fatal("hasDirectPageLikeSeriesContent() = true, want false when volume candidate directory exists")
		}
	})

	t.Run("cover image with archive file", func(t *testing.T) {
		seriesPath := filepath.Join(baseDir, "cover-and-archive")
		if err := os.MkdirAll(seriesPath, 0o755); err != nil {
			t.Fatalf("os.MkdirAll() error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(seriesPath, "cover.jpg"), tinyPNG, 0o644); err != nil {
			t.Fatalf("os.WriteFile(cover.jpg) error = %v", err)
		}
		if err := os.WriteFile(filepath.Join(seriesPath, "001.zip"), []byte("zip"), 0o644); err != nil {
			t.Fatalf("os.WriteFile(001.zip) error = %v", err)
		}
		entries, err := os.ReadDir(seriesPath)
		if err != nil {
			t.Fatalf("os.ReadDir() error = %v", err)
		}
		if s.hasDirectPageLikeSeriesContent(entries, nil, "book") {
			t.Fatal("hasDirectPageLikeSeriesContent() = true, want false when archive volume candidate exists")
		}
	})
}

func TestInspectSeriesCandidateFolderKeepsRecursingWhenChildDirectoriesExist(t *testing.T) {
	baseDir := t.TempDir()
	seriesPath := filepath.Join(baseDir, "series-with-cover-and-parts")
	if err := os.MkdirAll(filepath.Join(seriesPath, "Part 1"), 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "cover.jpg"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile() error = %v", err)
	}

	s := &Scanner{}
	directContent, childEntries, err := s.inspectSeriesCandidateFolder(seriesPath, nil, "book")
	if err != nil {
		t.Fatalf("inspectSeriesCandidateFolder() error = %v", err)
	}
	if directContent {
		t.Fatal("inspectSeriesCandidateFolder() = true, want false when child directories exist")
	}
	if len(childEntries) == 0 {
		t.Fatal("childEntries = empty, want populated entries")
	}
}

func TestScanLibraryCollectsMixedFolderWarningsWithoutErrorStatus(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "kumiho.db")
	if err := database.Connect(dbPath); err != nil {
		t.Fatalf("database.Connect() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Fatalf("database.Close() error = %v", err)
		}
	})

	dataDir := t.TempDir()
	libraryPath := filepath.Join(t.TempDir(), "library")
	seriesPath := filepath.Join(libraryPath, "Mixed Series")
	if err := os.MkdirAll(filepath.Join(seriesPath, "Chapter 01"), 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "cover.jpg"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(cover.jpg) error = %v", err)
	}
	if err := os.WriteFile(filepath.Join(seriesPath, "Chapter 01", "001.png"), tinyPNG, 0o644); err != nil {
		t.Fatalf("os.WriteFile(001.png) error = %v", err)
	}

	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	volumeRepo := repository.NewVolumeRepository()
	chapterRepo := repository.NewChapterRepository()
	library := &model.Library{
		Name:        "Mixed Warning Library",
		Paths:       []string{libraryPath},
		LibraryType: "book",
	}
	if err := libraryRepo.Create(nil, library); err != nil {
		t.Fatalf("LibraryRepository.Create() error = %v", err)
	}

	s := NewScanner(
		libraryRepo,
		seriesRepo,
		volumeRepo,
		chapterRepo,
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{DataDir: dataDir},
	)

	result, err := s.ScanLibrary(context.Background(), library)
	if err != nil {
		t.Fatalf("ScanLibrary() error = %v", err)
	}
	if len(result.Errors) != 0 {
		t.Fatalf("result.Errors = %v, want no hard errors for mixed-folder warning", result.Errors)
	}
	if len(result.Warnings) == 0 {
		t.Fatal("result.Warnings = empty, want mixed-folder warning")
	}
	seriesList, err := seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		t.Fatalf("SeriesRepository.FindByLibraryID() error = %v", err)
	}
	if len(seriesList) != 1 {
		t.Fatalf("len(seriesList) = %d, want 1", len(seriesList))
	}
	if seriesList[0].Path != filepath.Join(seriesPath, "Chapter 01") {
		t.Fatalf("series path = %q, want child leaf path", seriesList[0].Path)
	}

	refreshedLibrary, err := libraryRepo.FindByID(nil, library.ID)
	if err != nil {
		t.Fatalf("LibraryRepository.FindByID() error = %v", err)
	}
	if refreshedLibrary == nil {
		t.Fatal("LibraryRepository.FindByID() = nil, want library")
	}
	if refreshedLibrary.ScanStatus != "IDLE" {
		t.Fatalf("ScanStatus = %q, want %q", refreshedLibrary.ScanStatus, "IDLE")
	}
}

func TestRemoveLibraryWatchKeepsNestedLibraryWatches(t *testing.T) {
	baseDir := t.TempDir()
	rootPath := filepath.Join(baseDir, "data")
	nestedPath := filepath.Join(rootPath, "other")
	nestedChildPath := filepath.Join(nestedPath, "child")

	if err := os.MkdirAll(nestedChildPath, 0o755); err != nil {
		t.Fatalf("os.MkdirAll() error = %v", err)
	}

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		t.Fatalf("fsnotify.NewWatcher() error = %v", err)
	}
	defer func() { _ = watcher.Close() }()

	s := &Scanner{
		watcher:   watcher,
		watchRefs: make(map[string]int),
	}

	if err := s.AddLibraryWatch("root-lib", rootPath); err != nil {
		t.Fatalf("AddLibraryWatch(root) error = %v", err)
	}
	if err := s.AddLibraryWatch("nested-lib", nestedPath); err != nil {
		t.Fatalf("AddLibraryWatch(nested) error = %v", err)
	}

	s.RemoveLibraryWatch("root-lib")

	watchList := watcher.WatchList()
	if !slices.Contains(watchList, nestedPath) {
		t.Fatalf("watch list missing nested root %q after removing parent: %v", nestedPath, watchList)
	}
	if !slices.Contains(watchList, nestedChildPath) {
		t.Fatalf("watch list missing nested child %q after removing parent: %v", nestedChildPath, watchList)
	}
	if slices.Contains(watchList, rootPath) {
		t.Fatalf("watch list still contains removed root %q: %v", rootPath, watchList)
	}
}

func TestScannerIsScanning(t *testing.T) {
	t.Parallel()

	s := NewScanner(
		repository.NewLibraryRepository(),
		repository.NewSeriesRepository(),
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{},
	)

	if s.IsScanning("lib-1") {
		t.Fatal("IsScanning() = true before marking scan active")
	}

	s.scanningCurrent.Store("lib-1", true)
	if !s.IsScanning("lib-1") {
		t.Fatal("IsScanning() = false while scan is active")
	}

	s.scanningCurrent.Delete("lib-1")
	if s.IsScanning("lib-1") {
		t.Fatal("IsScanning() = true after scan is cleared")
	}
}

func TestScannerLibraryDeleteGuard(t *testing.T) {
	t.Parallel()

	s := NewScanner(
		repository.NewLibraryRepository(),
		repository.NewSeriesRepository(),
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{},
	)

	if !s.BeginLibraryDelete("lib-1") {
		t.Fatal("BeginLibraryDelete() = false, want first caller to acquire guard")
	}
	if s.BeginLibraryDelete("lib-1") {
		t.Fatal("BeginLibraryDelete() = true, want second caller to be rejected")
	}

	s.EndLibraryDelete("lib-1")
	if !s.BeginLibraryDelete("lib-1") {
		t.Fatal("BeginLibraryDelete() = false after release")
	}
}

func TestScannerRejectsScanWhileLibraryDeleting(t *testing.T) {
	t.Parallel()

	s := NewScanner(
		repository.NewLibraryRepository(),
		repository.NewSeriesRepository(),
		repository.NewVolumeRepository(),
		repository.NewChapterRepository(),
		repository.NewPageRepository(),
		repository.NewSettingRepository(),
		&config.Config{},
	)
	s.BeginLibraryDelete("lib-1")

	_, err := s.ScanLibrary(context.Background(), &model.Library{
		ID:          "lib-1",
		Type:        "LOCAL",
		LibraryType: "book",
		Paths:       []string{t.TempDir()},
	})
	if !errors.Is(err, ErrLibraryDeleting) {
		t.Fatalf("ScanLibrary() error = %v, want ErrLibraryDeleting", err)
	}
}
