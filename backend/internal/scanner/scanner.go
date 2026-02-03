package scanner

import (
	"archive/zip"
	"context"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"

	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/facette/natsort"
	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
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

// 지원하는 오디오 확장자
var audioExtensions = map[string]bool{
	".mp3": true, ".wav": true, ".ogg": true, ".flac": true, ".m4a": true,
}

// 완결 여부 확인을 위한 정규식
var (
	completedRegex = regexp.MustCompile(`(?i)(_완|\[완결\]|\(완결\)|\(완\)|완결)$`)
	
	// 볼륨 파싱 정규식 (Global Compile)
	reVolKorean = regexp.MustCompile(`(\d+)\s*(권|회|화)`)
	reVolPrefix = regexp.MustCompile(`(?i)(?:v|vol\.?|volume)\s*(\d+)`)
	reVolChapter = regexp.MustCompile(`(?i)(?:c|ch\.?|chapter)\s*(\d+)`)
	reVolSuffix = regexp.MustCompile(`(?:^|[\s\-_\[\(])(\d+)(?:$|[\s\-_\]\)])`)
)

func isExcluded(name string, patterns []string) bool {
	// 기본 제외 대상 (NAS 시스템 폴더 등)
	defaultExcludes := []string{"@eaDir", "#recycle", ".DS_Store", "Thumbs.db", ".git", ".idea"}
	for _, de := range defaultExcludes {
		if name == de {
			return true
		}
	}

	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		// 대소문자 무시 매칭을 위해 소문자로 변환하여 비교 시도
		matched, _ := filepath.Match(strings.ToLower(pattern), strings.ToLower(name))
		if matched {
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
	settingRepo repository.SettingRepository
	config      *config.Config // Config 의존성 추가

	// 동시성 제어
	maxConcurrentScans int
	semaphore          chan struct{}
	scanningCurrent    sync.Map // map[string]bool (libraryID)
	mu                 sync.Mutex

	// 스케줄러 및 감시자
	schedulerTicker *time.Ticker
	schedulerStop   chan struct{}
	watcher         *fsnotify.Watcher
	watcherStop     chan struct{}
	watchedLibs     sync.Map // map[string]string (libraryID -> path)

	// 폴링 폴백 (WSL/네트워크 드라이브 대비)
	fallbackTicker *time.Ticker
	fallbackStop   chan struct{}

	// 스캔 취소 관리
	scanCancelFuncs sync.Map // map[string]context.CancelFunc (libraryID)
}

type scanPerfConfig struct {
	SeriesConcurrent int
	VolumeConcurrent int
	ImageConcurrent  int
}

func (s *Scanner) getPerfConfig() scanPerfConfig {
	level := 2 // Default
	if s.settingRepo != nil {
		if setting, err := s.settingRepo.GetByKey(nil, "scan_performance_level"); err == nil && setting != nil {
			_, _ = fmt.Sscanf(setting.Value, "%d", &level)
		}
	}

	switch level {
	case 1: // 저사양 (Low)
		return scanPerfConfig{SeriesConcurrent: 1, VolumeConcurrent: 2, ImageConcurrent: 2}
	case 4: // 고성능 (터보)
		// SSD 및 고성능 CPU 권장
		// Lazy Analysis 도입으로 ImageConcurrent는 스캔 시 사용되지 않으나,
		// 아카이브 내 이미지 병렬 처리 등 향후 사용을 위해 높은 값 유지
		return scanPerfConfig{SeriesConcurrent: 3, VolumeConcurrent: 8, ImageConcurrent: 8}
	case 2: // 권장 (Default)
		fallthrough
	default:
		return scanPerfConfig{SeriesConcurrent: 2, VolumeConcurrent: 4, ImageConcurrent: 4}
	}
}

func NewScanner(
	libraryRepo *repository.LibraryRepository,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
	settingRepo repository.SettingRepository,
	cfg *config.Config, // Config 파라미터 추가
) *Scanner {
	maxConcurrent := 2 // 기본값 2
	return &Scanner{
		libraryRepo:        libraryRepo,
		seriesRepo:         seriesRepo,
		volumeRepo:         volumeRepo,
		chapterRepo:        chapterRepo,
		pageRepo:           pageRepo,
		settingRepo:        settingRepo,
		config:             cfg, // Config 초기화
		maxConcurrentScans: maxConcurrent,
		semaphore:          make(chan struct{}, maxConcurrent),
	}
}

// ScanResult 스캔 결과
type ScanResult struct {
	SeriesCount  int      `json:"series_count"`
	VolumeCount  int      `json:"volume_count"`
	ChapterCount int      `json:"chapter_count"`
	PageCount    int      `json:"page_count"`
	Errors       []string `json:"errors,omitempty"`
}

// DTOs for Two-Phase Scanning (Analyze -> Save)
type scannedPage struct {
	PageNumber int
	Path       string
	Width      int
	Height     int
}

type scannedChapter struct {
	Title         string
	ChapterNumber int
	Path          string
	Pages         []scannedPage
}

type scannedVolume struct {
	Title        string
	VolumeNumber int
	Path         string
	ModTime      time.Time
	HasAudio     bool
	Unit         string // "volume" or "chapter"
	Chapters     []scannedChapter
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

	// 취소 가능한 컨텍스트 생성
	scanCtx, cancel := context.WithCancel(ctx)
	s.scanCancelFuncs.Store(library.ID, cancel)
	defer func() {
		cancel()
		s.scanCancelFuncs.Delete(library.ID)
	}()

	// 세마포어 획득 (대기)
	s.semaphore <- struct{}{}
	defer func() {
		<-s.semaphore
		// 스캔이 성공적으로 끝나지 않았을 경우 (IDLE로 업데이트되지 않았을 경우) 대비
		// named return err이 nil이 아니거나 패닉이 발생했을 때 등을 위해
		if err != nil && err != ErrAlreadyScanning {
			status := "ERROR"
			summary := "스캔 중 오류 발생: " + err.Error()

			// 사용자가 강제로 취소한 경우 정상 취소로 처리
			if err == context.Canceled {
				status = "IDLE"
				summary = "스캔 취소됨"
			}

			if updateErr := s.libraryRepo.UpdateScanStatus(nil, library.ID, status, summary); updateErr != nil {
				log.Printf("Failed to update status for library %s: %v", library.ID, updateErr)
			}
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

	// 처리할 항목 수 계산 (진행률 표시용)
	var totalItems int
	var processedItems int32 // atomic 연산용
	for _, entry := range entries {
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}
		if entry.IsDir() || isArchive(entry.Name()) {
			totalItems++
		}
	}

	// 3. 성능 설정 로드
	perf := s.getPerfConfig()

	// 시리즈 레벨 동시성 제어
	seriesSemaphore := make(chan struct{}, perf.SeriesConcurrent)

	for _, entry := range entries {
		// 컨텍스트 취소 확인
		select {
		case <-scanCtx.Done():
			return result, scanCtx.Err()
		default:
		}
		// 제외 패턴 확인
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}

		entryPath := filepath.Join(library.Path, entry.Name())

		if entry.IsDir() {
			// 폴더 → 시리즈로 처리
			mu.Lock()
			processedPaths[entryPath] = true
			mu.Unlock()

			wg.Add(1)
			go func(entry fs.DirEntry, path string) {
				defer wg.Done()

				// 세마포어 획득
				select {
				case seriesSemaphore <- struct{}{}:
					defer func() { <-seriesSemaphore }()
				case <-scanCtx.Done():
					return
				}

				if scanCtx.Err() != nil {
					errChan <- scanCtx.Err()
					return
				}

				// 진행률 업데이트 함수
				updateProgress := func(detail string) {
					current := atomic.LoadInt32(&processedItems)
					percent := 0
					if totalItems > 0 {
						percent = int((float64(current) / float64(totalItems)) * 100)
					}
					// 현재 시리즈 처리 전이므로, processedItems는 아직 증가하지 않았음.
					// 하지만 사용자 경험상 현재 처리 중인 항목의 %는 "이전까지 완료된 개수 / 전체 개수"로 보는 게 자연스러울 수 있음.
					// 또는 processedItems를 증가시키기 전이니 현재값 그대로 쓰면 됨.
					if updateErr := s.libraryRepo.UpdateScanProgress(nil, library.ID, detail, percent); updateErr != nil {
						log.Printf("Failed to update progress for library %s: %v", library.ID, updateErr)
					}
				}

				// 초기 진행 상태 업데이트 (시리즈 시작)
				updateProgress(entry.Name())

				seriesResult, err := s.processSeries(ctx, library.ID, path, entry.Name(), existingMap, excludePatterns, updateProgress, perf)
				if err != nil {
					errChan <- err
					return
				}

				// 처리 완료 카운트 증가
				atomic.AddInt32(&processedItems, 1)

				mu.Lock()
				result.SeriesCount++
				result.VolumeCount += seriesResult.VolumeCount
				result.ChapterCount += seriesResult.ChapterCount
				result.PageCount += seriesResult.PageCount
				mu.Unlock()
			}(entry, entryPath)
		} else if isArchive(entry.Name()) {
			// zip/cbz 파일 → 단일 볼륨 시리즈로 처리
			mu.Lock()
			processedPaths[entryPath] = true
			mu.Unlock()

			wg.Add(1)
			go func(entry fs.DirEntry, path string) {
				defer wg.Done()

				// 세마포어 획득
				select {
				case seriesSemaphore <- struct{}{}:
					defer func() { <-seriesSemaphore }()
				case <-scanCtx.Done():
					return
				}

				if scanCtx.Err() != nil {
					errChan <- scanCtx.Err()
					return
				}

				// 진행률 업데이트 함수
				updateProgress := func(detail string) {
					current := atomic.LoadInt32(&processedItems)
					percent := 0
					if totalItems > 0 {
						percent = int((float64(current) / float64(totalItems)) * 100)
					}
					if updateErr := s.libraryRepo.UpdateScanProgress(nil, library.ID, detail, percent); updateErr != nil {
						log.Printf("Failed to update progress for library %s: %v", library.ID, updateErr)
					}
				}

				updateProgress(entry.Name())

				updateProgress(entry.Name())

				seriesResult, err := s.processArchiveAsSeries(scanCtx, library.ID, path, entry.Name(), existingMap)
				if err != nil {
					errChan <- err
					return
				}

				// 처리 완료 카운트 증가
				atomic.AddInt32(&processedItems, 1)

				mu.Lock()
				result.SeriesCount++
				result.VolumeCount += seriesResult.VolumeCount
				result.ChapterCount += seriesResult.ChapterCount
				result.PageCount += seriesResult.PageCount
				mu.Unlock()
			}(entry, entryPath)
		}
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
	if strings.HasPrefix(library.Path, "/mnt/") {
		summary += " (WSL/NTFS: 실시간 감시 제한적)"
	}
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

// CancelScan 진행 중인 스캔 취소. 취소가 수행되었으면 true, 진행 중인 스캔이 없었으면 false 반환.
func (s *Scanner) CancelScan(libraryID string) bool {
	if cancel, ok := s.scanCancelFuncs.Load(libraryID); ok {
		if cancelFunc, ok := cancel.(context.CancelFunc); ok {
			cancelFunc()
			log.Printf("[SCANNER] Scan for library %s has been canceled.", libraryID)
			return true
		}
	}
	return false
}

// StartScheduler 스캔 스케줄러 시작
func (s *Scanner) StartScheduler(intervalMinutes int) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.stopSchedulerLocked() // 기존 스케줄러 중지

	if intervalMinutes <= 0 {
		return
	}

	s.schedulerTicker = time.NewTicker(time.Duration(intervalMinutes) * time.Minute)
	s.schedulerStop = make(chan struct{})

	go func() {
		log.Printf("Scan scheduler started (interval: %d min)", intervalMinutes)
		for {
			s.mu.Lock()
			ticker := s.schedulerTicker
			stop := s.schedulerStop
			s.mu.Unlock()

			if ticker == nil || stop == nil {
				return
			}

			select {
			case <-ticker.C:
				log.Println("Scheduled scan started")
				// 모든 라이브러리 스캔
				libraries, err := s.libraryRepo.FindAll(nil)
				if err != nil {
					log.Printf("Scheduler failed to fetch libraries: %v", err)
					continue
				}
				for _, lib := range libraries {
					// 각 라이브러리 스캔은 별도 고루틴에서 비동기 실행 (세마포어로 제어됨)
					go func(l model.Library) {
						if _, err := s.ScanLibrary(context.Background(), &l); err != nil {
							// 에러 로그는 ScanLibrary 내부에서 처리됨 (상태 업데이트 등)
							if err != ErrAlreadyScanning {
								log.Printf("Scheduled scan error for %s: %v", l.Name, err)
							}
						}
					}(lib)
				}
			case <-stop:
				log.Println("Scan scheduler stopped")
				return
			}
		}
	}()
}

// StopScheduler 스캔 스케줄러 중지
func (s *Scanner) StopScheduler() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopSchedulerLocked()
}

func (s *Scanner) stopSchedulerLocked() {
	if s.schedulerTicker != nil {
		s.schedulerTicker.Stop()
		s.schedulerTicker = nil
	}
	if s.schedulerStop != nil {
		close(s.schedulerStop)
		s.schedulerStop = nil
	}
}

// StartWatcher 실시간 파일 감시 시작
func (s *Scanner) StartWatcher() error {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.stopWatcherLocked() // 기존 감시자 중지

	// 폴링 폴백 시작
	s.startFallbackPollingLocked()

	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		s.stopFallbackPollingLocked()
		return err
	}
	s.watcher = watcher
	s.watcherStop = make(chan struct{})

	// 모든 로컬 라이브러리 경로 추가
	libraries, err := s.libraryRepo.FindAll(nil)
	if err != nil {
		_ = watcher.Close()
		s.stopFallbackPollingLocked()
		return err
	}

	for _, lib := range libraries {
		if lib.Type == "LOCAL" {
			log.Printf("Starting watch for library %s: %s", lib.Name, lib.Path)
			if err := s.addWatchRecursive(watcher, lib.Path); err != nil {
				log.Printf("Failed to watch %s: %v", lib.Path, err)
				continue
			}
			s.watchedLibs.Store(lib.ID, lib.Path)
		}
	}

	go func() {
		log.Println("Real-time file watcher started")
		defer func() { _ = watcher.Close() }()

		// 변경 사항 디바운싱을 위한 타이머
		// 키: 라이브러리 ID, 값: 타이머
		debounceTimers := make(map[string]*time.Timer)
		var mu sync.Mutex

		triggerScan := func(libraryID string) {
			mu.Lock()
			if t, ok := debounceTimers[libraryID]; ok {
				t.Stop()
			}
			debounceTimers[libraryID] = time.AfterFunc(5*time.Second, func() {
				// 디바운스 후 스캔 실행
				mu.Lock()
				delete(debounceTimers, libraryID)
				mu.Unlock()

				lib, err := s.libraryRepo.FindByID(nil, libraryID)
				if err != nil {
					return
				}
				if lib == nil {
					return
				}
				log.Printf("[SCANNER] Detected changes in library '%s' (%s), starting scan...", lib.Name, lib.ID)
				if _, err := s.ScanLibrary(context.Background(), lib); err != nil {
					if err != ErrAlreadyScanning {
						log.Printf("[SCANNER] Work scan error for %s: %v", lib.Name, err)
					}
				}
			})
			mu.Unlock()
		}

		for {
			select {
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				// 시스템 파일 무시
				if strings.HasPrefix(filepath.Base(event.Name), ".") {
					continue
				}

				// log.Printf("Watcher event: %v", event) // 디버그용 (필요시 활성화)

				// 관련 이벤트만 처리 (Create, Write, Remove, Rename, Chmod)
				if event.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Remove|fsnotify.Rename|fsnotify.Chmod) != 0 {
					// 해당 파일이 속한 라이브러리 찾기
					s.watchedLibs.Range(func(key, value any) bool {
						libID, _ := key.(string)
						libPath, _ := value.(string)

						if strings.HasPrefix(event.Name, libPath) {
							log.Printf("[SCANNER] Event match for library (ID:%s, Path:%s): %s %s", libID, libPath, event.Name, event.Op)

							// 새 디렉토리가 생성되거나 이동되어 들어오면 감시 목록에 추가
							if event.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
								info, err := os.Stat(event.Name)
								if err == nil && info.IsDir() {
									log.Printf("[SCANNER] New directory detected, adding recursively: %s", event.Name)
									if err := s.addWatchRecursive(watcher, event.Name); err != nil {
										log.Printf("Failed to add watch recursive for %s: %v", event.Name, err)
									}
								}
							}
							triggerScan(libID)
						}
						return true
					})
				}
			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("Watcher error: %v", err)
			case <-s.watcherStop:
				log.Println("Real-time file watcher stopped")
				return
			}
		}
	}()

	return nil
}

