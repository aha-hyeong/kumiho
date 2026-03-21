package handler

import (
	"archive/zip"
	"bytes"
	"container/list"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	_ "image/gif" // GIF 디코딩 지원
	_ "image/png" // PNG 디코딩 지원

	"github.com/disintegration/imaging"
	"github.com/gen2brain/go-fitz"
	"github.com/gofiber/fiber/v2"
	_ "golang.org/x/image/bmp"  // BMP 디코딩 지원
	_ "golang.org/x/image/tiff" // TIFF 디코딩 지원
	_ "golang.org/x/image/webp" // WebP 디코딩 지원
	"golang.org/x/sync/singleflight"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
)

type ImageHandler struct {
	pageRepo             *repository.PageRepository
	chapterRepo          *repository.ChapterRepository
	volumeRepo           *repository.VolumeRepository
	seriesRepo           *repository.SeriesRepository
	authService          *service.AuthService
	config               *config.Config
	pdfThumbFailMu       sync.Mutex
	pdfThumbFailCooldown map[string]time.Time
	pdfPageCacheMu       sync.Mutex
	pdfPageCache         map[string]*list.Element
	pdfPageCacheList     *list.List
	pdfPageCacheMaxSize  int
	pdfPageSingleFlight  singleflight.Group
}

type pdfPageCacheEntry struct {
	key  string
	data []byte
}

func NewImageHandler(
	pageRepo *repository.PageRepository,
	chapterRepo *repository.ChapterRepository,
	volumeRepo *repository.VolumeRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
	cfg *config.Config,
) *ImageHandler {
	return &ImageHandler{
		pageRepo:             pageRepo,
		chapterRepo:          chapterRepo,
		volumeRepo:           volumeRepo,
		seriesRepo:           seriesRepo,
		authService:          authService,
		config:               cfg,
		pdfThumbFailCooldown: make(map[string]time.Time),
		pdfPageCache:         make(map[string]*list.Element),
		pdfPageCacheList:     list.New(),
		pdfPageCacheMaxSize:  120,
	}
}

const pdfThumbnailRetryCooldown = 5 * time.Minute

var ErrInvalidPath = errors.New("invalid file path")

func (h *ImageHandler) shouldSkipPdfThumbnailRetry(key string) bool {
	h.pdfThumbFailMu.Lock()
	defer h.pdfThumbFailMu.Unlock()

	lastFail, ok := h.pdfThumbFailCooldown[key]
	if !ok {
		return false
	}
	return time.Since(lastFail) < pdfThumbnailRetryCooldown
}

func (h *ImageHandler) markPdfThumbnailRetryFailure(key string) {
	h.pdfThumbFailMu.Lock()
	defer h.pdfThumbFailMu.Unlock()
	h.pdfThumbFailCooldown[key] = time.Now()
}

func (h *ImageHandler) clearPdfThumbnailRetryFailure(key string) {
	h.pdfThumbFailMu.Lock()
	defer h.pdfThumbFailMu.Unlock()
	delete(h.pdfThumbFailCooldown, key)
}

func thumbnailExtFromMediaType(mediaType string) string {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/svg+xml":
		return ".svg"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	default:
		return ".jpg"
	}
}

func (h *ImageHandler) redirectThumbnailPlaceholder(c *fiber.Ctx, hasAudio bool) error {
	placeholderPath := "/reading-kumiho.png"
	if hasAudio {
		placeholderPath = "/audio-kumiho.png"
	}
	return c.Redirect(placeholderPath, fiber.StatusFound)
}

func isSvgOrXMLHeaderFile(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()

	buf := make([]byte, 512)
	n, err := f.Read(buf)
	if err != nil && err != io.EOF {
		return false
	}
	if n <= 0 {
		return false
	}

	header := strings.ToLower(strings.TrimSpace(string(buf[:n])))
	return strings.HasPrefix(header, "<svg") || strings.HasPrefix(header, "<?xml")
}

var knownThumbnailExtensions = []string{".jpg", ".png", ".gif", ".webp", ".svg"}

func findExistingThumbnailByHash(dirPath, hash string) string {
	for _, ext := range knownThumbnailExtensions {
		candidatePath := filepath.Join(dirPath, hash+ext)
		if _, err := os.Stat(candidatePath); err == nil {
			return candidatePath
		}
	}
	return ""
}

