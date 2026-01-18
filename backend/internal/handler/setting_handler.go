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
	settings, err := h.repo.GetAll()
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

	if err := h.repo.Update(key, body.Value); err != nil {
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
	default:
		// 보안을 위해 정의되지 않은 키는 거부합니다.
		return fiber.NewError(fiber.StatusBadRequest, "Unknown setting key")
	}
	return nil
}