// AddLibraryWatch 새 라이브러리 감시 추가
func (s *Scanner) AddLibraryWatch(libID, path string) error {
	s.watchedLibs.Store(libID, path)
	if s.watcher != nil {
		log.Printf("Dynamically adding watch for library %s", path)
		return s.addWatchRecursive(s.watcher, path)
	}
	return nil
}

// RemoveLibraryWatch 라이브러리 감시 제거
func (s *Scanner) RemoveLibraryWatch(libID string) {
	if path, ok := s.watchedLibs.LoadAndDelete(libID); ok {
		if s.watcher != nil {
			log.Printf("Removing watch for library %s", path)
			if p, ok := path.(string); ok {
				_ = s.watcher.Remove(p)
			}
		}
	}
}

// StopWatcher 실시간 파일 감시 중지
func (s *Scanner) StopWatcher() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopWatcherLocked()
}

func (s *Scanner) stopWatcherLocked() {
	if s.watcher != nil {
		if s.watcherStop != nil {
			close(s.watcherStop) // 고루틴 종료 신호
			s.watcherStop = nil
		}
		// watcher.Close()는 고루틴 내부에서 defer로 호출되거나 명시적으로 호출
		// 여기서 닫으면 Events 채널이 닫혀 고루틴 종료됨
		_ = s.watcher.Close()
		s.watcher = nil
	}
	s.stopFallbackPollingLocked()
}