func ensureThumbnailFileAtomic(path string, data []byte) error {
	_, statErr := os.Stat(path)
	if statErr == nil {
		return nil
	}
	if !errors.Is(statErr, os.ErrNotExist) {
		return statErr
	}

	dirPath := filepath.Dir(path)
	tmpFile, err := os.CreateTemp(dirPath, ".thumb-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()
	committed := false
	defer func() {
		if !committed {
			_ = os.Remove(tmpPath)
		}
	}()

	if _, err := tmpFile.Write(data); err != nil {
		_ = tmpFile.Close()
		return err
	}
	if err := tmpFile.Close(); err != nil {
		return err
	}

	if err := os.Rename(tmpPath, path); err != nil {
		if _, statErr := os.Stat(path); statErr == nil {
			committed = true
			return nil
		}
		return err
	}

	committed = true
	return nil
}

// resolveSecurePath 파일 경로를 검증하고 실제 경로를 반환합니다.
func (h *ImageHandler) resolveSecurePath(rawPath string) (string, error) {
	fullPath := filepath.Clean(rawPath)
	baseDir := h.config.DataDir
	if filepath.IsAbs(fullPath) {
		baseDir = filepath.Dir(fullPath)
	} else {
		absBaseDir, absErr := filepath.Abs(baseDir)
		if absErr != nil {
			return "", fmt.Errorf("failed to resolve base data dir: %w", absErr)
		}
		baseDir = absBaseDir
		fullPath = filepath.Join(baseDir, fullPath)
	}

	realBaseDir, err := filepath.EvalSymlinks(baseDir)
	if err != nil {
		return "", fmt.Errorf("failed to eval symlinks for base dir: %w", err)
	}

	realFullPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		return "", err
	}

	rel, err := filepath.Rel(realBaseDir, realFullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", ErrInvalidPath
	}

	return realFullPath, nil
}

func (h *ImageHandler) getPdfPageCache(key string) ([]byte, bool) {
	h.pdfPageCacheMu.Lock()
	defer h.pdfPageCacheMu.Unlock()

	elem, ok := h.pdfPageCache[key]
	if !ok {
		return nil, false
	}

	h.pdfPageCacheList.MoveToFront(elem)
	entry, ok := elem.Value.(*pdfPageCacheEntry)
	if !ok || entry == nil {
		return nil, false
	}
	buf := make([]byte, len(entry.data))
	copy(buf, entry.data)
	return buf, true
}

func (h *ImageHandler) setPdfPageCache(key string, data []byte) {
	h.pdfPageCacheMu.Lock()
	defer h.pdfPageCacheMu.Unlock()

	if elem, ok := h.pdfPageCache[key]; ok {
		entry, ok := elem.Value.(*pdfPageCacheEntry)
		if !ok || entry == nil {
			return
		}
		entry.data = make([]byte, len(data))
		copy(entry.data, data)
		h.pdfPageCacheList.MoveToFront(elem)
		return
	}

	entry := &pdfPageCacheEntry{
		key:  key,
		data: make([]byte, len(data)),
	}
	copy(entry.data, data)
	elem := h.pdfPageCacheList.PushFront(entry)
	h.pdfPageCache[key] = elem

	for h.pdfPageCacheList.Len() > h.pdfPageCacheMaxSize {
		last := h.pdfPageCacheList.Back()
		if last == nil {
			break
		}
		h.pdfPageCacheList.Remove(last)
		lastEntry, ok := last.Value.(*pdfPageCacheEntry)
		if !ok || lastEntry == nil {
			continue
		}
		delete(h.pdfPageCache, lastEntry.key)
	}
}

var errPDFPageNotFound = errors.New("pdf page not found")

func (h *ImageHandler) renderPDFPageImage(chapter *model.Chapter, pageNumber, width int) ([]byte, error) {
	cacheKey := fmt.Sprintf("%s:%d:%d", chapter.ID, pageNumber, width)
	if cached, ok := h.getPdfPageCache(cacheKey); ok {
		return cached, nil
	}

	rendered, err, _ := h.pdfPageSingleFlight.Do(cacheKey, func() (interface{}, error) {
		if cached, ok := h.getPdfPageCache(cacheKey); ok {
			return cached, nil
		}

		realPDFPath, err := h.resolveSecurePath(chapter.Path)
		if err != nil {
			return nil, err
		}

		doc, err := fitz.New(realPDFPath)
		if err != nil {
			return nil, err
		}
		defer doc.Close()

		pageCount := doc.NumPage()
		if pageCount <= 0 {
			return nil, errPDFPageNotFound
		}
		if pageNumber < 1 || pageNumber > pageCount {
			return nil, errPDFPageNotFound
		}

		img, err := doc.Image(pageNumber - 1)
		if err != nil {
			return nil, err
		}

		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 85}); err != nil {
			return nil, err
		}

		renderedData := buf.Bytes()
		if width > 0 {
			resized, resizeErr := h.resizeImage(renderedData, width)
			if resizeErr != nil {
				// 리사이즈 실패 시 width 키로 원본 이미지를 캐싱하지 않도록 에러 반환
				return nil, resizeErr
			}
			renderedData = resized
		}

		h.setPdfPageCache(cacheKey, renderedData)
		return renderedData, nil
	})
	if err != nil {
		return nil, err
	}

	data, ok := rendered.([]byte)
	if !ok {
		return nil, fmt.Errorf("unexpected rendered pdf page data type")
	}
	return data, nil
}

