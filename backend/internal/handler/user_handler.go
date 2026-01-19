package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

type UserHandler struct {
	authService *service.AuthService
}

func NewUserHandler(authService *service.AuthService) *UserHandler {
	return &UserHandler{authService: authService}
}

// CreateUserRequest 사용자 생성 요청
type CreateUserRequest struct {
	Username string `json:"username"` // 로그인 ID
	Nickname string `json:"nickname"` // 사용자명
	Password string `json:"password"`
	Role     string `json:"role"` // "MASTER" or "USER"
	LibraryIDs []string `json:"library_ids"`
}

// UpdateUserLibrariesRequest 사용자 라이브러리 권한 수정 요청
type UpdateUserLibrariesRequest struct {
	LibraryIDs []string `json:"library_ids"`
}

// List 모든 사용자 목록 (MASTER only)
// GET /api/v1/users
func (h *UserHandler) List(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	users, err := h.authService.GetAllUsers()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch users",
		})
	}

	if users == nil {
		users = []model.User{}
	}

	// 각 사용자의 허용된 라이브러리 ID 목록 포함
	type UserWithLibraries struct {
		model.User
		AllowedLibraryIDs []string `json:"allowed_library_ids"`
	}

	var usersWithLibs []UserWithLibraries
	for _, u := range users {
		libs, err := h.authService.GetAllowedLibraryIDs(u.ID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to fetch allowed libraries",
			})
		}
		if libs == nil {
			libs = []string{}
		}
		usersWithLibs = append(usersWithLibs, UserWithLibraries{
			User:              u,
			AllowedLibraryIDs: libs,
		})
	}

	return c.JSON(fiber.Map{
		"users": usersWithLibs,
	})
}

// Create 새 사용자 생성 (MASTER only)
// POST /api/v1/users
func (h *UserHandler) Create(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	var req CreateUserRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 유효성 검증
	if req.Username == "" || req.Nickname == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "ID, username, and password are required",
		})
	}

	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "password must be at least 8 characters",
		})
	}

	// 역할 결정
	userRole := model.RoleUser
	if req.Role == "MASTER" {
		userRole = model.RoleMaster
	}

	user, err := h.authService.CreateUser(req.Username, req.Nickname, req.Password, userRole, req.LibraryIDs)
	if err != nil {
		if err == service.ErrUserExists {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "user already exists",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create user",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(user)
}

// Delete 사용자 삭제 (MASTER only)
// DELETE /api/v1/users/:id
func (h *UserHandler) Delete(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	currentUserID := middleware.GetUserID(c)
	targetID := c.Params("id")

	// 자기 자신은 삭제 불가
	if currentUserID == targetID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "cannot delete yourself",
		})
	}

	// 대상 사용자 조회
	targetUser, err := h.authService.GetUserByID(targetID)
	if err != nil || targetUser == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	// MASTER 계정은 삭제 불가
	if targetUser.Role == model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "cannot delete MASTER account",
		})
	}

	if err := h.authService.DeleteUser(targetID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete user",
		})
	}

	return c.JSON(fiber.Map{
		"message": "user deleted",
	})
}

// UpdateLibraries 사용자 라이브러리 권한 수정 (MASTER only)
// PUT /api/v1/users/:id/libraries
func (h *UserHandler) UpdateLibraries(c *fiber.Ctx) error {
	// MASTER 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "master access required",
		})
	}

	targetID := c.Params("id")

	// 대상 사용자 존재 확인
	targetUser, err := h.authService.GetUserByID(targetID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch user",
		})
	}
	if targetUser == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	var req UpdateUserLibrariesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 서비스 호출하여 라이브러리 권한 설정
	if err := h.authService.SetUserLibraries(targetID, req.LibraryIDs); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update user libraries",
		})
	}

	return c.JSON(fiber.Map{
		"message": "user libraries updated",
	})
}
