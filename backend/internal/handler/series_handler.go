package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

type SeriesHandler struct {
	seriesRepo  *repository.SeriesRepository
	volumeRepo  *repository.VolumeRepository
	chapterRepo *repository.ChapterRepository
	pageRepo    *repository.PageRepository
}

func NewSeriesHandler(
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
) *SeriesHandler {
	return &SeriesHandler{
		seriesRepo:  seriesRepo,
		volumeRepo:  volumeRepo,
		chapterRepo: chapterRepo,
		pageRepo:    pageRepo,
	}
}

// ListByLibrary 라이브러리별 시리즈 목록
// GET /api/v1/libraries/:libraryId/series
func (h *SeriesHandler) ListByLibrary(c *fiber.Ctx) error {
	libraryID := c.Params("libraryId")

	seriesList, err := h.seriesRepo.FindByLibraryID(libraryID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}

	if seriesList == nil {
		seriesList = []model.Series{}
	}

	return c.JSON(fiber.Map{
		"series": seriesList,
	})
}

// GetSeries 시리즈 상세
// GET /api/v1/series/:id
func (h *SeriesHandler) GetSeries(c *fiber.Ctx) error {
	id := c.Params("id")

	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	return c.JSON(series)
}

// ListVolumes 시리즈별 볼륨 목록
// GET /api/v1/series/:seriesId/volumes
func (h *SeriesHandler) ListVolumes(c *fiber.Ctx) error {
	seriesID := c.Params("seriesId")

	volumes, err := h.volumeRepo.FindBySeriesID(seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch volumes",
		})
	}

	if volumes == nil {
		volumes = []model.Volume{}
	}

	return c.JSON(fiber.Map{
		"volumes": volumes,
	})
}

// GetVolume 볼륨 상세
// GET /api/v1/volumes/:id
func (h *SeriesHandler) GetVolume(c *fiber.Ctx) error {
	id := c.Params("id")

	volume, err := h.volumeRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch volume",
		})
	}
	if volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume not found",
		})
	}

	return c.JSON(volume)
}

// ListChapters 볼륨별 챕터 목록
// GET /api/v1/volumes/:volumeId/chapters
func (h *SeriesHandler) ListChapters(c *fiber.Ctx) error {
	volumeID := c.Params("volumeId")

	chapters, err := h.chapterRepo.FindByVolumeID(volumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapters",
		})
	}

	if chapters == nil {
		chapters = []model.Chapter{}
	}

	return c.JSON(fiber.Map{
		"chapters": chapters,
	})
}

// GetChapter 챕터 상세
// GET /api/v1/chapters/:id
func (h *SeriesHandler) GetChapter(c *fiber.Ctx) error {
	id := c.Params("id")

	chapter, err := h.chapterRepo.FindByID(id)
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

	return c.JSON(chapter)
}

// ListPages 챕터별 페이지 목록
// GET /api/v1/chapters/:chapterId/pages
func (h *SeriesHandler) ListPages(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	pages, err := h.pageRepo.FindByChapterID(chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch pages",
		})
	}

	if pages == nil {
		pages = []model.Page{}
	}

	return c.JSON(fiber.Map{
		"pages": pages,
	})
}
