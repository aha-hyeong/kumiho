package handler

import (
	"os"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/gofiber/fiber/v2"
)

type LibraryHandler struct {
	libraryRepo *repository.LibraryRepository
	scanner     *scanner.Scanner
}

func NewLibraryHandler(libraryRepo *repository.LibraryRepository, scanner *scanner.Scanner) *LibraryHandler {
	return &LibraryHandler{
		libraryRepo: libraryRepo,
		scanner:     scanner,
	}
}

// CreateLibraryRequest 라이브러리 생성 요청
type CreateLibraryRequest struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// List 모든 라이브러리 목록
// GET /api/v1/libraries
func (h *LibraryHandler) List(c *fiber.Ctx) error {
	libraries, err := h.libraryRepo.FindAll()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch libraries",
		})
	}

	if libraries == nil {
		libraries = []model.Library{}
	}

	return c.JSON(fiber.Map{
		"libraries": libraries,
	})
}

// Create 새 라이브러리 생성
// POST /api/v1/libraries
func (h *LibraryHandler) Create(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	var req CreateLibraryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Name == "" || req.Path == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "name and path are required",
		})
	}

	// 경로 존재 여부 확인
	if _, err := os.Stat(req.Path); os.IsNotExist(err) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "path does not exist",
		})
	}

	// 중복 경로 확인
	existing, err := h.libraryRepo.FindByPath(req.Path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to check existing library",
		})
	}
	if existing != nil {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"error": "library with this path already exists",
		})
	}

	library := &model.Library{
		Name: req.Name,
		Path: req.Path,
	}

	if err := h.libraryRepo.Create(library); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create library",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(library)
}

// Get 라이브러리 상세
// GET /api/v1/libraries/:id
func (h *LibraryHandler) Get(c *fiber.Ctx) error {
	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	return c.JSON(library)
}

// Scan 라이브러리 스캔
// POST /api/v1/libraries/:id/scan
func (h *LibraryHandler) Scan(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	result, err := h.scanner.ScanLibrary(library)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error":   "failed to scan library",
			"details": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"message": "scan completed",
		"result":  result,
	})
}

// Delete 라이브러리 삭제
// DELETE /api/v1/libraries/:id
func (h *LibraryHandler) Delete(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	if err := h.libraryRepo.Delete(id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete library",
		})
	}

	return c.JSON(fiber.Map{
		"message": "library deleted",
	})
}
