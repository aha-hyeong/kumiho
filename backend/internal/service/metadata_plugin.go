package service

import (
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/metadata_engine"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
	"github.com/kumiho-plugin/kumiho-plugin-sdk/capability"
	pluginerrors "github.com/kumiho-plugin/kumiho-plugin-sdk/errors"
	sdkmanifest "github.com/kumiho-plugin/kumiho-plugin-sdk/manifest"
	sdkstate "github.com/kumiho-plugin/kumiho-plugin-sdk/state"
	sdktypes "github.com/kumiho-plugin/kumiho-plugin-sdk/types"
)

var (
	ErrSeriesNotFound         = errors.New("series not found")
	ErrNoActiveMetadataPlugin = errors.New("no active metadata plugin")
	ErrLibraryNotFound        = errors.New("library not found")
	htmlTagPattern            = regexp.MustCompile(`(?s)<[^>]*>`)
	blockHTMLPattern          = regexp.MustCompile(`(?i)</?(p|div|br|li|ul|ol|h[1-6]|blockquote)[^>]*>`)
	candidateVolumePattern    = regexp.MustCompile(`(?i)(?:^|[\s._:-])(?:vol(?:ume)?\.?\s*)?(\d{1,3})(?:$|[\s._:-])`)
)

const lowConfidenceProviderOrderThreshold = 0.35

type MetadataPluginFailure struct {
	PluginID   string `json:"plugin_id"`
	PluginName string `json:"plugin_name"`
	Message    string `json:"message"`
}

type MetadataCandidate struct {
	PluginID   string                   `json:"plugin_id"`
	PluginName string                   `json:"plugin_name"`
	Candidate  sdktypes.SearchCandidate `json:"candidate"`
}

type MetadataSearchResult struct {
	Query      sdktypes.SearchRequest  `json:"query"`
	Candidates []MetadataCandidate     `json:"candidates"`
	Failures   []MetadataPluginFailure `json:"failures,omitempty"`
}

type MetadataFetchSelection struct {
	PluginID string             `json:"plugin_id"`
	Source   sdktypes.SourceRef `json:"source"`
}

type MetadataSearchOptions struct {
	Title string `json:"title"`
}

type MetadataFetchResult struct {
	PluginID string                   `json:"plugin_id"`
	Result   *sdktypes.MetadataResult `json:"result"`
}

type MetadataApplyResult struct {
	Series        *model.Series `json:"series"`
	UpdatedFields []string      `json:"updated_fields"`
	CoverURL      string        `json:"cover_url,omitempty"`
	AppliedAt     time.Time     `json:"applied_at"`
}

type MetadataResetResult struct {
	LibraryID   string    `json:"library_id"`
	LibraryName string    `json:"library_name"`
	ResetCount  int64     `json:"reset_count"`
	ResetAt     time.Time `json:"reset_at"`
	Warnings    []string  `json:"warnings,omitempty"`
}

type MetadataService struct {
	seriesRepo    *repository.SeriesRepository
	characterRepo *repository.SeriesCharacterRepository
	volumeRepo    *repository.VolumeRepository
	libraryRepo   *repository.LibraryRepository
	settingRepo   repository.SettingRepository
	manager       *pluginengine.Manager
	cfg           *config.Config
	client        *http.Client
}

func NewMetadataService(
	cfg *config.Config,
	client *http.Client,
	seriesRepo *repository.SeriesRepository,
	characterRepo *repository.SeriesCharacterRepository,
	libraryRepo *repository.LibraryRepository,
	settingRepo repository.SettingRepository,
	manager *pluginengine.Manager,
) *MetadataService {
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &MetadataService{
		seriesRepo:    seriesRepo,
		characterRepo: characterRepo,
		volumeRepo:    repository.NewVolumeRepository(),
		libraryRepo:   libraryRepo,
		settingRepo:   settingRepo,
		manager:       manager,
		cfg:           cfg,
		client:        client,
	}
}