// GetPageImage 페이지 이미지 서빙
// GET /api/v1/pages/:id/image
func (h *ImageHandler) GetPageImage(c *fiber.Ctx) error {
	pageID := c.Params("id")
	width := c.QueryInt("width", 0)

	page, err := h.pageRepo.FindByID(nil, pageID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch page",
		})
	}
	if page == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "page not found",
		})
	}

	// 챕터 정보 조회 (권한 확인용)
	chapter, err := h.chapterRepo.FindByID(nil, page.ChapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	// 볼륨 정보 조회
	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume not found",
		})
	}

	// 라이브러리 접근 권한 확인
	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	// 시리즈 정보 조회
	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "access denied",
			})
		}
	}

	var imageData []byte
	var contentType string

	// ZIP/CBZ 파일인 경우
	if isArchiveFile(chapter.Path) {
		imageData, contentType, err = h.readImageFromArchive(chapter.Path, page.Path)
	} else {
		// 일반 파일인 경우
		imageData, contentType, err = h.readImageFromDisk(page.Path)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read image",
		})
	}

	// Lazy Analysis: DB에 저장된 크기가 0이면 백그라운드에서 업데이트
	if page.Width == 0 || page.Height == 0 {
		// 고루틴에서 안전하게 사용하기 위해 데이터 복사
		imgCopy := make([]byte, len(imageData))
		copy(imgCopy, imageData)
		pageCopy := *page

		go func(p model.Page, data []byte) {
			cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil {
				log.Printf("[IMAGE_HANDLER] Failed to decode image config for page %s: %v", p.ID, err)
				return
			}
			p.Width = cfg.Width
			p.Height = cfg.Height
			// 백그라운드에서 크기 정보만 업데이트
			if err := h.pageRepo.Update(nil, &p); err != nil {
				log.Printf("[IMAGE_HANDLER] Failed to update page dimensions for page %s: %v", p.ID, err)
			}
		}(pageCopy, imgCopy)
	}

	// 리사이즈 요청이 있는 경우
	if width > 0 {
		if resized, rErr := h.resizeImage(imageData, width); rErr == nil {
			imageData = resized
		}
		// 리사이즈 실패 시 원본 반환 (무시)
	}

	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=31536000") // 1년 캐시
	return c.Send(imageData)
}

// readImageFromDisk 디스크에서 이미지 읽기
func (h *ImageHandler) readImageFromDisk(imagePath string) ([]byte, string, error) {
	data, err := os.ReadFile(imagePath)
	if err != nil {
		return nil, "", err
	}

	contentType := getContentType(imagePath)
	return data, contentType, nil
}

// readImageFromArchive ZIP 아카이브에서 이미지 읽기
func (h *ImageHandler) readImageFromArchive(archivePath, imagePath string) ([]byte, string, error) {
	r, err := zip.OpenReader(archivePath)
	if err != nil {
		return nil, "", err
	}
	defer func() { _ = r.Close() }()

	for _, f := range r.File {
		if f.Name == imagePath {
			rc, err := f.Open()
			if err != nil {
				return nil, "", err
			}
			defer func() { _ = rc.Close() }()

			data, err := io.ReadAll(rc)
			if err != nil {
				return nil, "", err
			}

			contentType := getContentType(imagePath)
			return data, contentType, nil
		}
	}

	return nil, "", fmt.Errorf("image not found in archive")
}

// resizeImage 이미지 리사이즈 (Hybrid 캐싱)
func (h *ImageHandler) resizeImage(data []byte, width int) ([]byte, error) {
	// 이미지 디코딩
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, err
	}

	// 현재 크기가 요청 크기보다 작으면 원본 반환
	if img.Bounds().Dx() <= width {
		return data, nil
	}

	// 리사이즈 (비율 유지)
	resized := imaging.Resize(img, width, 0, imaging.Lanczos)

	// JPEG로 인코딩
	var buf bytes.Buffer
	if err := imaging.Encode(&buf, resized, imaging.JPEG, imaging.JPEGQuality(85)); err != nil {
		return data, err
	}

	return buf.Bytes(), nil
}

