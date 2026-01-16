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

	if err := h.repo.Update(key, body.Value); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to update setting",
		})
	}

	return c.JSON(fiber.Map{
		"message": "Setting updated successfully",
	})
}
