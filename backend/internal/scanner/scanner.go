package scanner

import (
	"archive/zip"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/facette/natsort"
	"github.com/google/uuid"
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

type Scanner struct {
	libraryRepo *repository.LibraryRepository
	seriesRepo  *repository.SeriesRepository
	volumeRepo  *repository.VolumeRepository
	chapterRepo *repository.ChapterRepository
	pageRepo    *repository.PageRepository
}

func NewScanner(
	libraryRepo *repository.LibraryRepository,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
) *Scanner {
	return &Scanner{
		libraryRepo: libraryRepo,
		seriesRepo:  seriesRepo,
		volumeRepo:  volumeRepo,
		chapterRepo: chapterRepo,
		pageRepo:    pageRepo,
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
func (s *Scanner) ScanLibrary(library *model.Library) (*ScanResult, error) {
	result := &ScanResult{}

	// 기존 데이터 삭제 (재스캔)
	if err := s.seriesRepo.DeleteByLibraryID(library.ID); err != nil {
		return nil, err
	}

	// 시리즈 폴더 탐색 (1단계 깊이)
	entries, err := os.ReadDir(library.Path)
	if err != nil {
		return nil, err
	}

	var wg sync.WaitGroup
	var mu sync.Mutex
	errChan := make(chan error, len(entries))

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		wg.Add(1)
		go func(entry fs.DirEntry) {
			defer wg.Done()

			seriesPath := filepath.Join(library.Path, entry.Name())
			seriesResult, err := s.scanSeries(library.ID, seriesPath, entry.Name())
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
		}(entry)
	}

	wg.Wait()
	close(errChan)

	for err := range errChan {
		result.Errors = append(result.Errors, err.Error())
	}

	// 스캔 시간 업데이트
	if err := s.libraryRepo.UpdateLastScanned(library.ID); err != nil {
		result.Errors = append(result.Errors, err.Error())
	}

	return result, nil
}

// scanSeries 시리즈 스캔
func (s *Scanner) scanSeries(libraryID, seriesPath, title string) (*ScanResult, error) {
	result := &ScanResult{}

	// 시리즈 생성
	series := &model.Series{
		LibraryID: libraryID,
		Title:     title,
		Path:      seriesPath,
	}
	if err := s.seriesRepo.Create(series); err != nil {
		return nil, err
	}

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
		entry := entryMap[name]
		entryPath := filepath.Join(seriesPath, name)

		if entry.IsDir() {
			// 폴더 = 볼륨
			volResult, err := s.scanVolume(series.ID, entryPath, name, volumeNum)
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
			volResult, err := s.scanArchiveAsVolume(series.ID, entryPath, name, volumeNum)
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
func (s *Scanner) scanVolume(seriesID, volumePath, title string, volumeNum int) (*ScanResult, error) {
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
	if err := s.volumeRepo.Create(volume); err != nil {
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
func (s *Scanner) scanArchiveAsVolume(seriesID, archivePath, filename string, volumeNum int) (*ScanResult, error) {
	result := &ScanResult{}

	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	volume := &model.Volume{
		SeriesID:     seriesID,
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         archivePath,
	}
	if err := s.volumeRepo.Create(volume); err != nil {
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
	if err := s.chapterRepo.Create(chapter); err != nil {
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
	if err := s.pageRepo.CreateBatch(pages); err != nil {
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
	if err := s.chapterRepo.Create(chapter); err != nil {
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
	if err := s.pageRepo.CreateBatch(pages); err != nil {
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
