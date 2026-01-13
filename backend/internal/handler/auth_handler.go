package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

type AuthHandler struct {
	authService *service.AuthService
}

func NewAuthHandler(authService *service.AuthService) *AuthHandler {
	return &AuthHandler{authService: authService}
}

// Setup 서버 초기 설정 상태 확인
// GET /api/v1/auth/setup
func (h *AuthHandler) Setup(c *fiber.Ctx) error {
	needsSetup, err := h.authService.NeedsSetup()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to check setup status",
		})
	}

	return c.JSON(fiber.Map{
		"needs_setup": needsSetup,
	})
}

// Register 최초 관리자 계정 생성 (사용자가 없을 때만 허용)
// POST /api/v1/auth/register
func (h *AuthHandler) Register(c *fiber.Ctx) error {
	// 사용자가 이미 존재하면 등록 불가
	needsSetup, err := h.authService.NeedsSetup()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to check setup status",
		})
	}
	if !needsSetup {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "registration is disabled. contact administrator to add users.",
		})
	}

	var req service.RegisterRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 유효성 검증
	if req.Username == "" || req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "username, email, and password are required",
		})
	}

	if len(req.Password) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "password must be at least 8 characters",
		})
	}

	tokens, err := h.authService.Register(&req)
	if err != nil {
		if err == service.ErrUserExists {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{
				"error": "user already exists",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to register user",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(tokens)
}

// Login 로그인
// POST /api/v1/auth/login
func (h *AuthHandler) Login(c *fiber.Ctx) error {
	var req service.LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Email == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "email and password are required",
		})
	}

	tokens, err := h.authService.Login(&req)
	if err != nil {
		if err == service.ErrInvalidCredentials {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid email or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to login",
		})
	}

	return c.JSON(tokens)
}

// Refresh 토큰 갱신
// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	type RefreshRequest struct {
		RefreshToken string `json:"refresh_token"`
	}

	var req RefreshRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.RefreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "refresh_token is required",
		})
	}

	tokens, err := h.authService.RefreshToken(req.RefreshToken)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "invalid or expired refresh token",
		})
	}

	return c.JSON(tokens)
}

// Me 현재 사용자 정보
// GET /api/v1/auth/me
func (h *AuthHandler) Me(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)

	user, err := h.authService.GetUserByID(userID)
	if err != nil || user == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	return c.JSON(user)
}