// GetThumbnail 썸네일 이미지
// GET /api/v1/series/:id/thumbnail
// GET /api/v1/volumes/:id/thumbnail
// GET /api/v1/chapters/:id/thumbnail
// GET /api/v1/chapters/:id/thumbnail
func (h *ImageHandler) GetThumbnail(c *fiber.Ctx) error {
	resourceType := c.Params("type") // series, volumes, chapters
	if resourceType == "" {
		if val, ok := c.Locals("type").(string); ok {
			resourceType = val
		}
	}

	resourceID := c.Params("id")
	width := c.QueryInt("width", 300)

	var firstPagePath string
	var archivePath string
	var customThumbnailPath string
	var fallbackPlaceholderAudio bool

	userID := middleware.GetUserID(c)

	switch resourceType {
	case "series":
		series, err := h.seriesRepo.FindByID(nil, resourceID, userID)
		if err != nil || series == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "series not found",
			})
		}

		// MASTER가 아니면 접근 권한 확인
		role := middleware.GetUserRole(c)
		if role != model.RoleMaster {
			allowedIDs, err := h.authService.GetAllowedLibraryIDs(userID)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "failed to check permissions",
				})
			}
			// if err == nil checks removed as we handle err above
			allowed := false
			for _, aid := range allowedIDs {
				if aid == series.LibraryID {
					allowed = true
					break
				}
			}
			if !allowed {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "access denied",
				})
			}
		}

		// 1. 커스텀 썸네일 확인
		if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
			thumbPath := *series.ThumbnailPath
			if _, statErr := os.Stat(thumbPath); statErr == nil {
				// .jpg 확장자지만 실제 헤더가 SVG/XML이면 잘못 저장된 썸네일로 간주해 제외한다.
				invalidCustomThumbnail := false
				if strings.HasSuffix(strings.ToLower(thumbPath), ".jpg") {
					invalidCustomThumbnail = isSvgOrXMLHeaderFile(thumbPath)
				}

				if !invalidCustomThumbnail {
					customThumbnailPath = thumbPath
				}
			}
		}

		if customThumbnailPath == "" {
			// 2. 없으면 첫 번째 페이지 사용
			pageID, err := h.seriesRepo.GetFirstPageID(nil, series.ID)
			if err == nil && pageID != "" {
				page, err := h.pageRepo.FindByID(nil, pageID)
				if err == nil && page != nil {
					firstPagePath = page.Path

					// 챕터 확인 (아카이브 여부)
					chapter, err := h.chapterRepo.FindByID(nil, page.ChapterID)
					if err == nil && chapter != nil && isArchiveFile(chapter.Path) {
						archivePath = chapter.Path
					}
				}
			}

			// EPUB fallback: 페이지가 없으면 첫 번째 볼륨의 첫 번째 챕터에서 커버 추출 시도
			if firstPagePath == "" && archivePath == "" {
				volumes, _ := h.volumeRepo.FindBySeriesID(nil, series.ID)
				if len(volumes) > 0 {
					chapters, _ := h.chapterRepo.FindByVolumeID(nil, volumes[0].ID)
					if len(chapters) > 0 && strings.ToLower(filepath.Ext(chapters[0].Path)) == ".epub" {
						thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "series")
						if mkErr := os.MkdirAll(thumbnailsDir, 0755); mkErr == nil {
							hashBytes := md5.Sum([]byte(chapters[0].Path))
							hashString := hex.EncodeToString(hashBytes[:])
							existingThumbPath := findExistingThumbnailByHash(thumbnailsDir, hashString)
							if existingThumbPath != "" {
								series.ThumbnailPath = &existingThumbPath
								_ = h.seriesRepo.Update(nil, series)
								customThumbnailPath = existingThumbPath
								break
							}

							if coverData, coverMT, coverErr := util.ExtractEpubCover(chapters[0].Path); coverErr == nil {
								ext := thumbnailExtFromMediaType(coverMT)
								newThumbPath := filepath.Join(thumbnailsDir, hashString+ext)
								if writeErr := ensureThumbnailFileAtomic(newThumbPath, coverData); writeErr == nil {
									series.ThumbnailPath = &newThumbPath
									_ = h.seriesRepo.Update(nil, series)
									customThumbnailPath = newThumbPath
								}
							}
						}
					}
				}
			}
		}

	case "volumes":
		volume, err := h.volumeRepo.FindByID(nil, resourceID)
		if err != nil || volume == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "volume not found",
			})
		}
		if series, sErr := h.seriesRepo.FindByID(nil, volume.SeriesID, userID); sErr == nil && series != nil {
			fallbackPlaceholderAudio = series.LibraryType == "audiobook"
		}

		if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
			thumbPath := *volume.ThumbnailPath
			_, statErr := os.Stat(thumbPath)

			if statErr == nil {
				isJpgThumb := strings.HasSuffix(strings.ToLower(thumbPath), ".jpg")

				// .jpg 확장자지만 실제 헤더가 SVG/XML이면 잘못 저장된 썸네일로 간주해 제외한다.
				if !isJpgThumb || !isSvgOrXMLHeaderFile(thumbPath) {
					customThumbnailPath = thumbPath
				}
			}
		}

		if customThumbnailPath != "" {
			// 이미 유효한 썸네일 경로가 있음
		} else if strings.ToLower(filepath.Ext(volume.Path)) == ".pdf" {
			retryKey := fmt.Sprintf("volume:%s", volume.Path)
			if h.shouldSkipPdfThumbnailRetry(retryKey) {
				break
			}

			// PDF 파일이면서 썸네일이 추출되지 않은 경우 동적으로 추출
			thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "volumes")
			if err := os.MkdirAll(thumbnailsDir, 0755); err == nil {
				hashBytes := md5.Sum([]byte(volume.Path))
				hashString := hex.EncodeToString(hashBytes[:])
				newThumbPath := filepath.Join(thumbnailsDir, hashString+".jpg")

				if err := util.ExtractPdfThumbnail(volume.Path, newThumbPath); err == nil {
					volume.ThumbnailPath = &newThumbPath
					if uErr := h.volumeRepo.Update(nil, volume); uErr != nil {
						log.Printf("[IMAGE_HANDLER] Failed to update volume thumbnail path in DB: %v", uErr)
					}
					customThumbnailPath = newThumbPath
					h.clearPdfThumbnailRetryFailure(retryKey)
				} else {
					log.Printf("[IMAGE_HANDLER] Failed to extract PDF thumbnail for volume %s: %v", volume.ID, err)
					h.markPdfThumbnailRetryFailure(retryKey)
				}
			}
		} else {
			// 볼륨의 첫 번째 챕터 → 첫 번째 페이지 (재귀적 탐색 지원)
			targetChapter, targetPage, targetArchive, found := h.findFirstAvailableChapterRecursively(resourceID)
			if !found {
				return h.redirectThumbnailPlaceholder(c, fallbackPlaceholderAudio)
			}

			// EPUB 챕터는 pages 테이블 레코드가 비어 있을 수 있으므로 커버 추출 fallback 처리
			if strings.ToLower(filepath.Ext(targetChapter.Path)) == ".epub" {
				thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "volumes")
				if mkErr := os.MkdirAll(thumbnailsDir, 0755); mkErr == nil {
					hashBytes := md5.Sum([]byte(targetChapter.Path))
					hashString := hex.EncodeToString(hashBytes[:])
					existingThumbPath := findExistingThumbnailByHash(thumbnailsDir, hashString)
					if existingThumbPath != "" {
						// 이 볼륨에 직접 썸네일을 업데이트할 수 있는지 판단 필요 (원본 volume 객체가 필요함)
						// 상속받은 썸네일이므로 원본 볼륨 DB 업데이트는 생략하거나 신중히 결정
						customThumbnailPath = existingThumbPath
					} else {
						if coverData, coverMT, coverErr := util.ExtractEpubCover(targetChapter.Path); coverErr == nil {
							ext := thumbnailExtFromMediaType(coverMT)
							newThumbPath := filepath.Join(thumbnailsDir, hashString+ext)
							if writeErr := ensureThumbnailFileAtomic(newThumbPath, coverData); writeErr == nil {
								customThumbnailPath = newThumbPath
							}
						}
					}
				}
				if customThumbnailPath != "" {
					break
				}
			}

			if targetPage == nil {
				return h.redirectThumbnailPlaceholder(c, fallbackPlaceholderAudio)
			}
			firstPagePath = targetPage.Path
			archivePath = targetArchive
		}

	case "chapters":
		chapter, err := h.chapterRepo.FindByID(nil, resourceID)
		if err != nil || chapter == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "chapter not found",
			})
		}

		// EPUB 챕터는 pages 테이블 레코드가 없을 수 있으므로 커버 추출 fallback 처리
		if strings.ToLower(filepath.Ext(chapter.Path)) == ".epub" {
			thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "chapters")
			if mkErr := os.MkdirAll(thumbnailsDir, 0755); mkErr == nil {
				hashBytes := md5.Sum([]byte(chapter.Path))
				hashString := hex.EncodeToString(hashBytes[:])
				customThumbnailPath = findExistingThumbnailByHash(thumbnailsDir, hashString)
				if customThumbnailPath != "" {
					break
				}

				if coverData, coverMT, coverErr := util.ExtractEpubCover(chapter.Path); coverErr == nil {
					ext := thumbnailExtFromMediaType(coverMT)
					newThumbPath := filepath.Join(thumbnailsDir, hashString+ext)
					if writeErr := ensureThumbnailFileAtomic(newThumbPath, coverData); writeErr == nil {
						customThumbnailPath = newThumbPath
						break
					}
				}
			}
		}

		pages, err := h.pageRepo.FindByChapterID(nil, resourceID)
		if err != nil || len(pages) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "no pages found",
			})
		}
		firstPagePath = pages[0].Path
		if isArchiveFile(chapter.Path) {
			archivePath = chapter.Path
		}

	default:
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid resource type",
		})
	}

	var imageData []byte
	var contentType string
	var err error

	if customThumbnailPath != "" {
		imageData, contentType, err = h.readImageFromDisk(customThumbnailPath)
	} else if archivePath != "" {
		imageData, contentType, err = h.readImageFromArchive(archivePath, firstPagePath)
	} else if firstPagePath != "" {
		imageData, contentType, err = h.readImageFromDisk(firstPagePath)
	} else {
		if resourceType == "volumes" {
			return h.redirectThumbnailPlaceholder(c, fallbackPlaceholderAudio)
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "thumbnail not found",
		})
	}

	if err != nil {
		log.Printf("[IMAGE_HANDLER] failed to read thumbnail for %s %s: %v", resourceType, resourceID, err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "thumbnail not found or failed to read",
		})
	}

	// 썸네일 리사이즈
	if resizedData, err := h.resizeImage(imageData, width); err == nil {
		imageData = resizedData
		contentType = "image/jpeg"
	} else {
		// 리사이즈 실패 시 원본 반환 (SVG 등 지원하지 않는 포맷일 경우)
		if strings.HasSuffix(strings.ToLower(contentType), "svg+xml") || strings.HasSuffix(strings.ToLower(firstPagePath), ".svg") || strings.HasSuffix(strings.ToLower(customThumbnailPath), ".svg") {
			contentType = "image/svg+xml"
		}
	}

	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=86400") // 1일 캐시
	return c.Send(imageData)
}

