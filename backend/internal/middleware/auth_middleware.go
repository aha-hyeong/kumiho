package middleware

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type AuthMiddleware struct {
	authService *service.AuthService
}

func NewAuthMiddleware(authService *service.AuthService) *AuthMiddleware {
	return &AuthMiddleware{authService: authService}
}

// Protected JWT 인증이 필요한 라우트용 미들웨어
func (m *AuthMiddleware) Protected() fiber.Handler {
	return func(c *fiber.Ctx) error {
		candidateTokens := make([]string, 0, 3)

		// 1. Authorization 헤더 확인 (모바일 앱 등)
		// 헤더 토큰이 만료/손상된 경우에도 쿠키/쿼리로 폴백할 수 있도록 즉시 실패하지 않음.
		authHeader := c.Get("Authorization")
		if authHeader != "" {
			parts := strings.SplitN(authHeader, " ", 2)
			if len(parts) == 2 && strings.EqualFold(parts[0], "Bearer") && strings.TrimSpace(parts[1]) != "" {
				candidateTokens = append(candidateTokens, strings.TrimSpace(parts[1]))
			}
		}

		// 2. 쿠키 확인 (웹 클라이언트)
		if cookieToken := strings.TrimSpace(c.Cookies("access_token")); cookieToken != "" {
			candidateTokens = append(candidateTokens, cookieToken)
		}

		// 3. 쿼리 파라미터 확인 (이미지 로딩 등)
		if queryToken := strings.TrimSpace(c.Query("token")); queryToken != "" {
			candidateTokens = append(candidateTokens, queryToken)
		}

		// 모든 소스에서 토큰을 찾지 못하면 인증 실패
		if len(candidateTokens) == 0 {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"error": "missing authentication token",
			})
		}

		for _, tokenString := range candidateTokens {
			// 토큰 검증
			claims, err := m.authService.ValidateToken(tokenString)
			if err != nil {
				continue
			}

			// access 토큰인지 확인
			tokenType, ok := claims["type"].(string)
			if !ok || tokenType != "access" {
				continue
			}

			// 세션 유효성 확인 (sid 없는 구버전 토큰은 허용)
			sessionID, _ := claims["sid"].(string)
			userID, _ := claims["sub"].(string)
			var session *model.Session
			if sessionID != "" {
				var err error
				session, err = m.authService.GetSessionByID(sessionID)
				if err != nil || session == nil || session.UserID != userID {
					continue
				}
				m.authService.UpdateSessionLastActive(session)
			}

			// 사용자 정보 컨텍스트에 저장
			role, _ := claims["role"].(string)

			c.Locals("userID", userID)
			c.Locals("role", model.Role(role))
			c.Locals("sessionID", sessionID)

			// 세션 정보에서 기기 정보 추출하여 저장
			if session != nil {
				c.Locals("deviceID", session.ID)
				c.Locals("deviceName", session.DeviceName)
				c.Locals("session", session)
			}

			return c.Next()
		}

		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "invalid or expired token",
		})
	}
}

// MasterOnly MASTER 권한이 필요한 라우트용 미들웨어
func (m *AuthMiddleware) MasterOnly() fiber.Handler {
	return func(c *fiber.Ctx) error {
		role, ok := c.Locals("role").(model.Role)
		if !ok || role != model.RoleMaster {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "master access required",
			})
		}
		return c.Next()
	}
}

// GetUserID 컨텍스트에서 사용자 ID 조회
func GetUserID(c *fiber.Ctx) string {
	userID, _ := c.Locals("userID").(string)
	return userID
}

// GetUserRole 컨텍스트에서 사용자 역할 조회
func GetUserRole(c *fiber.Ctx) model.Role {
	role, _ := c.Locals("role").(model.Role)
	return role
}
