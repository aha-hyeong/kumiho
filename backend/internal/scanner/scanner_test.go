package scanner

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
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

func TestScanLibraryBumpsSeriesUpdatedAtWhenNewChapterIsAdded(t *testing.T) {
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

	if err := writeTestChapter(seriesPath, "1화"); err != nil {
		t.Fatalf("writeTestChapter(1화) error = %v", err)
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

	err = writeTestChapter(seriesPath, "2화")
	if err != nil {
		t.Fatalf("writeTestChapter(2화) error = %v", err)
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
	if chapterCount != 2 {
		t.Fatalf("chapterCount = %d, want 2", chapterCount)
	}
}

func TestScanLibraryRecursesThroughOrganizationalFolders(t *testing.T) {
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
	seriesAPath := filepath.Join(libraryPath, "1.단편", "[ㄱ]", "시리즈A")
	seriesBPath := filepath.Join(libraryPath, "1.단편", "[ㄱ]", "시리즈B")

	if err := writeTestChapter(seriesAPath, "1화"); err != nil {
		t.Fatalf("writeTestChapter(seriesA) error = %v", err)
	}
	if err := writeTestChapter(seriesBPath, "1화"); err != nil {
		t.Fatalf("writeTestChapter(seriesB) error = %v", err)
	}

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
	slices.Sort(paths)
	expected := []string{seriesAPath, seriesBPath}
	slices.Sort(expected)
	if !slices.Equal(paths, expected) {
		t.Fatalf("series paths = %v, want %v", paths, expected)
	}
}

func TestScanLibraryTreatsChapterLikeChildrenAsSingleSeriesRoot(t *testing.T) {
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
	seriesPath := filepath.Join(libraryPath, "My Series")

	if err := writeTestChapter(seriesPath, "Chapter 01"); err != nil {
		t.Fatalf("writeTestChapter(Chapter 01) error = %v", err)
	}
	if err := writeTestChapter(seriesPath, "Chapter 02"); err != nil {
		t.Fatalf("writeTestChapter(Chapter 02) error = %v", err)
	}

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
	if len(seriesList) != 1 {
		t.Fatalf("len(seriesList) = %d, want 1", len(seriesList))
	}
	if seriesList[0].Path != seriesPath {
		t.Fatalf("series path = %q, want %q", seriesList[0].Path, seriesPath)
	}
}

func TestIsChapterLikeNameDoesNotMatchGeneralSeriesNamesWithNumbers(t *testing.T) {
	for _, name := range []string{"86 - Eighty Six", "20th Century Boys", "Area 51"} {
		if isChapterLikeName(name) {
			t.Fatalf("isChapterLikeName(%q) = true, want false", name)
		}
	}
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

func writeTestChapter(seriesPath, chapterName string) error {
	chapterPath := filepath.Join(seriesPath, chapterName)
	if err := os.MkdirAll(chapterPath, 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(chapterPath, "001.png"), tinyPNG, 0o644)
}
