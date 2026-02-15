package handler

import (
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
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

// getClientIP 프록시/로드 밸런서를 고려하여 클라이언트 IP 추출
func getClientIP(c *fiber.Ctx) string {
	// 1. X-Forwarded-For 확인 (Nginx 등 프록시 환경)
	if xff := c.Get("X-Forwarded-For"); xff != "" {
		// 여러 IP가 있을 수 있으므로 첫 번째 IP 추출
		return strings.TrimSpace(strings.Split(xff, ",")[0])
	}

	// 2. X-Real-IP 확인
	if xrip := c.Get("X-Real-IP"); xrip != "" {
		return xrip
	}

	// 3. 직접 연결된 IP 반환 (로컬 개발 환경 등)
	return c.IP()
}

// getLoginContext 요청에서 기기 정보 추출
func (h *AuthHandler) getLoginContext(c *fiber.Ctx) *service.LoginContext {
	return &service.LoginContext{
		UserAgent: c.Get("User-Agent"),
		IPAddress: getClientIP(c),
	}
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
	if pErr := c.BodyParser(&req); pErr != nil {
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

	tokens, err := h.authService.Register(&req, h.getLoginContext(c))
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

	tokens, err := h.authService.Login(&req, h.getLoginContext(c))
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
	// 세션 삭제 (Refresh Token으로 해당 세션 찾기)
	refreshToken := c.Cookies("refresh_token")
	h.authService.LogoutByToken(refreshToken)

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

// === 세션 관리 엔드포인트 ===

// ListSessions 내 활성 세션 목록
// GET /api/v1/auth/sessions
func (h *AuthHandler) ListSessions(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	sessions, err := h.authService.GetUserSessions(userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get sessions",
		})
	}

	// 현재 세션 표시 (access token의 sid 클레임 사용)
	currentSessionID, _ := c.Locals("sessionID").(string)

	for i := range sessions {
		sessions[i].IsCurrent = sessions[i].ID == currentSessionID
	}

	if sessions == nil {
		return c.JSON(fiber.Map{"sessions": []interface{}{}})
	}

	return c.JSON(fiber.Map{"sessions": sessions})
}

// RevokeSession 특정 세션 삭제 (원격 로그아웃)
// DELETE /api/v1/auth/sessions/:id
func (h *AuthHandler) RevokeSession(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	sessionID := c.Params("id")

	if err := h.authService.RevokeSession(sessionID, userID); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "session not found",
		})
	}

	return c.JSON(fiber.Map{"message": "session revoked"})
}

// RevokeOtherSessions 현재 세션을 제외한 모든 세션 삭제
// DELETE /api/v1/auth/sessions
func (h *AuthHandler) RevokeOtherSessions(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	currentSessionID, _ := c.Locals("sessionID").(string)

	if err := h.authService.RevokeOtherSessions(userID, currentSessionID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to revoke sessions",
		})
	}

	return c.JSON(fiber.Map{"message": "other sessions revoked"})
}

// ListAllSessions 모든 유저의 활성 세션 (관리자용)
// GET /api/v1/users/sessions
func (h *AuthHandler) ListAllSessions(c *fiber.Ctx) error {
	sessions, err := h.authService.GetAllSessions()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get sessions",
		})
	}

	if sessions == nil {
		return c.JSON(fiber.Map{"sessions": []struct{}{}})
	}

	return c.JSON(fiber.Map{"sessions": sessions})
}

// RevokeSessionByAdmin 관리자가 특정 세션 강제 삭제
// DELETE /api/v1/users/:userId/sessions/:sessionId
func (h *AuthHandler) RevokeSessionByAdmin(c *fiber.Ctx) error {
	sessionID := c.Params("sessionId")

	if err := h.authService.RevokeSessionByAdmin(sessionID); err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "session not found",
		})
	}

	return c.JSON(fiber.Map{"message": "session revoked"})
}
