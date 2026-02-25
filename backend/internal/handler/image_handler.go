package handler

import (
	"archive/zip"
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"fmt"
	"image"
	"io"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	_ "image/gif"  // GIF 디코딩 지원
	_ "image/jpeg" // JPEG 디코딩 지원
	_ "image/png"  // PNG 디코딩 지원

	"github.com/disintegration/imaging"
	"github.com/gofiber/fiber/v2"
	_ "golang.org/x/image/bmp"  // BMP 디코딩 지원
	_ "golang.org/x/image/tiff" // TIFF 디코딩 지원
	_ "golang.org/x/image/webp" // WebP 디코딩 지원

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
	}
}

const pdfThumbnailRetryCooldown = 5 * time.Minute

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
			customThumbnailPath = *series.ThumbnailPath
		} else {
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
		}

	case "volumes":
		volume, err := h.volumeRepo.FindByID(nil, resourceID)
		if err != nil || volume == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "volume not found",
			})
		}

		if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
			customThumbnailPath = *volume.ThumbnailPath
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
			// 볼륨의 첫 번째 챕터 → 첫 번째 페이지
			chapters, err := h.chapterRepo.FindByVolumeID(nil, resourceID)
			if err != nil || len(chapters) == 0 {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "no chapters found",
				})
			}
			pages, err := h.pageRepo.FindByChapterID(nil, chapters[0].ID)
			if err != nil || len(pages) == 0 {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "no pages found",
				})
			}
			firstPagePath = pages[0].Path
			if isArchiveFile(chapters[0].Path) {
				archivePath = chapters[0].Path
			}
		}

	case "chapters":
		chapter, err := h.chapterRepo.FindByID(nil, resourceID)
		if err != nil || chapter == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "chapter not found",
			})
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
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "thumbnail not found",
		})
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read thumbnail",
		})
	}

	// 썸네일 리사이즈
	if resizedData, err := h.resizeImage(imageData, width); err == nil {
		imageData = resizedData
		// 리사이즈 성공 시 JPEG로 변환됨 (단, resizeImage 구현에 따라 달라질 수 있음)
		// 현재 resizeImage는 항상 JPEG로 인코딩함
		contentType = "image/jpeg"
	} else {
		// 리사이즈 실패 시 원본 반환 (contentType 유지)
		fmt.Printf("리사이즈 실패 (원본 사용): %v\n", err)
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

	fullPath := filepath.Clean(chapter.Path)
	baseDir := h.config.DataDir
	if filepath.IsAbs(fullPath) {
		baseDir = filepath.Dir(fullPath)
	} else {
		absBaseDir, absErr := filepath.Abs(baseDir)
		if absErr != nil {
			log.Printf("[IMAGE_HANDLER] failed to resolve base data dir: %v", absErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
		}
		baseDir = absBaseDir
		fullPath = filepath.Join(baseDir, fullPath)
	}

	realBaseDir, err := filepath.EvalSymlinks(baseDir)
	if err != nil {
		log.Printf("[IMAGE_HANDLER] failed to eval symlinks for base dir: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	realFullPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		log.Printf("[IMAGE_HANDLER] failed to eval symlinks for chapter epub: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	rel, err := filepath.Rel(realBaseDir, realFullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file path"})
	}

	if _, err := os.Stat(realFullPath); os.IsNotExist(err) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
	}

	c.Set("Content-Type", "application/epub+zip")
	c.Set("Accept-Ranges", "bytes")
	return c.SendFile(realFullPath)
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

	// 챕터 정보 조회
	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapter",
		})
	}

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

	// PDF 경로는 라이브러리 루트 밖 절대 경로일 수 있으므로
	// 절대 경로면 해당 파일의 디렉토리를 기준 경로로 사용하고,
	// 상대 경로면 DataDir 기준으로 해석합니다.
	fullPath := filepath.Clean(chapter.Path)
	baseDir := h.config.DataDir
	if filepath.IsAbs(fullPath) {
		baseDir = filepath.Dir(fullPath)
	} else {
		absBaseDir, absErr := filepath.Abs(baseDir)
		if absErr != nil {
			log.Printf("[IMAGE_HANDLER] failed to resolve base data dir: %v", absErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
		}
		baseDir = absBaseDir
		fullPath = filepath.Join(baseDir, fullPath)
	}

	realBaseDir, err := filepath.EvalSymlinks(baseDir)
	if err != nil {
		log.Printf("[IMAGE_HANDLER] failed to eval symlinks for base dir: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	realFullPath, err := filepath.EvalSymlinks(fullPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
		}
		log.Printf("[IMAGE_HANDLER] failed to eval symlinks for chapter pdf: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "internal server error"})
	}

	rel, err := filepath.Rel(realBaseDir, realFullPath)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid file path"})
	}

	if _, err := os.Stat(realFullPath); os.IsNotExist(err) {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "file not found"})
	}

	c.Set("Content-Type", "application/pdf")
	c.Set("Accept-Ranges", "bytes")
	return c.SendFile(realFullPath)
}