// startFallbackPollingLocked starts the fallback polling timer.
func (s *Scanner) startFallbackPollingLocked() {
	s.stopFallbackPollingLocked()

	// 10분마다 실행
	s.fallbackTicker = time.NewTicker(10 * time.Minute)
	s.fallbackStop = make(chan struct{})

	go func() {
		log.Println("[SCANNER] Fallback polling started (interval: 10m)")
		for {
			s.mu.Lock()
			ticker := s.fallbackTicker
			stop := s.fallbackStop
			s.mu.Unlock()

			if ticker == nil || stop == nil {
				return
			}

			select {
			case <-ticker.C:
				s.watchedLibs.Range(func(key, value any) bool {
					libID, _ := key.(string)
					libPath, _ := value.(string)

					// /mnt/ 로 시작하는 경로는 WSL 환경에서 Windows 파일 시스템일 가능성이 큼
					if strings.HasPrefix(libPath, "/mnt/") {
						log.Printf("[SCANNER] Fallback poll triggering for limited filesystem: %s", libPath)
						lib, err := s.libraryRepo.FindByID(nil, libID)
						if err == nil && lib != nil {
							go func(targetLib *model.Library) {
								_, _ = s.ScanLibrary(context.Background(), targetLib)
							}(lib)
						}
					}
					return true
				})
			case <-stop:
				log.Println("[SCANNER] Fallback polling stopped")
				return
			}
		}
	}()
}

