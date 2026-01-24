package handler

import (
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

type AuthHandler struct {
	authService *service.AuthService
	config      *config.Config
}

func NewAuthHandler(authService *service.AuthService, cfg *config.Config) *AuthHandler {
	return &AuthHandler{authService: authService, config: cfg}
}

// setAuthCookies Access/Refresh 토큰을 HttpOnly 쿠키로 설정
func (h *AuthHandler) setAuthCookies(c *fiber.Ctx, tokens *service.TokenResponse) {
	// Access Token 쿠키 (1시간)
	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    tokens.AccessToken,
		Expires:  time.Now().Add(time.Hour),
		HTTPOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: "Lax",
		Path:     "/",
		Domain:   h.config.CookieDomain,
	})

	// Refresh Token 쿠키 (7일)
	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    tokens.RefreshToken,
		Expires:  time.Now().Add(7 * 24 * time.Hour),
		HTTPOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: "Lax",
		Path:     "/api/v1/auth", // refresh 엔드포인트에서만 사용
		Domain:   h.config.CookieDomain,
	})
}

// clearAuthCookies 인증 쿠키 삭제
func (h *AuthHandler) clearAuthCookies(c *fiber.Ctx) {
	c.Cookie(&fiber.Cookie{
		Name:     "access_token",
		Value:    "",
		Expires:  time.Now().Add(-time.Hour),
		HTTPOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: "Lax",
		Path:     "/",
		Domain:   h.config.CookieDomain,
	})

	c.Cookie(&fiber.Cookie{
		Name:     "refresh_token",
		Value:    "",
		Expires:  time.Now().Add(-time.Hour),
		HTTPOnly: true,
		Secure:   h.config.CookieSecure,
		SameSite: "Lax",
		Path:     "/api/v1/auth",
		Domain:   h.config.CookieDomain,
	})
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

	// 쿠키 설정 (웹 클라이언트용)
	h.setAuthCookies(c, tokens)

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

	if req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "ID and password are required",
		})
	}

	tokens, err := h.authService.Login(&req)
	if err != nil {
		if err == service.ErrInvalidCredentials {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid ID or password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to login",
		})
	}

	// 쿠키 설정 (웹 클라이언트용)
	h.setAuthCookies(c, tokens)

	return c.JSON(tokens)
}

// Refresh 토큰 갱신
// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(c *fiber.Ctx) error {
	type RefreshRequest struct {
		RefreshToken string `json:"refresh_token"`
	}

	var req RefreshRequest
	// JSON 파싱 실패해도 쿠키에서 읽을 수 있으므로 경고만 출력
	if err := c.BodyParser(&req); err != nil {
		// log.Printf 대신 fiber의 컨텍스트를 통해 확인 가능
		_ = err
	}

	// 1. 요청 바디에서 refresh_token 확인
	refreshToken := req.RefreshToken

	// 2. 바디에 없으면 쿠키에서 확인
	if refreshToken == "" {
		refreshToken = c.Cookies("refresh_token")
	}

	if refreshToken == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "refresh_token is required",
		})
	}

	tokens, err := h.authService.RefreshToken(refreshToken)
	if err != nil {
		// 토큰 갱신 실패 시 쿠키도 삭제
		h.clearAuthCookies(c)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "invalid or expired refresh token",
		})
	}

	// 쿠키 갱신
	h.setAuthCookies(c, tokens)

	return c.JSON(tokens)
}

// Logout 로그아웃
// POST /api/v1/auth/logout
func (h *AuthHandler) Logout(c *fiber.Ctx) error {
	h.clearAuthCookies(c)
	return c.JSON(fiber.Map{
		"message": "logged out successfully",
	})
}

// Me 현재 사용자 정보
// GET /api/v1/auth/me
func (h *AuthHandler) Me(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "unauthorized",
		})
	}

	user, err := h.authService.GetUserByID(userID)
	if err != nil || user == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "user not found",
		})
	}

	return c.JSON(user)
}

// UpdateProfile 프로필 변경
// PUT /api/v1/auth/me
func (h *AuthHandler) UpdateProfile(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type UpdateProfileRequest struct {
		Nickname string `json:"nickname"`
	}

	var req UpdateProfileRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.Nickname == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "nickname is required",
		})
	}

	user, err := h.authService.UpdateProfile(userID, req.Nickname)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update profile",
		})
	}

	return c.JSON(user)
}

// ChangePassword 비밀번호 변경
// PUT /api/v1/auth/me/password
func (h *AuthHandler) ChangePassword(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type ChangePasswordRequest struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}

	var req ChangePasswordRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if req.OldPassword == "" || req.NewPassword == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "old_password and new_password are required",
		})
	}

	if len(req.NewPassword) < 8 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "new password must be at least 8 characters",
		})
	}

	if err := h.authService.ChangePassword(userID, req.OldPassword, req.NewPassword); err != nil {
		if err == service.ErrInvalidCredentials {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "invalid old password",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to change password",
		})
	}

	return c.JSON(fiber.Map{
		"message": "password changed successfully",
	})
}
