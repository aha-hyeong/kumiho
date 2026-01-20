package scanner

import (
	"archive/zip"
	"context"
	"errors"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/facette/natsort"
	"github.com/google/uuid"
)

// 에러 정의
var (
	ErrAlreadyScanning = errors.New("already scanning")
)

// 지원하는 이미지 확장자
var imageExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".gif": true, ".bmp": true,
}

// 지원하는 아카이브 확장자
var archiveExtensions = map[string]bool{
	".zip": true, ".cbz": true,
}

// 볼륨 번호 추출을 위한 정규식
var volumeNumRegex = regexp.MustCompile(`(?i)(?:v|vol|volume|권|제)?\s*(\d+)`)

// 완결 여부 확인을 위한 정규식
var completedRegex = regexp.MustCompile(`(?i)(_완|\[완결\]|\(완결\)|\(완\)|완결)$`)

// 스캔 제외 패턴 매칭 (glob 패턴 지원)
func isExcluded(name string, patterns []string) bool {
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		if matched, _ := filepath.Match(pattern, name); matched {
			return true
		}
	}
	return false
}

type Scanner struct {
	libraryRepo *repository.LibraryRepository
	seriesRepo  *repository.SeriesRepository
	volumeRepo  *repository.VolumeRepository
	chapterRepo *repository.ChapterRepository
	pageRepo    *repository.PageRepository

	// 동시성 제어
	maxConcurrentScans int
	semaphore          chan struct{}
	scanningCurrent    sync.Map // map[string]bool (libraryID)
}

func NewScanner(
	libraryRepo *repository.LibraryRepository,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
) *Scanner {
	maxConcurrent := 2 // 기본값 2
	return &Scanner{
		libraryRepo:        libraryRepo,
		seriesRepo:         seriesRepo,
		volumeRepo:         volumeRepo,
		chapterRepo:        chapterRepo,
		pageRepo:           pageRepo,
		maxConcurrentScans: maxConcurrent,
		semaphore:          make(chan struct{}, maxConcurrent),
	}
}

// ScanResult 스캔 결과
type ScanResult struct {
	SeriesCount  int `json:"series_count"`
	VolumeCount  int `json:"volume_count"`
	ChapterCount int `json:"chapter_count"`
	PageCount    int `json:"page_count"`
	Errors       []string `json:"errors,omitempty"`
}

// ScanLibrary 라이브러리 스캔
func (s *Scanner) ScanLibrary(ctx context.Context, library *model.Library) (result *ScanResult, err error) {
	// 시스템 라이브러리는 스캔하지 않음
	if library.Type == "SYSTEM" {
		return &ScanResult{}, nil
	}

	result = &ScanResult{}
	// 0. 중복 스캔 및 세마포어 체크
	if _, loaded := s.scanningCurrent.LoadOrStore(library.ID, true); loaded {
		return nil, ErrAlreadyScanning // 이미 스캔 중
	}
	defer s.scanningCurrent.Delete(library.ID)

	// 세마포어 획득 (대기)
	s.semaphore <- struct{}{}
	defer func() {
		<-s.semaphore
		// 스캔이 성공적으로 끝나지 않았을 경우 (IDLE로 업데이트되지 않았을 경우) 대비
		// named return err이 nil이 아니거나 패닉이 발생했을 때 등을 위해
		if err != nil && err != ErrAlreadyScanning {
			_ = s.libraryRepo.UpdateScanStatus(nil, library.ID, "ERROR", "스캔 중 오류 발생: "+err.Error())
		}
	}()

	// 스캔 시작 상태 업데이트
	if updateErr := s.libraryRepo.UpdateScanStatus(nil, library.ID, "SCANNING", "스캔 준비 중..."); updateErr != nil {
		log.Printf("Failed to update scan status for library %s: %v", library.ID, updateErr)
		result.Errors = append(result.Errors, updateErr.Error())
	}

	// 1. 기존 DB 시리즈 가져오기 (Map 생성)
	existingList, err := s.seriesRepo.FindByLibraryID(nil, library.ID, "")
	if err != nil {
		return nil, err
	}
	existingMap := make(map[string]*model.Series)
	for i := range existingList {
		existingMap[existingList[i].Path] = &existingList[i]
	}

	// 2. 디스크 탐색
	entries, err := os.ReadDir(library.Path)
	if err != nil {
		return nil, err
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	errChan := make(chan error, len(entries))

	// 처리된 시리즈 Path 추적 (나중에 삭제할 것 식별용)
	processedPaths := make(map[string]bool)

	// 제외 패턴 파싱 (쉼표로 구분)
	excludePatterns := strings.Split(library.ScanExcludes, ",")

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		// 제외 패턴 확인
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}

		seriesPath := filepath.Join(library.Path, entry.Name())
		processedPaths[seriesPath] = true

		wg.Add(1)
		go func(entry fs.DirEntry, path string) {
			defer wg.Done()

			if ctx.Err() != nil {
				errChan <- ctx.Err()
				return
			}
			seriesResult, err := s.processSeries(ctx, library.ID, path, entry.Name(), existingMap)
			if err != nil {
				errChan <- err
				return
			}

			mu.Lock()
			result.SeriesCount++
			result.VolumeCount += seriesResult.VolumeCount
			result.ChapterCount += seriesResult.ChapterCount
			result.PageCount += seriesResult.PageCount
			mu.Unlock()
		}(entry, seriesPath)
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		result.Errors = append(result.Errors, err.Error())
	}

	// 3. 디스크에 없는 DB 시리즈 삭제
	for path, series := range existingMap {
		if !processedPaths[path] {
			if err := s.seriesRepo.Delete(nil, series.ID); err != nil {
				result.Errors = append(result.Errors, err.Error())
			}
		}
	}

	// 완료 결과 요약 업데이트
	status := "IDLE"
	summary := "스캔 완료"
	if len(result.Errors) > 0 {
		status = "ERROR"
		summary = "스캔 완료 (일부 오류 발생)"
	}
	if updateErr := s.libraryRepo.UpdateScanStatus(nil, library.ID, status, summary); updateErr != nil {
		log.Printf("Failed to update final scan status for library %s: %v", library.ID, updateErr)
		result.Errors = append(result.Errors, updateErr.Error())
	}

	return result, nil
}

