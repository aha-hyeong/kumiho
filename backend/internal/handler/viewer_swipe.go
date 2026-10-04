package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/gofiber/fiber/v2"
)

func (h *SeriesHandler) getSwipeSettings(q database.Queryer, userID, seriesID string) (ViewerSwipeSettings, error) {
	seriesOverride, err := h.userSeriesSettingRepo.Get(q, userID, seriesID)
	if err != nil {
		return ViewerSwipeSettings{}, err
	}
	return h.resolveSwipeSettings(q, userID, seriesOverride)
}

// GetSwipeSettings is a small settings-only read for preloaded chapter entry.
func (h *SeriesHandler) GetSwipeSettings(c *fiber.Ctx) error {
	settings, err := h.getSwipeSettings(nil, middleware.GetUserID(c), c.Params("id"))
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch swipe settings"})
	}
	return c.JSON(settings)
}

// ResetSwipeDirection clears only this user x series swipe override.
func (h *SeriesHandler) ResetSwipeDirection(c *fiber.Ctx) error {
	tx, err := database.DB.BeginTx(c.Context(), nil)
	if err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	defer func() { _ = tx.Rollback() }()
	userID, seriesID := middleware.GetUserID(c), c.Params("id")
	if clearErr := h.userSeriesSettingRepo.ClearSwipeDirection(tx, userID, seriesID); clearErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to reset swipe direction"})
	}
	settings, err := h.getSwipeSettings(tx, userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch swipe settings"})
	}
	if err := tx.Commit(); err != nil {
		return c.SendStatus(fiber.StatusInternalServerError)
	}
	return c.JSON(settings)
}

// ViewerSwipeSettings keeps user defaults distinct from user x series overrides.
// Server settings deliberately do not participate in this preference.
type ViewerSwipeSettings struct {
	UserDefault        string  `json:"user_default"`
	SeriesOverride     *string `json:"series_override"`
	EffectiveDirection string  `json:"effective_direction"`
}

func (h *SeriesHandler) resolveSwipeSettings(q database.Queryer, userID string, seriesOverride *model.UserSeriesSetting) (ViewerSwipeSettings, error) {
	result := ViewerSwipeSettings{UserDefault: "ltr", EffectiveDirection: "ltr"}
	userDefault, err := h.userSettingRepo.GetByKey(q, userID, "swipe_direction")
	if err != nil {
		return result, err
	}
	if userDefault != nil && validReadingDirections[userDefault.Value] {
		result.UserDefault = userDefault.Value
	}
	result.EffectiveDirection = result.UserDefault
	if seriesOverride != nil && seriesOverride.SwipeDirection != nil && validReadingDirections[*seriesOverride.SwipeDirection] {
		result.SeriesOverride = seriesOverride.SwipeDirection
		result.EffectiveDirection = *seriesOverride.SwipeDirection
	}
	return result, nil
}