// stopFallbackPollingLocked stops the fallback polling timer.
func (s *Scanner) stopFallbackPollingLocked() {
	if s.fallbackTicker != nil {
		s.fallbackTicker.Stop()
		s.fallbackTicker = nil
	}
	if s.fallbackStop != nil {
		close(s.fallbackStop)
		s.fallbackStop = nil
	}
}

// addWatchRecursive 재귀적으로 폴더 감시 추가
func (s *Scanner) addWatchRecursive(watcher *fsnotify.Watcher, path string) error {
	return filepath.WalkDir(path, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil // 권한 문제 등으로 접근 불가해도 계속 진행
		}
		if d.IsDir() {
			// 숨김 폴더 제외
			if strings.HasPrefix(d.Name(), ".") && p != path {
				return filepath.SkipDir
			}
			return watcher.Add(p)
		}
		return nil
	})
}

// processArchiveAsSeries 루트 레벨의 아카이브 파일을 단일 볼륨 시리즈로 처리
func (s *Scanner) processArchiveAsSeries(ctx context.Context, libraryID, archivePath, filename string, existingMap map[string]*model.Series) (*ScanResult, error) {
	// 트랜잭션 시작
	tx, err := database.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to start transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var series *model.Series
	result := &ScanResult{}

	// 파일명에서 확장자 제거하여 시리즈 제목 생성
	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	// 파일 수정 시간 확인
	var lastModified time.Time
	info, iErr := os.Stat(archivePath)
	if iErr != nil {
		return nil, iErr
	}
	lastModified = info.ModTime()

	// 기존 시리즈 확인 (경로로 매칭)
	if existing, ok := existingMap[archivePath]; ok {
		series = existing

		// 업데이트가 필요한 경우
		if lastModified.After(series.UpdatedAt) {
			if sErr := s.seriesRepo.UpdateUpdatedAt(tx, series.ID, lastModified); sErr != nil {
				return nil, sErr
			}
			series.UpdatedAt = lastModified

			// 기존 볼륨 삭제 (재스캔)
			if vErr := s.volumeRepo.DeleteBySeriesID(tx, series.ID); vErr != nil {
				return nil, vErr
			}
		} else {
			// 변경 없음 -> 스캔 건너뛰기
			return &ScanResult{}, nil
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
			Path:      archivePath,
			Metadata: &model.SeriesMetadata{
				Status: status,
			},
			CreatedAt: time.Now(),
			UpdatedAt: time.Now(),
		}
		if cErr := s.seriesRepo.Create(tx, series); cErr != nil {
			return nil, cErr
		}
	}

	// 아카이브를 단일 볼륨으로 스캔 (분석)
	volData, err := s.analyzeArchiveAsVolume(archivePath, title, 1, "volume")
	if err != nil {
		return nil, err
	}

	// 저장
	saveRes, err := s.saveVolume(tx, series.ID, volData)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	result.VolumeCount = saveRes.VolumeCount
	result.ChapterCount = saveRes.ChapterCount
	result.PageCount = saveRes.PageCount

	return result, nil
}

