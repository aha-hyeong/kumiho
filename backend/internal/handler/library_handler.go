package handler

import (
	"context"
	"log"
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
	appCtx      context.Context
}

func NewLibraryHandler(appCtx context.Context, libraryRepo *repository.LibraryRepository, scanner *scanner.Scanner) *LibraryHandler {
	return &LibraryHandler{
		libraryRepo: libraryRepo,
		scanner:     scanner,
		appCtx:      appCtx,
	}
}

// CreateLibraryRequest 라이브러리 생성 요청
type CreateLibraryRequest struct {
	Name                 string `json:"name"`
	Path                 string `json:"path"`
	DefaultViewMode      string `json:"default_view_mode"`
	DefaultReadDirection string `json:"default_read_direction"`
}

// List 모든 라이브러리 목록
// GET /api/v1/libraries
func (h *LibraryHandler) List(c *fiber.Ctx) error {
	libraries, err := h.libraryRepo.FindAll(nil)
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
	existing, err := h.libraryRepo.FindByPath(nil, req.Path)
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

	// 유효성 검사
	if req.DefaultViewMode != "" {
		switch req.DefaultViewMode {
		case "single", "double", "vertical":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_view_mode",
			})
		}
	}
	if req.DefaultReadDirection != "" {
		switch req.DefaultReadDirection {
		case "ltr", "rtl":
		default:
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid default_read_direction",
			})
		}
	}

	library := &model.Library{
		Name:                 req.Name,
		Path:                 req.Path,
		DefaultViewMode:      req.DefaultViewMode,
		DefaultReadDirection: req.DefaultReadDirection,
	}

	if err := h.libraryRepo.Create(nil, library); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create library",
		})
	}

	// 자동 스캔 트리거 (비동기)
	go func(lib *model.Library) {
		log.Printf("Starting automatic scan for new library: %s (%s)", lib.Name, lib.ID)
		// AppContext를 사용하여 서버 종료 시 스캔 중단
		if _, err := h.scanner.ScanLibrary(h.appCtx, lib); err != nil {
			log.Printf("Failed to automatically scan library %s: %v", lib.ID, err)
		} else {
			log.Printf("Automatic scan completed for library: %s", lib.Name)
		}
	}(library)

	return c.Status(fiber.StatusCreated).JSON(library)
}

// Get 라이브러리 상세
// GET /api/v1/libraries/:id
func (h *LibraryHandler) Get(c *fiber.Ctx) error {
	id := c.Params("id")

	library, err := h.libraryRepo.FindByID(nil, id)
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

	library, err := h.libraryRepo.FindByID(nil, id)
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

	result, err := h.scanner.ScanLibrary(c.Context(), library)
	if err != nil {
		if err == scanner.ErrAlreadyScanning {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "scan already in progress",
			})
		}
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

	library, err := h.libraryRepo.FindByID(nil, id)
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

	if library.Type == "SYSTEM" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "system libraries cannot be deleted",
		})
	}

	if err := h.libraryRepo.Delete(nil, id); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete library",
		})
	}

	return c.JSON(fiber.Map{
		"message": "library deleted",
	})
}

// UpdateLibraryRequest 라이브러리 수정 요청
type UpdateLibraryRequest struct {
	Name                 string `json:"name"`
	Path                 string `json:"path"`
	DefaultViewMode      string `json:"default_view_mode"`
	DefaultReadDirection string `json:"default_read_direction"`
	IsVisible            *bool  `json:"is_visible"` // Optional, pointer to distinguish false vs missing
}

// Update 라이브러리 수정
// PUT /api/v1/libraries/:id
func (h *LibraryHandler) Update(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	id := c.Params("id")
	var req UpdateLibraryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	library, err := h.libraryRepo.FindByID(nil, id)
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

	// SYSTEM 라이브러리는 가시성 외의 수정 불가
	if library.Type == "SYSTEM" {
		if req.Name != "" || req.Path != "" || req.DefaultViewMode != "" || req.DefaultReadDirection != "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "system libraries cannot use name, path, or default settings",
			})
		}
		if req.IsVisible != nil {
			library.IsVisible = *req.IsVisible
		}
	} else {
		// 일반 라이브러리 수정
		if req.Name != "" {
			library.Name = req.Name
		}
		// Path change not supported for now

		if req.DefaultViewMode != "" {
			switch req.DefaultViewMode {
			case "single", "double", "vertical":
				library.DefaultViewMode = req.DefaultViewMode
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_view_mode",
				})
			}
		}
		if req.DefaultReadDirection != "" {
			switch req.DefaultReadDirection {
			case "ltr", "rtl":
				library.DefaultReadDirection = req.DefaultReadDirection
			default:
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid default_read_direction",
				})
			}
		}
		if req.IsVisible != nil {
			library.IsVisible = *req.IsVisible
		}
	}

	if err := h.libraryRepo.Update(nil, library); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update library",
		})
	}

	return c.JSON(library)
}

// UpdateOrder 라이브러리 정렬 순서 업데이트
// PUT /api/v1/libraries/order
func (h *LibraryHandler) UpdateOrder(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	var req []string
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body, expected an array of strings",
		})
	}

	// 입력 검증: 전체 라이브러리 개수와 일치하는지 확인 (선택적이지만 권장)
	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch existing libraries",
		})
	}

	if len(req) != len(libraries) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "request body must contain all library IDs",
			"detail": fiber.Map{
				"expected": len(libraries),
				"received": len(req),
			},
		})
	}

	// ID 유효성 및 중복 검사
	orders := make(map[string]int)
	existingIDs := make(map[string]bool)
	for _, lib := range libraries {
		existingIDs[lib.ID] = true
	}

	for i, id := range req {
		if !existingIDs[id] {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":      "invalid library id",
				"library_id": id,
			})
		}
		if _, exists := orders[id]; exists {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":      "duplicate library id in request",
				"library_id": id,
			})
		}
		orders[id] = i
	}

	if err := h.libraryRepo.UpdateOrder(nil, orders); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update library order",
		})
	}

	return c.JSON(fiber.Map{
		"message": "library order updated",
	})
}
