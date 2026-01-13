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
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/disintegration/imaging"
	"github.com/gofiber/fiber/v2"
)

type ImageHandler struct {
	pageRepo    *repository.PageRepository
	chapterRepo *repository.ChapterRepository
	volumeRepo  *repository.VolumeRepository
	config      *config.Config
}

func NewImageHandler(
	pageRepo *repository.PageRepository,
	chapterRepo *repository.ChapterRepository,
	volumeRepo *repository.VolumeRepository,
	cfg *config.Config,
) *ImageHandler {
	return &ImageHandler{
		pageRepo:    pageRepo,
		chapterRepo: chapterRepo,
		volumeRepo:  volumeRepo,
		config:      cfg,
	}
}

// GetPageImage 페이지 이미지 서빙
// GET /api/v1/pages/:id/image
func (h *ImageHandler) GetPageImage(c *fiber.Ctx) error {
	pageID := c.Params("id")
	width := c.QueryInt("width", 0)

	page, err := h.pageRepo.FindByID(pageID)
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

	// 챕터 정보 조회 (아카이브 파일인지 확인)
	chapter, err := h.chapterRepo.FindByID(page.ChapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapter",
		})
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
		imageData, err = h.resizeImage(imageData, width)
		if err != nil {
			// 리사이즈 실패 시 원본 반환
		}
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
func (h *ImageHandler) GetThumbnail(c *fiber.Ctx) error {
	resourceType := c.Params("type") // series, volumes, chapters
	resourceID := c.Params("id")
	width := c.QueryInt("width", 300)

	var firstPagePath string
	var archivePath string

	switch resourceType {
	case "series":
		// 시리즈의 첫 번째 볼륨 → 첫 번째 챕터 → 첫 번째 페이지
		// TODO: 구현
		return c.Status(fiber.StatusNotImplemented).JSON(fiber.Map{
			"error": "not implemented",
		})

	case "volumes":
		volume, err := h.volumeRepo.FindByID(resourceID)
		if err != nil || volume == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "volume not found",
			})
		}
		// 볼륨의 첫 번째 챕터 → 첫 번째 페이지
		chapters, err := h.chapterRepo.FindByVolumeID(resourceID)
		if err != nil || len(chapters) == 0 {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "no chapters found",
			})
		}
		pages, err := h.pageRepo.FindByChapterID(chapters[0].ID)
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
		chapter, err := h.chapterRepo.FindByID(resourceID)
		if err != nil || chapter == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "chapter not found",
			})
		}
		pages, err := h.pageRepo.FindByChapterID(resourceID)
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
	var err error

	if archivePath != "" {
		imageData, _, err = h.readImageFromArchive(archivePath, firstPagePath)
	} else {
		imageData, _, err = h.readImageFromDisk(firstPagePath)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read thumbnail",
		})
	}

	// 썸네일 리사이즈
	imageData, _ = h.resizeImage(imageData, width)

	c.Set("Content-Type", "image/jpeg")
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

	pages, err := h.pageRepo.FindByChapterID(chapterID)
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
	chapter, err := h.chapterRepo.FindByID(chapterID)
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