// processSeries 시리즈 처리 (생성 또는 업데이트 후 스캔)
func (s *Scanner) processSeries(ctx context.Context, libraryID, seriesPath, title string, existingMap map[string]*model.Series, excludePatterns []string, onProgress func(string), perf scanPerfConfig) (*ScanResult, error) {
	var series *model.Series

	// 폴더 수정 시간 확인
	var lastModified time.Time
	info, err := os.Stat(seriesPath)
	if err != nil {
		return nil, err
	}
	lastModified = info.ModTime()

	// 기존 시리즈 확인
	if existing, ok := existingMap[seriesPath]; ok {
		series = existing

		// 시리즈 정보 업데이트 (Timestamp만 갱신)
		if lastModified.After(series.UpdatedAt) {
			if err := s.seriesRepo.UpdateUpdatedAt(nil, series.ID, lastModified); err != nil {
				return nil, err
			}
			series.UpdatedAt = lastModified
		}
		// 시리즈 폴더가 변경되지 않았더라도, 내부 내용은 확인해야 함 (삭제된 파일 등)
		// 하지만 성능을 위해 상위에서 걸러낼 수도 있음. 일단은 진입.
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

		// 해시 기반 썸네일 확인 및 연결
		hash := md5.Sum([]byte(seriesPath))
		hashString := hex.EncodeToString(hash[:])
		exts := []string{".jpg", ".png", ".webp", ".gif"}
		var foundThumbnailPath string
		
		thumbnailsDir := filepath.Join(s.config.DataDir, "thumbnails", "series")
		for _, ext := range exts {
			checkPath := filepath.Join(thumbnailsDir, hashString+ext)
			if _, err := os.Stat(checkPath); err == nil {
				foundThumbnailPath = checkPath
				break
			}
		}

		if foundThumbnailPath != "" {
			series.ThumbnailPath = &foundThumbnailPath
			log.Printf("[SCANNER] Linked existing thumbnail for series %s: %s", title, foundThumbnailPath)
		}
		if err := s.seriesRepo.Create(nil, series); err != nil {
			return nil, err
		}

		// ThumbnailURL은 고유한 ID(Create 호출 시 생성됨)가 필요함
		if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
			url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", series.ID, time.Now().Unix())
			series.ThumbnailURL = &url
		}
	}

	return s.scanSeriesContent(ctx, series, excludePatterns, onProgress, perf)
}