func (s *MetadataService) SearchSeries(ctx context.Context, seriesID string, userID string, opts MetadataSearchOptions) (*MetadataSearchResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}

	searchTitle := strings.TrimSpace(opts.Title)
	if searchTitle == "" {
		searchTitle = series.Title
	}

	req := metadata_engine.BuildSearchRequest(searchTitle, series.Path, mapContentType(series.LibraryType), "")
	req.Language = inferSearchLanguage(searchTitle)
	if strings.TrimSpace(opts.Title) == "" && series.Metadata != nil && strings.TrimSpace(series.Metadata.ISBN) != "" {
		req.Identifiers = map[string]string{"isbn": strings.TrimSpace(series.Metadata.ISBN)}
	}

	records, err := s.manager.List()
	if err != nil {
		return nil, err
	}

	result := &MetadataSearchResult{Query: req}
	activeCount := 0

	for _, record := range records {
		if record.State != sdkstate.Active || !hasCapability(record.Manifest, capability.MetadataSearch) {
			continue
		}
		activeCount++

		resp, callErr := s.manager.Search(ctx, record.ID, &req)
		if callErr != nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    callErr.Error(),
			})
			continue
		}
		if resp == nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    "empty search response",
			})
			continue
		}
		if resp.Error != nil {
			result.Failures = append(result.Failures, MetadataPluginFailure{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Message:    resp.Error.Error(),
			})
			continue
		}

		for _, candidate := range resp.Candidates {
			result.Candidates = append(result.Candidates, MetadataCandidate{
				PluginID:   record.ID,
				PluginName: record.Manifest.Name,
				Candidate:  candidate,
			})
		}
	}

	if activeCount == 0 {
		return nil, ErrNoActiveMetadataPlugin
	}

	sort.SliceStable(result.Candidates, func(i, j int) bool {
		left := result.Candidates[i].Candidate
		right := result.Candidates[j].Candidate
		if left.Confidence != right.Confidence {
			return left.Confidence > right.Confidence
		}
		if left.Confidence <= lowConfidenceProviderOrderThreshold {
			return false
		}

		leftVolume, leftHasVolume := candidateVolumeNumber(left.Title)
		rightVolume, rightHasVolume := candidateVolumeNumber(right.Title)
		switch {
		case leftHasVolume && rightHasVolume && leftVolume != rightVolume:
			return leftVolume < rightVolume
		case leftHasVolume != rightHasVolume:
			return leftHasVolume
		}

		if left.Score != right.Score {
			return left.Score > right.Score
		}
		return false
	})

	return result, nil
}

func (s *MetadataService) FetchSeriesMetadata(ctx context.Context, seriesID string, userID string, selection MetadataFetchSelection) (*MetadataFetchResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}
	if strings.TrimSpace(selection.PluginID) == "" {
		return nil, errors.New("plugin_id is required")
	}
	if strings.TrimSpace(selection.Source.ID) == "" || strings.TrimSpace(selection.Source.Name) == "" {
		return nil, errors.New("source.id and source.name are required")
	}

	record, ok, err := s.manager.Get(selection.PluginID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, pluginengine.ErrPluginNotFound
	}
	if record.State != sdkstate.Active {
		return nil, pluginerrors.Newf(pluginerrors.ErrCodePluginNotReady, "plugin %q is not active", selection.PluginID)
	}
	if !hasCapability(record.Manifest, capability.MetadataFetch) {
		return nil, pluginerrors.Newf(pluginerrors.ErrCodeUnsupported, "plugin %q does not support metadata.fetch", selection.PluginID)
	}

	resp, err := s.manager.Fetch(ctx, selection.PluginID, &sdktypes.FetchRequest{Source: selection.Source})
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.Result == nil {
		if resp != nil && resp.Error != nil {
			return nil, resp.Error
		}
		return nil, errors.New("empty fetch response")
	}
	if resp.Error != nil {
		return nil, resp.Error
	}

	return &MetadataFetchResult{
		PluginID: selection.PluginID,
		Result:   resp.Result,
	}, nil
}