// ServeChapterEpub EPUB 파일 서빙
// GET /api/v1/chapters/:chapterId/epub
func (h *ImageHandler) ServeChapterEpub(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "chapter not found"})
	}

	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
		}
	}

	if !strings.HasSuffix(strings.ToLower(chapter.Path), ".epub") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "not an epub chapter"})
	}

	realFullPath, err := h.resolveSecurePath(chapter.Path)
	if err != nil {
		if errors.Is(err, ErrInvalidPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file path"})
		}
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		log.Printf("[IMAGE_HANDLER] failed to resolve secure path for epub: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	if _, err := os.Stat(realFullPath); os.IsNotExist(err) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
	}

	c.Set("Content-Type", "application/epub+zip")
	c.Set("Accept-Ranges", "bytes")
	return c.SendFile(realFullPath)
}

// ServeChapterText TXT 파일 서빙
// GET /api/v1/chapters/:chapterId/text
func (h *ImageHandler) ServeChapterText(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "chapter not found"})
	}

	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
		}

		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
		}
	}

	if !strings.HasSuffix(strings.ToLower(chapter.Path), ".txt") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "not a txt chapter"})
	}

	realFullPath, err := h.resolveSecurePath(chapter.Path)
	if err != nil {
		if errors.Is(err, ErrInvalidPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file path"})
		}
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		log.Printf("[IMAGE_HANDLER] failed to resolve secure path for txt: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	raw, err := os.ReadFile(realFullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read txt file"})
	}

	raw = bytes.TrimPrefix(raw, []byte{0xEF, 0xBB, 0xBF})
	if !utf8.Valid(raw) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unsupported text encoding: utf-8 only"})
	}

	content := string(raw)
	normalized := strings.ReplaceAll(content, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")

	return c.JSON(fiber.Map{
		"content":         normalized,
		"total_bytes":     len(raw),
		"total_positions": utf8.RuneCountInString(normalized),
	})
}