// scanSeriesContent 시리즈 내용 스캔 (볼륨, 챕터) - Incremental Scan 적용
func (s *Scanner) scanSeriesContent(ctx context.Context, series *model.Series, excludePatterns []string, onProgress func(string), perf scanPerfConfig) (*ScanResult, error) {
	result := &ScanResult{}
	seriesPath := series.Path

	// 1. 기존 DB 볼륨 가져오기
	existingVolumes, err := s.volumeRepo.FindBySeriesID(nil, series.ID)
	if err != nil {
		return nil, err
	}
	existingVolMap := make(map[string]*model.Volume)
	for i := range existingVolumes {
		existingVolMap[existingVolumes[i].Path] = &existingVolumes[i]
	}

	// 2. 디스크 탐색
	entries, err := os.ReadDir(seriesPath)
	if err != nil {
		return nil, err
	}

	// 자연 정렬 및 전처리 (제외 대상 미리 제거)
	names := make([]string, 0, len(entries))
	entryMap := make(map[string]fs.DirEntry)
	for _, entry := range entries {
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}
		// 디렉토리 또는 아카이브 파일만 처리 (mp3, txt 등 비지원 파일 무시)
		if !entry.IsDir() && !isArchive(entry.Name()) {
			continue
		}
		names = append(names, entry.Name())
		entryMap[entry.Name()] = entry
	}
	natsort.Sort(names) // 순서 보장

	// 처리된 Path 추적 (삭제 대상 식별용)
	processedPaths := make(map[string]bool)

	// 2.1. 볼륨 번호 사전 계산 (Monotonic Assignment Strategy)
	// 파일명 자연 정렬 순서(natsort)를 최우선으로 하여, 볼륨 번호가 역전되거나 중복되지 않도록 강제 할당합니다.
	volNumMap := make(map[string]int)
	volUnitMap := make(map[string]string) // Store unit type
	lastVolNum := -1 // 0번 볼륨(Prologue) 허용을 위해 -1부터 시작

	for _, name := range names {
		displayName := strings.TrimSuffix(name, filepath.Ext(name))
		
		parsedNum := 0
		parsedUnit := "volume"
		// 0번 볼륨도 유효한 번호로 인정
		if num, unit, ok := parseVolumeNumber(displayName); ok {
			parsedNum = num
			parsedUnit = unit
		}

		// 할당할 번호 결정 (Strategy: Monotonic)
		assignNum := 0
		if parsedNum > lastVolNum {
			assignNum = parsedNum
		} else {
			assignNum = lastVolNum + 1
		}

		volNumMap[name] = assignNum
		volUnitMap[name] = parsedUnit
		lastVolNum = assignNum
	}

	// 2.2. 볼륨 처리 (Producer-Consumer Pipeline)
	type job struct {
		name  string
	}

	jobChan := make(chan job, len(names))
	resultChan := make(chan *scannedVolume, len(names))
	// errLogChan 제거: 직접 result.Errors에 append

	// 2.3. 오디오 파일 스캔 (Pre-scan for Audio Indicator)
	// 동일 디렉토리 내에 볼륨과 같은 이름의 오디오 파일이 있는지 확인
	audioFiles := make(map[string]bool)
	for _, entry := range entries {
		if !entry.IsDir() && isAudio(entry.Name()) {
			nameWithoutExt := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
			audioFiles[nameWithoutExt] = true
		}
	}

	var wg sync.WaitGroup
	var mu sync.Mutex

	// 작업 큐 채우기 (이미 필터링됨)
	for _, name := range names {
		jobChan <- job{name: name}
	}
	close(jobChan)

	// Producer: Worker Pool (Analyze)
	wg.Add(perf.VolumeConcurrent)
	for w := 0; w < perf.VolumeConcurrent; w++ {
		go func() {
			defer wg.Done()
			for j := range jobChan {
				if ctx.Err() != nil {
					return
				}

				entryPath := filepath.Join(seriesPath, j.name)

				mu.Lock()
				processedPaths[entryPath] = true
				mu.Unlock()

				var volResult *scannedVolume
				var err error

				entry := entryMap[j.name]

				// 볼륨 번호 및 제목 결정
				displayName := strings.TrimSuffix(j.name, filepath.Ext(j.name))
				
				// 사전 계산된 볼륨 번호 및 단위 사용
				volNum := volNumMap[j.name]
				volUnit := volUnitMap[j.name]

				// 1. 증분 스캔 체크 (Producer 단계에서 1차 필터링)
				// 파일 시스템 메타데이터를 조회하여 변경 여부를 판단
				info, statErr := os.Stat(entryPath)
				if statErr != nil {
					// 파일 정보를 못 얻으면 최신으로 간주하고 진행
					mu.Lock()
					result.Errors = append(result.Errors, fmt.Sprintf("failed to stat %s: %v", entryPath, statErr))
					mu.Unlock()
				} else {
					modTime := info.ModTime()
					// 기존 볼륨 정보 확인 (기존 맵은 메인 스레드에서 생성되었으므로 읽기 안전)
					if existingVol, ok := existingVolMap[entryPath]; ok {
						// DB의 UpdatedAt이 파일의 ModTime보다 이후거나 같으면 변경 없음으로 간주
						// (OS ModTime 정밀도 고려하여 After로 체크, 같으면 스킵)
						// 단, 볼륨 번호가 변경된 경우(파서 로직 변경 등)는 강제 업데이트
						if !modTime.After(existingVol.UpdatedAt) {
							if existingVol.VolumeNumber == volNum && existingVol.Unit == volUnit {
								// 변경되지 않음 -> 분석 스킵
								// 하지만 processedPaths에는 이미 추가되었으므로 삭제되지 않음.
								continue
							}
							log.Printf("[SCANNER] Force update for %s: VolumeNumber/Unit changed (%d/%s -> %d/%s)", j.name, existingVol.VolumeNumber, existingVol.Unit, volNum, volUnit)
						}
					}
				}
				
				if volNum == 0 {
					displayName = "프롤로그"
				}

				if entry.IsDir() {
					volResult, err = s.analyzeVolume(entryPath, displayName, volNum, volUnit, excludePatterns)
				} else if isArchive(j.name) {
					volResult, err = s.analyzeArchiveAsVolume(entryPath, displayName, volNum, volUnit)
				} else {
					continue
				}

				// 오디오 파일 존재 여부 확인
				if volResult != nil {
					// 볼륨 파일명(확장자 제외)과 동일한 오디오 파일이 있는지 확인
					volNameNoExt := strings.TrimSuffix(j.name, filepath.Ext(j.name))
					if audioFiles[volNameNoExt] {
						volResult.HasAudio = true
					}
					// Unit이 비어있으면 기본값 설정 (방어 코드)
					if volResult.Unit == "" {
						volResult.Unit = "volume"
					}
				}

				if err != nil {
					mu.Lock()
					result.Errors = append(result.Errors, fmt.Sprintf("failed to analyze volume %s: %v", j.name, err))
					mu.Unlock()
					continue
				}

				if volResult != nil {
					resultChan <- volResult
				}
			}
		}()
	}

	// Workers 완료 대기 및 Result 채널 닫기 (별도 고루틴)
	go func() {
		wg.Wait()
		close(resultChan)
	}()

	// Consumer: Single Thread DB Save (Sequential)
	consumerDone := make(chan struct{})
	go func() {
		defer close(consumerDone)

		// 트랜잭션 최적화를 위해 배치 처리를 할 수도 있으나,
		// 여기서는 순차적 정합성을 위해, 그리고 Volume 단위로 커밋하여 
		// "부모(Series) - 자식(Volume)" 관계는 이미 Series가 커밋된 상태이므로 FK 문제 없음.
		// Volume 저장 중 에러 발생 시 해당 Volume만 실패 처리.
		
		canceled := false
		for volData := range resultChan {
			// context 취소 이후에는 저장 로직은 건너뛰되,
			// 채널을 끝까지 비워서 Producer 고루틴이 블록되지 않도록 한다.
			if ctx.Err() != nil {
				canceled = true
			}
			if canceled {
				continue
			}

			if onProgress != nil {
				onProgress(fmt.Sprintf("%s > %s", series.Title, volData.Title))
			}

			// Producer 단계에서 증분 스캔을 통과한 볼륨만 이곳(Consumer)에 도달하므로,
			// 여기서는 해당 볼륨들을 실제 저장 대상으로 처리한다.
			var existingVol *model.Volume
			
			// existingVolMap은 메인 함수 로컬 변수이므로 접근 가능하지만 동시성 주의 필요?
			// Consumer는 단일 스레드이므로 existingVolMap 읽기는 안전 (변경 없음).
			// 다만, Map이 포인터를 담고 있고 다른 곳에서 수정하지 않음.
			if vol, ok := existingVolMap[volData.Path]; ok {
				existingVol = vol
			}

			// 트랜잭션 시작
			tx, err := database.DB.BeginTx(ctx, nil)
			if err != nil {
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("failed to start transaction for %s: %v", volData.Title, err))
				mu.Unlock()
				continue
			}

			if existingVol != nil {
				if delErr := s.volumeRepo.Delete(tx, existingVol.ID); delErr != nil {
					_ = tx.Rollback()
					mu.Lock()
					result.Errors = append(result.Errors, fmt.Sprintf("failed to delete outdated volume %s: %v", volData.Title, delErr))
					mu.Unlock()
					continue
				}
			}

			// 저장 (Consumer Helper)
			saveRes, err := s.saveVolume(tx, series.ID, volData)
			if err != nil {
				_ = tx.Rollback()
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("failed to save volume %s: %v", volData.Title, err))
				mu.Unlock()
				continue
			}

			if err := tx.Commit(); err != nil {
				mu.Lock()
				result.Errors = append(result.Errors, fmt.Sprintf("failed to commit volume %s: %v", volData.Title, err))
				mu.Unlock()
				continue
			}

			// 결과 집계
			mu.Lock()
			result.VolumeCount += saveRes.VolumeCount
			result.ChapterCount += saveRes.ChapterCount
			result.PageCount += saveRes.PageCount
			mu.Unlock()
		}
	}()

	// Wait for Consumer
	<-consumerDone

	// Collect errors from log channel - 제거됨 (직접 append)

	// 3. 디스크에 없는 DB 볼륨 삭제 (Deleted Items)
	for path, vol := range existingVolMap {
		if !processedPaths[path] {
			log.Printf("Removing deleted volume: %s", path)
			if err := s.volumeRepo.Delete(nil, vol.ID); err != nil {
				result.Errors = append(result.Errors, fmt.Sprintf("failed to delete volume %s: %v", vol.Title, err))
			}
		}
	}

	return result, nil
}