func (s *MetadataService) ApplySeriesMetadata(ctx context.Context, seriesID string, userID string, result *sdktypes.MetadataResult) (*MetadataApplyResult, error) {
	series, err := s.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return nil, err
	}
	if series == nil {
		return nil, ErrSeriesNotFound
	}
	if result == nil {
		return nil, errors.New("result is required")
	}

	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{SeriesID: series.ID}
	}

	var updatedFields []string

	// 수동 원제 여부를 먼저 판별한 뒤에만 fallback title 적용 여부를 결정한다.
	manualOriginalTitle := ""
	isManualOriginalTitle := scanner.IsManualOriginalTitle(series.Metadata.OriginalTitles, series.Metadata.OriginalTitle)
	if existingTitle := strings.TrimSpace(series.Metadata.OriginalTitle); isManualOriginalTitle {
		manualOriginalTitle = existingTitle
	}
	if !isManualOriginalTitle {
		applyFetchedTitle(series, result, &updatedFields)
	}
	previousDescription := strings.TrimSpace(series.Description)
	applyString(&series.Description, sanitizeDescription(result.Description), "description", &updatedFields)
	if strings.TrimSpace(series.Description) != previousDescription {
		series.Metadata.Description = series.Description
		series.Metadata.DescriptionTranslated = ""
	}

	// original_titles raw 저장

	if len(result.OriginalTitles) > 0 {
		if originalTitles := encodeOriginalTitles(result.OriginalTitles, manualOriginalTitle); originalTitles != "" {
			applyString(&series.Metadata.OriginalTitles, originalTitles, "original_titles", &updatedFields)
		}
	} else if manualOriginalTitle != "" {
		if originalTitles := scanner.WithManualOriginalTitle(series.Metadata.OriginalTitles, manualOriginalTitle); originalTitles != "" {
			applyString(&series.Metadata.OriginalTitles, originalTitles, "original_titles", &updatedFields)
		}
	}

	// locale 우선순위로 해석한 값을 original_title에 저장
	// 단, 기존 original_title이 비어있지 않고 original_titles에 없는 값이면 수동 입력으로 간주 → 덮어쓰지 않음
	locale := repository.PreferredOriginalTitleLocale(s.settingRepo)
	resolvedOriginalTitle := resolveFetchedOriginalTitle(result, locale)
	if resolvedOriginalTitle != "" {
		if !isManualOriginalTitle {
			applyString(&series.Metadata.OriginalTitle, resolvedOriginalTitle, "original_title", &updatedFields)
		}
	} else if fetchedOriginalTitle := strings.TrimSpace(result.OriginalTitle); fetchedOriginalTitle != "" {
		applyString(&series.Metadata.OriginalTitle, fetchedOriginalTitle, "original_title", &updatedFields)
	}

	applyString(&series.Metadata.Publisher, strings.TrimSpace(result.Publisher), "publisher", &updatedFields)
	applyString(&series.Metadata.PublishedAt, strings.TrimSpace(result.PublicationDate), "published_at", &updatedFields)
	if publicationYear := yearFromDate(result.PublicationDate); publicationYear != "" {
		applyString(&series.Metadata.PublicationYear, publicationYear, "publication_year", &updatedFields)
	}
	if authors := strings.Join(filterNonEmpty(result.Authors), ", "); authors != "" {
		applyString(&series.Metadata.Authors, authors, "authors", &updatedFields)
	}
	if tags := strings.Join(normalizeTags(result.Tags), ", "); tags != "" {
		applyString(&series.Metadata.Tags, tags, "tags", &updatedFields)
	}

	isbn := firstIdentifier(result.Identifiers, "isbn13", "isbn", "isbn10")
	if isbn != "" {
		applyString(&series.Metadata.ISBN, isbn, "isbn", &updatedFields)
	}

	coverURL := coverURL(result)
	if coverURL != "" {
		if applied, err := s.applySeriesThumbnail(ctx, series, coverURL); err != nil {
			return nil, err
		} else if applied {
			updatedFields = append(updatedFields, "thumbnail")
		}
	}

	if len(updatedFields) == 0 {
		s.enrichSeriesThumbnail(series)
		s.assignSeriesDisplayTitle(series)
		return &MetadataApplyResult{
			Series:        series,
			UpdatedFields: updatedFields,
			AppliedAt:     time.Now(),
			CoverURL:      coverURL,
		}, nil
	}

	if err := s.seriesRepo.UpdatePreservingUpdatedAt(nil, series); err != nil {
		return nil, err
	}

	s.enrichSeriesThumbnail(series)
	s.assignSeriesDisplayTitle(series)

	return &MetadataApplyResult{
		Series:        series,
		UpdatedFields: updatedFields,
		AppliedAt:     time.Now(),
		CoverURL:      coverURL,
	}, nil
}

