package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
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

	// Map으로 변환하여 프론트엔드에서 사용하기 편하게 함
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

	// Validate setting value
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

// validateSettingValue validates the setting key and value
func (h *SettingHandler) validateSettingValue(key, value string) error {
	switch key {
	case "app_language":
		valid := map[string]bool{"ko": true, "en": true, "ja": true}
		if !valid[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid app_language value. Allowed: ko, en, ja")
		}
	case "viewer_reading_mode":
		valid := map[string]bool{"single": true, "double": true, "vertical": true}
		if !valid[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_reading_mode value. Allowed: single, double, vertical")
		}
	case "viewer_reading_direction":
		valid := map[string]bool{"ltr": true, "rtl": true}
		if !valid[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_reading_direction value. Allowed: ltr, rtl")
		}
	case "viewer_fit_mode":
		valid := map[string]bool{"screen": true, "width": true, "height": true, "original": true}
		if !valid[value] {
			return fiber.NewError(fiber.StatusBadRequest, "Invalid viewer_fit_mode value. Allowed: screen, width, height, original")
		}
	default:
		// Unknown key, currently allowing it or reject?
		// Copilot review suggested: "허용되는 설정 키 목록(...)과 각 키에 대한 유효한 값의 범위를 검증해야 합니다."
		// Implies we should reject unknown keys or at least valid keys. 
		// For now, I'll strictly allow only these known keys for safety as per review.
		return fiber.NewError(fiber.StatusBadRequest, "Unknown setting key: "+key)
	}
	return nil
}