// analyzeVolume scans a folder based volume
func (s *Scanner) analyzeVolume(volumePath, title string, volumeNum int, unit string, excludePatterns []string) (*scannedVolume, error) {
	// 파일 수정 시간 확인
	info, err := os.Stat(volumePath)
	modTime := time.Now()
	if err == nil {
		modTime = info.ModTime()
	}

	result := &scannedVolume{
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         volumePath,
		ModTime:      modTime,
		Unit:         unit,
	}

	entries, err := os.ReadDir(volumePath)
	if err != nil {
		return nil, err
	}

	var imageFiles []string
	var subDirs []string

	for _, entry := range entries {
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}
		if entry.IsDir() {
			subDirs = append(subDirs, entry.Name())
		} else if isImage(entry.Name()) {
			imageFiles = append(imageFiles, entry.Name())
		}
	}

	if len(subDirs) > 0 {
		natsort.Sort(subDirs)
		for i, subDir := range subDirs {
			chapterPath := filepath.Join(volumePath, subDir)
			chapter, err := s.analyzeChapter(chapterPath, subDir, i+1)
			if err != nil {
				// 개별 챕터 에러는 로그만 남기고 계속 진행할 수도 있지만, 일단 에러 반환
				return nil, err
			}
			result.Chapters = append(result.Chapters, *chapter)
		}
	} else if len(imageFiles) > 0 {
		pages, err := s.analyzeImages(volumePath, imageFiles)
		if err != nil {
			return nil, err
		}
		// 단일 챕터
		result.Chapters = append(result.Chapters, scannedChapter{
			Title:         title,
			ChapterNumber: 1,
			Path:          volumePath,
			Pages:         pages,
		})
	}

	return result, nil
}

// analyzeArchiveAsVolume scans an archive as a volume
func (s *Scanner) analyzeArchiveAsVolume(archivePath, title string, volumeNum int, unit string) (*scannedVolume, error) {

	info, err := os.Stat(archivePath)
	modTime := time.Now()
	if err == nil {
		modTime = info.ModTime()
	}

	result := &scannedVolume{
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         archivePath,
		ModTime:      modTime,
		Unit:         unit,
	}

	// ZIP 파일 열기
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer func() { _ = r.Close() }()

	var imageFiles []string
	for _, f := range r.File {
		if !f.FileInfo().IsDir() && isImage(f.Name) {
			imageFiles = append(imageFiles, f.Name)
		}
	}
	natsort.Sort(imageFiles)

	// 이미지 크기 추출 (Lazy Analysis)
	pages := make([]scannedPage, len(imageFiles))
	for i, imgPath := range imageFiles {
		// Lazy Analysis: Scan 단계에서는 크기를 측정하지 않음 (0, 0)
		// 실제 크기는 열람 시점에 image_handler에서 업데이트됨
		pages[i] = scannedPage{
			PageNumber: i + 1,
			Path:       imgPath,
			Width:      0, 
			Height:     0,
		}
	}

	// 단일 챕터
	result.Chapters = append(result.Chapters, scannedChapter{
		Title:         title,
		ChapterNumber: 1,
		Path:          archivePath,
		Pages:         pages,
	})

	return result, nil
}

// analyzeChapter scans a folder as a chapter
func (s *Scanner) analyzeChapter(chapterPath, title string, chapterNum int) (*scannedChapter, error) {
	entries, err := os.ReadDir(chapterPath)
	if err != nil {
		return nil, err
	}

	var imageFiles []string
	for _, entry := range entries {
		if !entry.IsDir() && isImage(entry.Name()) {
			imageFiles = append(imageFiles, entry.Name())
		}
	}

	pages, err := s.analyzeImages(chapterPath, imageFiles)
	if err != nil {
		return nil, err
	}

	return &scannedChapter{
		Title:         title,
		ChapterNumber: chapterNum,
		Path:          chapterPath,
		Pages:         pages,
	}, nil
}