func (s *MetadataService) ResetLibraryMetadata(ctx context.Context, libraryID string) (*MetadataResetResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}

	if strings.TrimSpace(libraryID) == "" {
		return nil, ErrLibraryNotFound
	}

	library, err := s.libraryRepo.FindByID(nil, libraryID)
	if err != nil {
		return nil, err
	}
	if library == nil {
		return nil, ErrLibraryNotFound
	}

	seriesList, err := s.seriesRepo.FindByLibraryID(nil, libraryID, "")
	if err != nil {
		return nil, err
	}

	fileSet := make(map[string]struct{})
	for i := range seriesList {
		if seriesList[i].ThumbnailPath != nil {
			thumbnailPath := strings.TrimSpace(*seriesList[i].ThumbnailPath)
			if thumbnailPath != "" {
				fileSet[thumbnailPath] = struct{}{}
			}
		}

	}
	if s.characterRepo != nil {
		characterImagePaths, charErr := s.characterRepo.ListImagePathsByLibraryID(nil, libraryID)
		if charErr != nil {
			return nil, charErr
		}
		for _, imagePath := range characterImagePaths {
			trimmedPath := strings.TrimSpace(imagePath)
			if trimmedPath == "" {
				continue
			}
			fileSet[trimmedPath] = struct{}{}
		}
	}

	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	resetCount, err := s.seriesRepo.ResetMetadataByLibrary(tx, libraryID)
	if err != nil {
		return nil, err
	}
	if s.characterRepo != nil {
		if err := s.characterRepo.DeleteByLibraryID(tx, libraryID); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}

	result := &MetadataResetResult{
		LibraryID:   library.ID,
		LibraryName: library.Name,
		ResetCount:  resetCount,
		ResetAt:     time.Now(),
	}
	sanitizeAssetWarningName := func(assetPath string) string {
		name := filepath.Base(filepath.Clean(assetPath))
		if name == "" || name == "." || name == string(filepath.Separator) {
			return "asset"
		}
		return name
	}
	for path := range fileSet {
		removed, removeErr := util.RemoveManagedAsset(s.cfg.DataDir, path)
		assetName := sanitizeAssetWarningName(path)
		if !removed {
			result.Warnings = append(result.Warnings, fmt.Sprintf("asset_unmanaged:%s", assetName))
			continue
		}
		if removeErr != nil && !errors.Is(removeErr, os.ErrNotExist) {
			result.Warnings = append(result.Warnings, fmt.Sprintf("asset_remove_failed:%s", assetName))
		}
	}

	return result, nil
}

func hasCapability(manifest sdkmanifest.Manifest, wanted capability.Capability) bool {
	for _, current := range manifest.Capabilities {
		if current == wanted {
			return true
		}
	}
	return false
}

func mapContentType(libraryType string) sdktypes.ContentType {
	switch strings.ToLower(strings.TrimSpace(libraryType)) {
	case string(sdktypes.ContentTypeComic):
		return sdktypes.ContentTypeComic
	case string(sdktypes.ContentTypeNovel):
		return sdktypes.ContentTypeNovel
	case string(sdktypes.ContentTypeAudiobook):
		return sdktypes.ContentTypeAudiobook
	default:
		return ""
	}
}