// processSeries 시리즈 처리 (생성 또는 업데이트 후 스캔)
func (s *Scanner) processSeries(ctx context.Context, libraryID, seriesPath, title string, existingMap map[string]*model.Series) (*ScanResult, error) {
	var series *model.Series

	// 폴더 수정 시간 확인
	var lastModified time.Time
	if info, err := os.Stat(seriesPath); err == nil {
		lastModified = info.ModTime()
	}

	// 기존 시리즈 확인
	if existing, ok := existingMap[seriesPath]; ok {
		series = existing
		
		// 업데이트가 필요한 경우 (FileModTime이 DB UpdatedAt보다 최신일 때)
		// 주의: "추가"된 경우를 처리하기 위해, 단순히 변경이 감지되면 업데이트
		if lastModified.After(series.UpdatedAt) {
			if err := s.seriesRepo.UpdateUpdatedAt(nil, series.ID, lastModified); err != nil {
				return nil, err
			}
			series.UpdatedAt = lastModified
		}
		
		// 기존 볼륨 삭제 (완전한 재스캔을 위해)
		if err := s.volumeRepo.DeleteBySeriesID(nil, series.ID); err != nil {
			return nil, err
		}
	} else {
		// 새 시리즈 생성
		status := "ONGOING"
		if completedRegex.MatchString(title) {
			status = "COMPLETED"
		}

		series = &model.Series{
			LibraryID: libraryID,
			Title:     title,
			Path:      seriesPath,
			Metadata: &model.SeriesMetadata{
				Status: status,
			},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(), // 새 시리즈는 현재 시간으로 설정 (최상단 노출)
		}
		if err := s.seriesRepo.Create(nil, series); err != nil {
			return nil, err
		}
	}

	return s.scanSeriesContent(ctx, series)
}

// scanSeriesContent 시리즈 내용 스캔 (볼륨, 챕터)
func (s *Scanner) scanSeriesContent(ctx context.Context, series *model.Series) (*ScanResult, error) {
	result := &ScanResult{}
	seriesPath := series.Path

	// 볼륨/챕터 탐색
	entries, err := os.ReadDir(seriesPath)
	if err != nil {
		return nil, err
	}

	// 자연 정렬
	names := make([]string, 0, len(entries))
	entryMap := make(map[string]fs.DirEntry)
	for _, entry := range entries {
		names = append(names, entry.Name())
		entryMap[entry.Name()] = entry
	}
	natsort.Sort(names)

	volumeNum := 1
	for _, name := range names {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		entry := entryMap[name]
		entryPath := filepath.Join(seriesPath, name)

		if entry.IsDir() {
			// 폴더 = 볼륨
			volResult, err := s.scanVolume(ctx, series.ID, entryPath, name, volumeNum)
			if err != nil {
				result.Errors = append(result.Errors, err.Error())
				continue
			}
			result.VolumeCount++
			result.ChapterCount += volResult.ChapterCount
			result.PageCount += volResult.PageCount
			volumeNum++
		} else if isArchive(name) {
			// 아카이브 파일 = 볼륨
			volResult, err := s.scanArchiveAsVolume(ctx, series.ID, entryPath, name, volumeNum)
			if err != nil {
				result.Errors = append(result.Errors, err.Error())
				continue
			}
			result.VolumeCount++
			result.ChapterCount += volResult.ChapterCount
			result.PageCount += volResult.PageCount
			volumeNum++
		}
	}

	return result, nil
}