// isArchiveFile 아카이브 파일 여부 확인
func isArchiveFile(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	return ext == ".zip" || ext == ".cbz"
}

// getContentType 파일 확장자로 Content-Type 결정
func getContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".png":
		return "image/png"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".bmp":
		return "image/bmp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

// PageImageByNumber 페이지 번호로 이미지 조회
// GET /api/v1/chapters/:chapterId/pages/:pageNumber/image
func (h *ImageHandler) PageImageByNumber(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")
	pageNumber, err := strconv.Atoi(c.Params("pageNumber"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid page number",
		})
	}
	width := c.QueryInt("width", 0)

	// 챕터 정보 조회
	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapter",
		})
	}
	if chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	// 라이브러리 접근 권한 확인
	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "access denied",
			})
		}
	}

	// PDF 챕터는 pages 테이블을 거치지 않고 페이지를 직접 렌더링한다.
	if strings.HasSuffix(strings.ToLower(chapter.Path), ".pdf") {
		imageData, renderErr := h.renderPDFPageImage(chapter, pageNumber, width)
		if renderErr != nil {
			if errors.Is(renderErr, errPDFPageNotFound) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "page not found",
				})
			}
			if errors.Is(renderErr, ErrInvalidPath) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid file path",
				})
			}
			if os.IsNotExist(renderErr) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "file not found",
				})
			}
			log.Printf("[IMAGE_HANDLER] failed to render pdf page image for chapter %s page %d: %v", chapterID, pageNumber, renderErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to render pdf page",
			})
		}

		c.Set("Content-Type", "image/jpeg")
		c.Set("Cache-Control", "public, max-age=31536000")
		return c.Send(imageData)
	}

	pages, err := h.pageRepo.FindByChapterID(nil, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch pages",
		})
	}

	if pageNumber < 1 || pageNumber > len(pages) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "page not found",
		})
	}

	page := pages[pageNumber-1]

	var imageData []byte
	var contentType string

	if isArchiveFile(chapter.Path) {
		imageData, contentType, err = h.readImageFromArchive(chapter.Path, page.Path)
	} else {
		imageData, contentType, err = h.readImageFromDisk(page.Path)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read image",
		})
	}

	// Lazy Analysis: DB에 저장된 크기가 0이면 백그라운드에서 업데이트
	if page.Width == 0 || page.Height == 0 {
		// 고루틴에서 안전하게 사용하기 위해 데이터 복사
		imgCopy := make([]byte, len(imageData))
		copy(imgCopy, imageData)
		pageCopy := page

		go func(p model.Page, data []byte) {
			cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
			if err != nil {
				log.Printf("[IMAGE_HANDLER] Failed to decode image config for page %s: %v", p.ID, err)
				return
			}
			p.Width = cfg.Width
			p.Height = cfg.Height
			// 백그라운드에서 크기 정보만 업데이트
			if err := h.pageRepo.Update(nil, &p); err != nil {
				log.Printf("[IMAGE_HANDLER] Failed to update page dimensions for page %s: %v", p.ID, err)
			}
		}(pageCopy, imgCopy)
	}

	if width > 0 {
		imageData, _ = h.resizeImage(imageData, width)
	}

	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=31536000")
	return c.Send(imageData)
}