// analyzeImages performs lazy analysis (dimensions initialized to 0)
// Actual dimensions are extracted when the image is requested
func (s *Scanner) analyzeImages(basePath string, imageFiles []string) ([]scannedPage, error) {
	natsort.Sort(imageFiles)

	pages := make([]scannedPage, len(imageFiles))


	for i, imgFile := range imageFiles {
		// Lazy Analysis: Scan 단계에서는 크기를 측정하지 않음
		pages[i] = scannedPage{
			PageNumber: i + 1,
			Path:       filepath.Join(basePath, imgFile),
			Width:      0,
			Height:     0,
		}
	}

	return pages, nil
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

// isAudio 오디오 파일 여부 확인
func isAudio(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filename))
	return audioExtensions[ext]
}

// saveVolume saves the analyzed volume data to the database
func (s *Scanner) saveVolume(tx database.Queryer, seriesID string, volData *scannedVolume) (*ScanResult, error) {
	result := &ScanResult{}

	// 볼륨 생성
	// 해시 기반 썸네일 확인 및 연결
	hash := md5.Sum([]byte(volData.Path))
	hashString := hex.EncodeToString(hash[:])
	
	// 지원하는 확장자 확인
	exts := []string{".jpg", ".png", ".webp", ".gif"}
	var foundThumbnailPath string
	
	thumbnailsDir := filepath.Join(s.config.DataDir, "thumbnails", "volumes")
	for _, ext := range exts {
		checkPath := filepath.Join(thumbnailsDir, hashString + ext)
		if _, err := os.Stat(checkPath); err == nil {
			foundThumbnailPath = checkPath
			break
		}
	}

	volume := &model.Volume{
		ID:           uuid.New().String(),
		SeriesID:     seriesID,
		Title:        volData.Title,
		VolumeNumber: volData.VolumeNumber,
		Path:         volData.Path,
		UpdatedAt:    volData.ModTime,
		HasAudio:     volData.HasAudio,
		Unit:         volData.Unit,
	}

	if foundThumbnailPath != "" {
		volume.ThumbnailPath = &foundThumbnailPath
		url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, time.Now().Unix())
		volume.ThumbnailURL = &url
		log.Printf("[SCANNER] Linked existing thumbnail for volume %s: %s", volData.Title, foundThumbnailPath)
	}

	if err := s.volumeRepo.Create(tx, volume); err != nil {
		return nil, fmt.Errorf("failed to create volume: %w", err)
	}
	result.VolumeCount++

	// 챕터 및 페이지 생성
	for _, chData := range volData.Chapters {
		chapter := &model.Chapter{
			ID:            uuid.New().String(),
			VolumeID:      volume.ID,
			Title:         chData.Title,
			ChapterNumber: chData.ChapterNumber,
			Path:          chData.Path,
			PageCount:     len(chData.Pages),
			CreatedAt:     time.Now(),
			UpdatedAt:     time.Now(),
		}
		if err := s.chapterRepo.Create(tx, chapter); err != nil {
			return nil, fmt.Errorf("failed to create chapter: %w", err)
		}
		result.ChapterCount++

		pages := make([]model.Page, len(chData.Pages))
		for i, pData := range chData.Pages {
			pages[i] = model.Page{
				ID:         uuid.New().String(),
				ChapterID:  chapter.ID,
				PageNumber: pData.PageNumber,
				Path:       pData.Path,
				Width:      pData.Width,
				Height:     pData.Height,
			}
		}
		if len(pages) > 0 {
			if err := s.pageRepo.CreateBatch(tx, pages); err != nil {
				return nil, fmt.Errorf("failed to create pages: %w", err)
			}
			result.PageCount += len(pages)
		}
	}

	return result, nil
}

// parseVolumeNumber extracts volume number from filename and infers unit
func parseVolumeNumber(name string) (int, string, bool) {
	// Pattern 0: Korean "권", "화", "회" (e.g. 01권, 1권, 1화) -> Volume or Chapter
	// reVolKorean is `(\d+)\s*(권|회|화)` so mKor[1] is number, mKor[2] is unit
	mKor := reVolKorean.FindStringSubmatch(name)
	if len(mKor) > 2 {
		n, err := strconv.Atoi(mKor[1])
		if err == nil {
			unitStr := mKor[2]
			unit := "volume"
			if unitStr == "회" || unitStr == "화" {
				unit = "chapter"
			}
			return n, unit, true
		}
	}
	
	// Pattern 1: v000, vol000, volume 000 -> Volume
	m := reVolPrefix.FindStringSubmatch(name)
	if len(m) > 1 {
		n, err := strconv.Atoi(m[1])
		if err == nil {
			return n, "volume", true
		}
	}

	// Pattern 2: c000, ch000, chapter 000 -> Chapter
	mCh := reVolChapter.FindStringSubmatch(name)
	if len(mCh) > 1 {
		n, err := strconv.Atoi(mCh[1])
		if err == nil {
			return n, "chapter", true
		}
	}
	
	// Pattern 2: Ends with number (e.g. "Series - 000") -> Default to Volume
	matches := reVolSuffix.FindAllStringSubmatch(name, -1)
	if len(matches) > 0 {
		lastMatch := matches[len(matches)-1]
		if len(lastMatch) > 1 {
			n, err := strconv.Atoi(lastMatch[1])
			if err == nil {
				return n, "volume", true
			}
		}
	}
	
	return 0, "volume", false
}
