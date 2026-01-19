package handler

import (
	"fmt"

	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

var (
	validLanguages        = map[string]bool{"ko": true, "en": true, "ja": true}
	validReadingModes     = map[string]bool{"single": true, "double": true, "vertical": true}
	validReadingDirections = map[string]bool{"ltr": true, "rtl": true}
	validFitModes         = map[string]bool{"screen": true, "width": true, "height": true, "original": true}
)

type SettingHandler struct {
	repo repository.SettingRepository
}

func NewSettingHandler(repo repository.SettingRepository) *SettingHandler {
	return &SettingHandler{
		repo: repo,
	}
}

// ListSettings 모든 설정 조회
func (h *SettingHandler) ListSettings(c *fiber.Ctx) error {
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

	return c.JSON(settingsMap)
}

// UpdateSetting 설정 업데이트
func (h *SettingHandler) UpdateSetting(c *fiber.Ctx) error {
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

	if err := h.repo.Update(nil, key, body.Value); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update setting",
		})
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