// AnalyzeChapterPages 챕터의 모든 페이지 이미지 크기 분석
// POST /api/v1/chapters/:chapterId/analyze
func (h *ImageHandler) AnalyzeChapterPages(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	// 챕터 정보 조회
	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapter",
		})
	}
	if chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	// 페이지 목록 조회
	pages, err := h.pageRepo.FindByChapterID(nil, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch pages",
		})
	}

	// 분석이 필요한 페이지 필터링
	var pagesToAnalyze []model.Page
	for _, p := range pages {
		if p.Width == 0 || p.Height == 0 {
			pagesToAnalyze = append(pagesToAnalyze, p)
		}
	}

	if len(pagesToAnalyze) == 0 {
		return c.JSON(fiber.Map{
			"analyzed_count": 0,
			"total_pages":    len(pages),
			"success":        true,
		})
	}

	// 아카이브 파일인 경우 미리 열어서 준비
	var zipFileMap map[string]*zip.File
	isArchive := isArchiveFile(chapter.Path)
	var zipReader *zip.ReadCloser

	if isArchive {
		r, err := zip.OpenReader(chapter.Path)
		if err != nil {
			log.Printf("[ANALYZE] Failed to open archive %s: %v", chapter.Path, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to open archive",
			})
		}
		zipReader = r // 나중에 닫기 위해 저장

		zipFileMap = make(map[string]*zip.File)
		for _, f := range r.File {
			zipFileMap[f.Name] = f
		}
	}

	// 병렬 분석 (동시성 제한: 10개)
	const maxConcurrency = 10
	sem := make(chan struct{}, maxConcurrency)
	var wg sync.WaitGroup
	analyzedCount := 0
	var mu sync.Mutex

	for _, page := range pagesToAnalyze {
		wg.Add(1)
		go func(p model.Page) {
			defer wg.Done()
			sem <- struct{}{}        // acquire
			defer func() { <-sem }() // release

			var imageData []byte
			var err error

			if isArchive {
				// 미리 열어둔 맵에서 파일 찾기
				if f, ok := zipFileMap[p.Path]; ok {
					rc, openErr := f.Open()
					if openErr != nil {
						log.Printf("[ANALYZE] Failed to open file in archive %s: %v", p.Path, openErr)
						return
					}

					data, readErr := io.ReadAll(rc)
					_ = rc.Close()

					if readErr != nil {
						log.Printf("[ANALYZE] Failed to read file in archive %s: %v", p.Path, readErr)
						return
					}
					imageData = data
				} else {
					log.Printf("[ANALYZE] File not found in archive map: %s", p.Path)
					return
				}
			} else {
				imageData, _, err = h.readImageFromDisk(p.Path)
				if err != nil {
					log.Printf("[ANALYZE] Failed to read image from disk %s: %v", p.Path, err)
					return
				}
			}

			// 크기 분석
			cfg, _, err := image.DecodeConfig(bytes.NewReader(imageData))
			if err != nil {
				log.Printf("[ANALYZE] Failed to decode image config for page %s: %v", p.ID, err)
				return
			}

			p.Width = cfg.Width
			p.Height = cfg.Height

			// DB 업데이트
			if err := h.pageRepo.Update(nil, &p); err != nil {
				log.Printf("[ANALYZE] Failed to update page dimensions for page %s: %v", p.ID, err)
				return
			}

			mu.Lock()
			analyzedCount++
			mu.Unlock()
		}(page)
	}

	wg.Wait()

	// 고루틴이 모두 완료된 후 zip reader 닫기
	if zipReader != nil {
		_ = zipReader.Close()
	}

	return c.JSON(fiber.Map{
		"analyzed_count": analyzedCount,
		"total_pages":    len(pages),
		"success":        true,
	})
}

