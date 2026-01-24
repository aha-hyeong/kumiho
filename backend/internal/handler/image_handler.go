package handler

import (
	"archive/zip"
	"bytes"
	"fmt"
	"image"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/disintegration/imaging"
	"github.com/gofiber/fiber/v2"
	_ "golang.org/x/image/webp" // WebP 디코딩 지원
)

type ImageHandler struct {
	pageRepo    *repository.PageRepository
	chapterRepo *repository.ChapterRepository
	volumeRepo  *repository.VolumeRepository
	seriesRepo  *repository.SeriesRepository
	authService *service.AuthService
	config      *config.Config
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
		pageRepo:    pageRepo,
		chapterRepo: chapterRepo,
		volumeRepo:  volumeRepo,
		seriesRepo:  seriesRepo,
		authService: authService,
		config:      cfg,
	}
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
	defer r.Close()

	for _, f := range r.File {
		if f.Name == imagePath {
			rc, err := f.Open()
			if err != nil {
				return nil, "", err
			}
			defer rc.Close()

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
		fmt.Printf("Resize failed (using original): %v\n", err)
	}

	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=86400") // 1일 캐시
	return c.Send(imageData)
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

	if width > 0 {
		imageData, _ = h.resizeImage(imageData, width)
	}

	c.Set("Content-Type", contentType)
	c.Set("Cache-Control", "public, max-age=31536000")
	return c.Send(imageData)
}
