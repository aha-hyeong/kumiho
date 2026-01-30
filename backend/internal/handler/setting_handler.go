package handler

import (
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
)

var (
	validLanguages         = map[string]bool{"ko": true, "en": true, "ja": true}
	validReadingModes      = map[string]bool{"single": true, "double": true, "vertical": true}
	validReadingDirections = map[string]bool{"ltr": true, "rtl": true}
	validFitModes          = map[string]bool{"screen": true, "width": true, "height": true, "original": true}

	// 사용자별로 저장 가능한 설정 키 목록 (여기에 포함되면 user_settings 테이블에 저장)
	userSplittableSettings = map[string]bool{
		"app_language":              true,
		"home_layout_order":         true, // 홈 화면 섹션 순서 추가
		"viewer_reading_mode":       true,
		"viewer_reading_direction":  true,
		"viewer_click_direction":    true,
		"viewer_keyboard_direction": true,
		"swipe_direction":           true, // 스와이프 방향 (전역)
		"viewer_fit_mode":           true,
		"viewer_preload_count":      true,
		"viewer_pull_threshold":     true,
		"viewer_pull_sensitivity":   true,
		"viewer_show_threshold":     true,
		"bgm_enabled":               true,
	}
)

type SettingHandler struct {
	repo     repository.SettingRepository
	userRepo repository.UserSettingRepository
	scanner  *scanner.Scanner
}

func NewSettingHandler(repo repository.SettingRepository, userRepo repository.UserSettingRepository, scanner *scanner.Scanner) *SettingHandler {
	return &SettingHandler{
		repo:     repo,
		userRepo: userRepo,
		scanner:  scanner,
	}
}

// ListSettings 모든 설정 조회
func (h *SettingHandler) ListSettings(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	// 1. 전역 설정 조회
	settings, err := h.repo.GetAll(nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch settings",
		})
	}

	settingsMap := make(map[string]string)
	for _, s := range settings {
		settingsMap[s.Key] = s.Value
	}

	// 2. 사용자별 설정이 있으면 덮어쓰기
	if userID != "" {
		userSettings, err := h.userRepo.GetByUser(nil, userID)
		if err == nil {
			for _, s := range userSettings {
				settingsMap[s.Key] = s.Value
			}
		}
	}

	return c.JSON(settingsMap)
}

// UpdateSetting 설정 업데이트
func (h *SettingHandler) UpdateSetting(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	key := c.Params("key")
	var body struct {
		Value string `json:"value"`
	}

	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	if err := h.validateSettingValue(key, body.Value); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": err.Error(),
		})
	}

	// 사용자별 설정인지 확인
	isUserSetting := userSplittableSettings[key]

	if isUserSetting && userID != "" {
		if err := h.userRepo.Update(nil, userID, key, body.Value); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to update user setting",
			})
		}
	} else {
		// 관리자만 전역 설정을 변경할 수 있도록 제한
		role := middleware.GetUserRole(c)
		if role != model.RoleMaster {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "Master access required to update global settings",
			})
		}

		if err := h.repo.Update(nil, key, body.Value); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to update setting",
			})
		}
	}

	// 설정 변경에 따른 스캐너 동작 즉시 반영
	switch key {
	case "scan_interval":
		var interval int
		_, _ = fmt.Sscanf(body.Value, "%d", &interval)
		h.scanner.StartScheduler(interval)
	case "scan_watch":
		if body.Value == "true" {
			if err := h.scanner.StartWatcher(); err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": "Failed to start file watcher: " + err.Error(),
				})
			}
		} else {
			h.scanner.StopWatcher()
		}
	}

	return c.JSON(fiber.Map{
		"message": "Setting updated successfully",
	})
}

// validateSettingValue는 설정 키와 값의 유효성을 검증합니다.
func (h *SettingHandler) validateSettingValue(key, value string) error {
	switch key {
	case "app_language":
		if !validLanguages[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid app_language value")
		}
	case "viewer_reading_mode":
		if !validReadingModes[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_reading_mode value")
		}
	case "viewer_reading_direction", "viewer_click_direction", "viewer_keyboard_direction", "swipe_direction":
		if !validReadingDirections[value] {
			return fiber.NewError(fiber.StatusBadRequest, fmt.Sprintf("Invalid %s value", key))
		}
	case "viewer_fit_mode":
		if !validFitModes[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_fit_mode value")
		}
	case "viewer_preload_count":
		if !h.isValidNumber(value, 1, 20) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_preload_count value (must be 1-20)")
		}
	case "viewer_pull_threshold":
		if !h.isValidNumber(value, 50, 500) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_pull_threshold value (must be 50-500)")
		}
	case "viewer_pull_sensitivity":
		if !h.isValidFloat(value, 0.1, 5.0) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_pull_sensitivity value (must be 0.1-5.0)")
		}
	case "viewer_show_threshold":
		if !h.isValidNumber(value, 1, 100) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_show_threshold value (must be 1-100)")
		}
	case "home_layout_order":
		// Allow any string value (it will be a comma-separated list of section IDs)
		return nil
	case "scan_interval":
		// 0 = off, otherwise minutes
		if !h.isValidNumber(value, 0, 10080) { // Max 1 week (just a reasonable limit)
			return fiber.NewError(fiber.StatusBadRequest, "Invalid scan_interval value (must be 0-10080 minutes)")
		}
	case "scan_watch":
		if value != "true" && value != "false" {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid scan_watch value (must be 'true' or 'false')")
		}
	case "updated_series_period":
		// Allow positive float values (days)
		if !h.isValidFloat(value, 0.0001, 365.0) {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid updated_series_period value (must be between 0.0001 and 365.0 days)")
		}
	case "scan_performance_level":
		if value != "1" && value != "2" && value != "4" {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid scan_performance_level value (must be 1, 2, or 4)")
		}
	case "bgm_enabled":
		if value != "true" && value != "false" {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid bgm_enabled value (must be 'true' or 'false')")
		}
	default:
		// 보안을 위해 정의되지 않은 키는 거부합니다.
		return fiber.NewError(fiber.StatusBadRequest, "Unknown setting key")
	}
	return nil
}

func (h *SettingHandler) isValidNumber(value string, min, max int) bool {
	var n int
	if _, err := fmt.Sscanf(value, "%d", &n); err != nil {
		return false
	}
	return n >= min && n <= max
}

func (h *SettingHandler) isValidFloat(value string, min, max float64) bool {
	var n float64
	if _, err := fmt.Sscanf(value, "%f", &n); err != nil {
		return false
	}
	return n >= min && n <= max
}
