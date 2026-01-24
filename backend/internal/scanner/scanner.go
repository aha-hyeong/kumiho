package scanner

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/facette/natsort"
	"github.com/fsnotify/fsnotify"
	"github.com/google/uuid"
	_ "golang.org/x/image/webp"
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
		matched, err := filepath.Match(pattern, name)
		if err != nil {
			log.Printf("Invalid scan exclude pattern '%s': %v", pattern, err)
			continue
		}
		if matched {
			return true
		}
	}
	return false
}

// getImageDimensions 이미지 파일의 크기 정보만 추출 (헤더만 읽음, 전체 디코딩 X)
func getImageDimensions(path string) (width, height int) {
	file, err := os.Open(path)
	if err != nil {
		log.Printf("[Scanner] Failed to open image file for dimensions: %s, error: %v", path, err)
		return 0, 0
	}
	defer file.Close()

	config, _, err := image.DecodeConfig(file)
	if err != nil {
		log.Printf("[Scanner] Failed to decode image config: %s, error: %v", path, err)
		return 0, 0
	}
	return config.Width, config.Height
}

// getImageDimensionsFromZipFile ZIP 아카이브 내부 이미지 파일의 크기 정보 추출
func getImageDimensionsFromZipFile(f *zip.File) (width, height int) {
	rc, err := f.Open()
	if err != nil {
		log.Printf("[Scanner] Failed to open zip file member for dimensions: %s, error: %v", f.Name, err)
		return 0, 0
	}
	defer rc.Close()

	config, _, err := image.DecodeConfig(rc)
	if err != nil {
		log.Printf("[Scanner] Failed to decode zip image config: %s, error: %v", f.Name, err)
		return 0, 0
	}
	return config.Width, config.Height
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

	for _, entry := range entries {
		// 제외 패턴 확인
		if isExcluded(entry.Name(), excludePatterns) {
			continue
		}

		entryPath := filepath.Join(library.Path, entry.Name())

		if entry.IsDir() {
			// 폴더 → 시리즈로 처리
			processedPaths[entryPath] = true

			wg.Add(1)
			go func(entry fs.DirEntry, path string) {
				defer wg.Done()

				if ctx.Err() != nil {
					errChan <- ctx.Err()
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
					_ = s.libraryRepo.UpdateScanProgress(nil, library.ID, detail, percent)
				}
				
				// 초기 진행 상태 업데이트 (시리즈 시작)
				updateProgress(entry.Name())

				seriesResult, err := s.processSeries(ctx, library.ID, path, entry.Name(), existingMap, updateProgress)
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
			processedPaths[entryPath] = true

			wg.Add(1)
			go func(entry fs.DirEntry, path string) {
				defer wg.Done()

				if ctx.Err() != nil {
					errChan <- ctx.Err()
					return
				}
				
				// 진행률 업데이트 함수
				updateProgress := func(detail string) {
					current := atomic.LoadInt32(&processedItems)
					percent := 0
					if totalItems > 0 {
						percent = int((float64(current) / float64(totalItems)) * 100)
					}
					_ = s.libraryRepo.UpdateScanProgress(nil, library.ID, detail, percent)
				}
				
				updateProgress(entry.Name())

				seriesResult, err := s.processArchiveAsSeries(ctx, library.ID, path, entry.Name(), existingMap)
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
		watcher.Close()
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
		defer watcher.Close()

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
						libID := key.(string)
						libPath := value.(string)

						if strings.HasPrefix(event.Name, libPath) {
							log.Printf("[SCANNER] Event match for library (ID:%s, Path:%s): %s %s", libID, libPath, event.Name, event.Op)
							
							// 새 디렉토리가 생성되거나 이동되어 들어오면 감시 목록에 추가
							if event.Op&(fsnotify.Create|fsnotify.Rename) != 0 {
								info, err := os.Stat(event.Name)
								if err == nil && info.IsDir() {
									log.Printf("[SCANNER] New directory detected, adding recursively: %s", event.Name)
									_ = s.addWatchRecursive(watcher, event.Name)
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
			_ = s.watcher.Remove(path.(string))
			// TODO: 서브 디렉토리들은 자동으로 제거되거나 수동으로 제거해야 할 수도 있음
			// fsnotify.Remove는 해당 경로만 제거함. 하위 경로는 계속 감시될 수 있음(플랫폼마다 다름)
			// 하지만 라이브러리 삭제 시에는 보통 데이터가 날아가거나 경로가 무의미해지므로 
			// 감시자가 계속 살아있어도 triggerScan에서 libID를 못찾아 스킵됨.
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
		s.watcher.Close()
		s.watcher = nil
	}
	s.stopFallbackPollingLocked()
}

// startFallbackPolling 실시간 감시가 제한적인 환경을 위한 폴링 시작
func (s *Scanner) startFallbackPolling() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.startFallbackPollingLocked()
}

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
					libID := key.(string)
					libPath := value.(string)

					// /mnt/ 로 시작하는 경로는 WSL 환경에서 Windows 파일 시스템일 가능성이 큼
					if strings.HasPrefix(libPath, "/mnt/") {
						log.Printf("[SCANNER] Fallback poll triggering for limited filesystem: %s", libPath)
						lib, err := s.libraryRepo.FindByID(nil, libID)
						if err == nil && lib != nil {
							go s.ScanLibrary(context.Background(), lib)
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

// stopFallbackPolling 폴링 중지
func (s *Scanner) stopFallbackPolling() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.stopFallbackPollingLocked()
}

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
	defer tx.Rollback()

	var series *model.Series
	result := &ScanResult{}

	// 파일명에서 확장자 제거하여 시리즈 제목 생성
	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	// 파일 수정 시간 확인
	var lastModified time.Time
	info, err := os.Stat(archivePath)
	if err != nil {
		return nil, err
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

	// 아카이브를 단일 볼륨으로 스캔
	volResult, err := s.scanArchiveAsVolume(ctx, tx, series.ID, archivePath, filename, 1)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	result.VolumeCount = 1
	result.ChapterCount = volResult.ChapterCount
	result.PageCount = volResult.PageCount

	return result, nil
}

// processSeries 시리즈 처리 (생성 또는 업데이트 후 스캔)
func (s *Scanner) processSeries(ctx context.Context, libraryID, seriesPath, title string, existingMap map[string]*model.Series, onProgress func(string)) (*ScanResult, error) {
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
		if err := s.seriesRepo.Create(nil, series); err != nil {
			return nil, err
		}
	}

	return s.scanSeriesContent(ctx, series, onProgress)
}

// scanSeriesContent 시리즈 내용 스캔 (볼륨, 챕터) - Incremental Scan 적용
func (s *Scanner) scanSeriesContent(ctx context.Context, series *model.Series, onProgress func(string)) (*ScanResult, error) {
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

	// 자연 정렬
	names := make([]string, 0, len(entries))
	entryMap := make(map[string]fs.DirEntry)
	for _, entry := range entries {
		names = append(names, entry.Name())
		entryMap[entry.Name()] = entry
	}
	natsort.Sort(names)

	// 처리된 Path 추적 (삭제 대상 식별용)
	processedPaths := make(map[string]bool)

	volumeNum := 1
	for _, name := range names {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		entry := entryMap[name]
		entryPath := filepath.Join(seriesPath, name)
		processedPaths[entryPath] = true

		// 상세 진행 상황 업데이트
		if onProgress != nil {
			onProgress(fmt.Sprintf("%s > %s", series.Title, name))
		}

		// 2.1. 변경 사항 확인 및 트랜잭션 시작
		tx, err := database.DB.BeginTx(ctx, nil)
		if err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("failed to start transaction for volume %s: %v", name, err))
			continue
		}

		// 트랜잭션 내에서 처리할 함수 (defer rollback용 보조 클로저)
		processVolume := func() error {
			shouldScan := false
			var existingVol *model.Volume

			if vol, ok := existingVolMap[entryPath]; ok {
				existingVol = vol
				info, err := os.Stat(entryPath)
				if err == nil {
					if info.ModTime().After(vol.UpdatedAt) {
						shouldScan = true
						if err := s.volumeRepo.Delete(tx, vol.ID); err != nil {
							return fmt.Errorf("failed to delete outdated volume: %w", err)
						}
						existingVol = nil
					}
				}
			} else {
				shouldScan = true
			}

			if !shouldScan && existingVol != nil {
				return nil // 변경 없음
			}

			if entry.IsDir() {
				volResult, err := s.scanVolume(ctx, tx, series.ID, entryPath, name, volumeNum)
				if err != nil {
					return err
				}
				result.VolumeCount++
				result.ChapterCount += volResult.ChapterCount
				result.PageCount += volResult.PageCount
			} else if isArchive(name) {
				volResult, err := s.scanArchiveAsVolume(ctx, tx, series.ID, entryPath, name, volumeNum)
				if err != nil {
					return err
				}
				result.VolumeCount++
				result.ChapterCount += volResult.ChapterCount
				result.PageCount += volResult.PageCount
			}
			return nil
		}

		// 실행 및 트랜잭션 결과 처리
		if err := processVolume(); err != nil {
			_ = tx.Rollback()
			result.Errors = append(result.Errors, fmt.Sprintf("failed to process volume %s: %v", name, err))
			continue
		}

		if err := tx.Commit(); err != nil {
			result.Errors = append(result.Errors, fmt.Sprintf("failed to commit volume %s: %v", name, err))
			continue
		}
		volumeNum++
	}

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

// scanVolume 폴더 볼륨 스캔
func (s *Scanner) scanVolume(ctx context.Context, db database.Queryer, seriesID, volumePath, title string, volumeNum int) (*ScanResult, error) {
	result := &ScanResult{}

	// 볼륨 번호 추출 시도
	if matches := volumeNumRegex.FindStringSubmatch(title); len(matches) > 1 {
		// 정규식에서 추출된 번호 사용 (필요시)
	}

	volume := &model.Volume{
		SeriesID:     seriesID,
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         volumePath,
		UpdatedAt:    time.Now(), // 스캔 시점 기록
	}
	if err := s.volumeRepo.Create(db, volume); err != nil {
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
			pageCount, err := s.scanChapter(db, volume.ID, chapterPath, subDir, i+1)
			if err != nil {
				result.Errors = append(result.Errors, err.Error())
				continue
			}
			result.ChapterCount++
			result.PageCount += pageCount
		}
	} else if len(imageFiles) > 0 {
		// 이미지만 있으면 단일 챕터
		pageCount, err := s.scanImagesAsChapter(db, volume.ID, volumePath, title, 1, imageFiles)
		if err != nil {
			return nil, err
		}
		result.ChapterCount++
		result.PageCount += pageCount
	}

	return result, nil
}

// scanArchiveAsVolume 아카이브를 볼륨으로 스캔
func (s *Scanner) scanArchiveAsVolume(ctx context.Context, db database.Queryer, seriesID, archivePath, filename string, volumeNum int) (*ScanResult, error) {
	result := &ScanResult{}

	title := strings.TrimSuffix(filename, filepath.Ext(filename))

	// 파일 수정 시간 확인
	info, err := os.Stat(archivePath)
	updatedAt := time.Now()
	if err == nil {
		updatedAt = info.ModTime()
	}

	volume := &model.Volume{
		SeriesID:     seriesID,
		Title:        title,
		VolumeNumber: volumeNum,
		Path:         archivePath,
		UpdatedAt:    updatedAt,
	}
	if err := s.volumeRepo.Create(db, volume); err != nil {
		return nil, err
	}

	// ZIP 파일 열기
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer r.Close()

	// 이미지 파일들 추출 및 zip.File 매핑 (이후 이미지 크기 추출을 위해 zip.File 객체를 보관)
	var imageFiles []string
	fileMap := make(map[string]*zip.File)
	for _, f := range r.File {
		if !f.FileInfo().IsDir() && isImage(f.Name) {
			imageFiles = append(imageFiles, f.Name)
			fileMap[f.Name] = f
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
	if err := s.chapterRepo.Create(db, chapter); err != nil {
		return nil, err
	}

	// 페이지 생성 (이미지 크기 정보 포함)
	pages := make([]model.Page, len(imageFiles))
	for i, imgPath := range imageFiles {
		width, height := getImageDimensionsFromZipFile(fileMap[imgPath])
		pages[i] = model.Page{
			ID:         uuid.New().String(),
			ChapterID:  chapter.ID,
			PageNumber: i + 1,
			Path:       imgPath, // ZIP 내부 경로
			Width:      width,
			Height:     height,
		}
	}
	if err := s.pageRepo.CreateBatch(db, pages); err != nil {
		return nil, err
	}

	result.ChapterCount = 1
	result.PageCount = len(imageFiles)

	return result, nil
}

// scanChapter 폴더를 챕터로 스캔
func (s *Scanner) scanChapter(db database.Queryer, volumeID, chapterPath, title string, chapterNum int) (int, error) {
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

	return s.scanImagesAsChapter(db, volumeID, chapterPath, title, chapterNum, imageFiles)
}

// scanImagesAsChapter 이미지들을 챕터로 스캔
func (s *Scanner) scanImagesAsChapter(db database.Queryer, volumeID, basePath, title string, chapterNum int, imageFiles []string) (int, error) {
	natsort.Sort(imageFiles)

	chapter := &model.Chapter{
		VolumeID:      volumeID,
		Title:         title,
		ChapterNumber: chapterNum,
		Path:          basePath,
		PageCount:     len(imageFiles),
	}
	if err := s.chapterRepo.Create(db, chapter); err != nil {
		return 0, err
	}

	// 페이지 생성 (이미지 크기 정보 포함)
	pages := make([]model.Page, len(imageFiles))
	for i, imgFile := range imageFiles {
		imgPath := filepath.Join(basePath, imgFile)
		width, height := getImageDimensions(imgPath)
		pages[i] = model.Page{
			ID:         uuid.New().String(),
			ChapterID:  chapter.ID,
			PageNumber: i + 1,
			Path:       imgPath,
			Width:      width,
			Height:     height,
		}
	}
	if err := s.pageRepo.CreateBatch(db, pages); err != nil {
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