// scanVolume 폴더 볼륨 스캔
func (s *Scanner) scanVolume(ctx context.Context, seriesID, volumePath, title string, volumeNum int) (*ScanResult, error) {
	result := &ScanResult{}

	// 볼륨 번호 추출 시도
	if matches := volumeNumRegex.FindStringSubmatch(title); len(matches) > 1 {
		// 정규식에서 추출된 번호 사용
	}

	volume := &model.Volume{
		SeriesID:     seriesID,
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         volumePath,
	}
	if err := s.volumeRepo.Create(nil, volume); err != nil {
		return nil, err
	}

	// 볼륨 내 파일 탐색
	entries, err := os.ReadDir(volumePath)
	if err != nil {
		return nil, err
	}

	// 이미지 파일들을 챕터로
	var imageFiles []string
	var subDirs []string

	for _, entry := range entries {
		if entry.IsDir() {
			subDirs = append(subDirs, entry.Name())
		} else if isImage(entry.Name()) {
			imageFiles = append(imageFiles, entry.Name())
		}
	}

	if len(subDirs) > 0 {
		// 서브 디렉토리가 있으면 각각 챕터로
		natsort.Sort(subDirs)
		for i, subDir := range subDirs {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			chapterPath := filepath.Join(volumePath, subDir)
			pageCount, err := s.scanChapter(volume.ID, chapterPath, subDir, i+1)
			if err != nil {
				result.Errors = append(result.Errors, err.Error())
				continue
			}
			result.ChapterCount++
			result.PageCount += pageCount
		}
	} else if len(imageFiles) > 0 {
		// 이미지만 있으면 단일 챕터
		pageCount, err := s.scanImagesAsChapter(volume.ID, volumePath, title, 1, imageFiles)
		if err != nil {
			return nil, err
		}
		result.ChapterCount++
		result.PageCount += pageCount
	}

	return result, nil
}

// scanArchiveAsVolume 아카이브를 볼륨으로 스캔
func (s *Scanner) scanArchiveAsVolume(ctx context.Context, seriesID, archivePath, filename string, volumeNum int) (*ScanResult, error) {
	result := &ScanResult{}

	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	volume := &model.Volume{
		SeriesID:     seriesID,
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         archivePath,
	}
	if err := s.volumeRepo.Create(nil, volume); err != nil {
		return nil, err
	}

	// ZIP 파일 열기
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	// 이미지 파일들 추출
	var imageFiles []string
	for _, f := range r.File {
		if !f.FileInfo().IsDir() && isImage(f.Name) {
			imageFiles = append(imageFiles, f.Name)
		}
	}

	// 자연 정렬
	natsort.Sort(imageFiles)

	// 단일 챕터로 생성
	chapter := &model.Chapter{
		VolumeID:      volume.ID,
		Title:         title,
		ChapterNumber: 1,
		Path:          archivePath,
		PageCount:     len(imageFiles),
	}
	if err := s.chapterRepo.Create(nil, chapter); err != nil {
		return nil, err
	}

	// 페이지 생성
	pages := make([]model.Page, len(imageFiles))
	for i, imgPath := range imageFiles {
		pages[i] = model.Page{
			ID:         uuid.New().String(),
			ChapterID:  chapter.ID,
			PageNumber: i + 1,
			Path:       imgPath, // ZIP 내부 경로
		}
	}
	if err := s.pageRepo.CreateBatch(nil, pages); err != nil {
		return nil, err
	}

	result.ChapterCount = 1
	result.PageCount = len(imageFiles)

	return result, nil
}

// scanChapter 폴더를 챕터로 스캔
func (s *Scanner) scanChapter(volumeID, chapterPath, title string, chapterNum int) (int, error) {
	entries, err := os.ReadDir(chapterPath)
	if err != nil {
		return 0, err
	}

	var imageFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && isImage(entry.Name()) {
			imageFiles = append(imageFiles, entry.Name())
		}
	}

	return s.scanImagesAsChapter(volumeID, chapterPath, title, chapterNum, imageFiles)
}

// scanImagesAsChapter 이미지들을 챕터로 스캔
func (s *Scanner) scanImagesAsChapter(volumeID, basePath, title string, chapterNum int, imageFiles []string) (int, error) {
	natsort.Sort(imageFiles)

	chapter := &model.Chapter{
		VolumeID:      volumeID,
		Title:         title,
		ChapterNumber: chapterNum,
		Path:          basePath,
		PageCount:     len(imageFiles),
	}
	if err := s.chapterRepo.Create(nil, chapter); err != nil {
		return 0, err
	}

	// 페이지 생성
	pages := make([]model.Page, len(imageFiles))
	for i, imgFile := range imageFiles {
		pages[i] = model.Page{
			ID:         uuid.New().String(),
			ChapterID:  chapter.ID,
			PageNumber: i + 1,
			Path:       filepath.Join(basePath, imgFile),
		}
	}
	if err := s.pageRepo.CreateBatch(nil, pages); err != nil {
		return 0, err
	}

	return len(imageFiles), nil
}

// isImage 이미지 파일 여부 확인
func isImage(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return imageExtensions[ext]
}

// isArchive 아카이브 파일 여부 확인
func isArchive(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return archiveExtensions[ext]
}