// ServeChapterPDF 서빙 (스트리밍 지원)
// GET /api/v1/chapters/:chapterId/pdf
func (h *ImageHandler) ServeChapterPDF(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	// 라이브러리 조회 및 권한 확인
	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	role := middleware.GetUserRole(c)
	userID := middleware.GetUserID(c)

	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
		}
	}

	if !strings.HasSuffix(strings.ToLower(chapter.Path), ".pdf") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "not a pdf chapter"})
	}

	realFullPath, err := h.resolveSecurePath(chapter.Path)
	if err != nil {
		if errors.Is(err, ErrInvalidPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file path"})
		}
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		log.Printf("[IMAGE_HANDLER] failed to resolve secure path for pdf: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	if _, err := os.Stat(realFullPath); os.IsNotExist(err) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Accept-Ranges", "bytes")
	return c.SendFile(realFullPath)
}

// findFirstAvailableChapterRecursively 볼륨 계층 구조 내에서 첫 번째로 사용 가능한 챕터를 재귀적으로 찾음
func (h *ImageHandler) findFirstAvailableChapterRecursively(volumeID string) (*model.Chapter, *model.Page, string, bool) {
	// 1. 해당 볼륨에 직접 속한 챕터 확인
	chapters, err := h.chapterRepo.FindByVolumeID(nil, volumeID)
	if err == nil && len(chapters) > 0 {
		for _, ch := range chapters {
			// EPUB의 경우 페이지 레코드 없이도 썸네일 추출 로직(커버 fallback)이 있으므로 일단 반환
			// 오디오북인 경우에도 페이지 없이 앨범 아트나 폴더 이미지를 활용할 수 있으므로 반환
			ext := strings.ToLower(filepath.Ext(ch.Path))
			if ext == ".epub" || ch.HasAudio {
				return &ch, nil, "", true
			}

			// 일반 이미지/아카이브인 경우 첫 번째 페이지가 있는지 확인
			var pages []model.Page
			pages, err = h.pageRepo.FindByChapterID(nil, ch.ID)
			if err == nil && len(pages) > 0 {
				archivePath := ""
				if isArchiveFile(ch.Path) {
					archivePath = ch.Path
				}
				return &ch, &pages[0], archivePath, true
			}
		}
	}

	// 2. 하위 볼륨이 있다면 재귀적으로 탐색
	subVolumes, err := h.volumeRepo.FindByParentID(nil, volumeID)
	if err == nil && len(subVolumes) > 0 {
		for _, subVol := range subVolumes {
			ch, pg, arch, found := h.findFirstAvailableChapterRecursively(subVol.ID)
			if found {
				return ch, pg, arch, true
			}
		}
	}

	return nil, nil, "", false
}
