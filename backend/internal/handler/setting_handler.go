package handler

import (
	"fmt"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/gofiber/fiber/v2"
)

var (
	validLanguages        = map[string]bool{"ko": true, "en": true, "ja": true}
	validReadingModes     = map[string]bool{"single": true, "double": true, "vertical": true}
	validReadingDirections = map[string]bool{"ltr": true, "rtl": true}
	validFitModes         = map[string]bool{"screen": true, "width": true, "height": true, "original": true}
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

	// 뷰어 관련 설정이거나 사용자별 오버라이드가 필요한 설정인 경우 user_settings에 저장
	isViewerSetting := key == "viewer_reading_mode" ||
		key == "viewer_reading_direction" ||
		key == "viewer_click_direction" ||
		key == "viewer_keyboard_direction" ||
		key == "viewer_fit_mode" ||
		key == "viewer_preload_count" ||
		key == "viewer_pull_threshold" ||
		key == "viewer_pull_sensitivity" ||
		key == "viewer_show_threshold" ||
		key == "app_language"

	if isViewerSetting && userID != "" {
		if err := h.userRepo.Update(nil, userID, key, body.Value); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "Failed to update user setting",
			})
		}
	} else {
		// 관리자만 전역 설정을 변경할 수 있도록 제한 (옵션, 현재는 기존 로직 유지)
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
	if key == "scan_interval" {
		var interval int
		fmt.Sscanf(body.Value, "%d", &interval)
		h.scanner.StartScheduler(interval)
	} else if key == "scan_watch" {
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
	case "viewer_reading_direction", "viewer_click_direction", "viewer_keyboard_direction":
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