func applyString(target *string, next string, field string, updatedFields *[]string) bool {
	if next == "" || *target == next {
		return false
	}
	*target = next
	*updatedFields = append(*updatedFields, field)
	return true
}

func applyFetchedTitle(series *model.Series, result *sdktypes.MetadataResult, updatedFields *[]string) {
	if series == nil || result == nil || series.Metadata == nil {
		return
	}
	if strings.TrimSpace(series.Metadata.OriginalTitle) != "" {
		return
	}
	if strings.TrimSpace(result.OriginalTitle) != "" || len(result.OriginalTitles) > 0 {
		return
	}

	fetchedTitle := strings.TrimSpace(result.Title)
	if fetchedTitle == "" {
		return
	}

	applyString(&series.Metadata.OriginalTitle, fetchedTitle, "original_title", updatedFields)
}

func encodeOriginalTitles(values map[string]string, manualOriginalTitle string) string {
	return scanner.EncodeOriginalTitlesPayload(values, manualOriginalTitle)
}

func (s *MetadataService) assignSeriesDisplayTitle(series *model.Series) {
	if series == nil {
		return
	}

	displayTitle := strings.TrimSpace(series.Title)
	library, err := s.libraryRepo.FindByID(nil, series.LibraryID)
	if err == nil && library != nil && library.OriginalTitleOverride {
		locale := repository.PreferredOriginalTitleLocale(s.settingRepo)
		if resolved := scanner.ResolveSeriesTitleFromOriginalTitle(series.Path, series.Title, series.Metadata, true, locale); resolved != "" {
			displayTitle = resolved
		}
	}
	series.DisplayTitle = displayTitle
}

func resolveFetchedOriginalTitle(result *sdktypes.MetadataResult, locale string) string {
	if result == nil {
		return ""
	}

	for _, key := range scanner.PreferredOriginalTitleOrder(locale) {
		if title := strings.TrimSpace(result.OriginalTitles[key]); title != "" {
			return title
		}
	}
	if title := strings.TrimSpace(result.OriginalTitle); title != "" {
		return title
	}
	return ""
}

func filterNonEmpty(values []string) []string {
	filtered := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed != "" {
			filtered = append(filtered, trimmed)
		}
	}
	return filtered
}

func firstIdentifier(identifiers map[string]string, keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(identifiers[key]); value != "" {
			return value
		}
	}
	return ""
}

func yearFromDate(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 4 {
		return value[:4]
	}
	return ""
}

func candidateVolumeNumber(title string) (int, bool) {
	matches := candidateVolumePattern.FindAllStringSubmatch(title, -1)
	if len(matches) == 0 {
		return 0, false
	}

	last := matches[len(matches)-1]
	if len(last) < 2 {
		return 0, false
	}

	value := strings.TrimSpace(last[1])
	if value == "" {
		return 0, false
	}

	volume, err := strconv.Atoi(value)
	if err != nil || volume <= 0 {
		return 0, false
	}
	return volume, true
}

func coverURL(result *sdktypes.MetadataResult) string {
	if result == nil || result.Cover == nil {
		return ""
	}
	return strings.TrimSpace(result.Cover.URL)
}

func sanitizeDescription(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = blockHTMLPattern.ReplaceAllString(value, "\n")
	value = htmlTagPattern.ReplaceAllString(value, "")
	value = html.UnescapeString(value)

	lines := strings.Split(value, "\n")
	cleaned := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			cleaned = append(cleaned, line)
		}
	}
	return strings.Join(cleaned, "\n\n")
}

func normalizeTags(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))

	for _, value := range values {
		for _, part := range splitHierarchicalTag(value) {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			key := strings.ToLower(part)
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			normalized = append(normalized, part)
		}
	}

	return normalized
}

func splitHierarchicalTag(value string) []string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}

	parts := strings.FieldsFunc(value, func(r rune) bool {
		return r == '/' || r == ','
	})
	if len(parts) == 0 {
		return []string{value}
	}
	return parts
}

func (s *MetadataService) applySeriesThumbnail(ctx context.Context, series *model.Series, rawURL string) (bool, error) {
	if s.cfg == nil || strings.TrimSpace(s.cfg.DataDir) == "" {
		return false, nil
	}
	if series == nil || strings.TrimSpace(series.Path) == "" {
		return false, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return false, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; KumihoMetadataBot/0.1)")
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")

	resp, err := s.client.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return false, fmt.Errorf("failed to download cover image: status code %d", resp.StatusCode)
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return false, fmt.Errorf("cover url is not an image")
	}

	thumbnailsDir := filepath.Join(s.cfg.DataDir, "thumbnails", "series")
	if mkdirErr := os.MkdirAll(thumbnailsDir, 0o755); mkdirErr != nil {
		return false, mkdirErr
	}

	hash := md5.Sum([]byte(series.Path))
	hashString := hex.EncodeToString(hash[:])
	deleteHashFiles(thumbnailsDir, hashString)

	path := filepath.Join(thumbnailsDir, hashString+thumbnailExtFromMediaType(contentType))
	outFile, err := os.Create(path)
	if err != nil {
		return false, err
	}

	if _, err := io.Copy(outFile, io.LimitReader(resp.Body, 10*1024*1024)); err != nil {
		_ = outFile.Close()
		_ = os.Remove(path)
		return false, err
	}
	if err := outFile.Close(); err != nil {
		_ = os.Remove(path)
		return false, err
	}

	series.ThumbnailPath = &path
	url := util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, time.Now())
	series.ThumbnailURL = &url
	return true, nil
}

func thumbnailExtFromMediaType(mediaType string) string {
	switch {
	case strings.Contains(mediaType, "png"):
		return ".png"
	case strings.Contains(mediaType, "gif"):
		return ".gif"
	case strings.Contains(mediaType, "webp"):
		return ".webp"
	case strings.Contains(mediaType, "svg"):
		return ".svg"
	default:
		return ".jpg"
	}
}

func deleteHashFiles(dir string, hash string) {
	pattern := filepath.Join(dir, hash+".*")
	matches, err := filepath.Glob(pattern)
	if err != nil {
		return
	}
	for _, match := range matches {
		_ = os.Remove(match)
	}
}

func (s *MetadataService) enrichSeriesThumbnail(series *model.Series) {
	if series == nil || s.seriesRepo == nil {
		return
	}
	if series.ThumbnailPath != nil && strings.TrimSpace(*series.ThumbnailPath) != "" {
		url := util.BuildSeriesThumbnailURL(series.ID, series.ThumbnailPath, series.UpdatedAt)
		series.ThumbnailURL = &url
		return
	}

	pageID, err := s.seriesRepo.GetFirstPageID(nil, series.ID)
	if err == nil && pageID != "" {
		url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
		series.ThumbnailURL = &url
		return
	}

	if s.volumeRepo == nil {
		return
	}
	vol, volErr := s.volumeRepo.GetFirstVolume(nil, series.ID)
	if volErr == nil && vol != nil && vol.ThumbnailPath != nil && strings.TrimSpace(*vol.ThumbnailPath) != "" {
		url := util.BuildVolumeThumbnailURL(vol.ID, vol.ThumbnailPath, vol.UpdatedAt)
		series.ThumbnailURL = &url
	}
}

func inferSearchLanguage(title string) sdktypes.Language {
	title = strings.TrimSpace(title)
	if title == "" {
		return ""
	}

	for _, r := range title {
		switch {
		case r >= 0xAC00 && r <= 0xD7A3:
			return sdktypes.Language("ko")
		case r >= 0x3040 && r <= 0x30FF:
			return sdktypes.Language("ja")
		case r >= 0x4E00 && r <= 0x9FFF:
			return sdktypes.Language("ja")
		case (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z'):
			return sdktypes.Language("en")
		}
	}

	return ""
}
