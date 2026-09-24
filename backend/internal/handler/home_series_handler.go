package handler

import (
	"strconv"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

// GetHomeSeries returns only the recent LOCAL cards plus the user's accessible likes.
// Home bounds each horizontal card strip at 30; the system-likes library
// endpoint continues to provide the full bookmark list.
func (h *SeriesHandler) GetHomeSeries(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}
	section := c.Query("section")
	if section != "" && section != "updated" && section != "liked" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid section"})
	}
	master := middleware.GetUserRole(c) == model.RoleMaster
	var allowedIDs []string
	if !master {
		var err error
		allowedIDs, err = h.authService.GetAllowedLibraryIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
		}
	}
	updated := []model.Series{}
	if section != "liked" {
		periodDays := 7.0
		setting, err := h.settingRepo.GetByKey(nil, "updated_series_period")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch settings"})
		}
		if setting != nil {
			if parsed, e := strconv.ParseFloat(setting.Value, 64); e == nil && parsed > 0 && parsed <= 365 {
				// The previous Home used parseInt: sub-day values fell back to 7 days.
				if days := int(parsed); days > 0 {
					periodDays = float64(days)
				}
			}
		}
		cutoff := time.Now().Add(-time.Duration(periodDays * float64(24*time.Hour)))
		ids, err := h.seriesRepo.FindHomeRecentIDs(nil, cutoff, 30, allowedIDs, master)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch recent series"})
		}
		if len(ids) > 0 {
			found, e := h.seriesRepo.FindByIDs(nil, ids, userID)
			if e != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch recent series"})
			}
			byID := make(map[string]model.Series, len(found))
			for _, s := range found {
				byID[s.ID] = s
			}
			for _, id := range ids {
				if s, ok := byID[id]; ok {
					updated = append(updated, s)
				}
			}
		}
	}
	liked := []model.Series{}
	if section != "updated" {
		ids, err := h.seriesRepo.FindHomeLikedIDs(nil, userID, allowedIDs, master)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch liked series"})
		}
		if len(ids) > 0 {
			found, err := h.seriesRepo.FindByIDs(nil, ids, userID)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to fetch liked series"})
			}
			byID := make(map[string]model.Series, len(found))
			for _, s := range found {
				byID[s.ID] = s
			}
			for _, id := range ids {
				if s, ok := byID[id]; ok {
					liked = append(liked, s)
				}
			}
		}
	}
	cards := make([]model.Series, 0, len(updated)+len(liked))
	seen := make(map[string]bool, len(updated)+len(liked))
	for _, s := range updated {
		cards = append(cards, s)
		seen[s.ID] = true
	}
	for _, s := range liked {
		if !seen[s.ID] {
			cards = append(cards, s)
			seen[s.ID] = true
		}
	}
	if err := h.seriesEnrichSvc.EnrichHomeList(cards, userID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to enrich home series"})
	}
	h.assignHomeSeriesDisplayTitles(cards)
	byID := make(map[string]model.Series, len(cards))
	for _, s := range cards {
		byID[s.ID] = s
	}
	for i := range updated {
		updated[i] = byID[updated[i].ID]
	}
	for i := range liked {
		liked[i] = byID[liked[i].ID]
	}
	return c.JSON(fiber.Map{"updated_series": updated, "liked_series": liked})
}

// FindByIDs already joins libraries. Use that row's title setting rather than
// fetching each library (and its paths) again for this bounded Home list.
func (h *SeriesHandler) assignHomeSeriesDisplayTitles(cards []model.Series) {
	if len(cards) == 0 {
		return
	}
	locale := repository.PreferredOriginalTitleLocale(h.settingRepo)
	for i := range cards {
		library := model.Library{OriginalTitleOverride: cards[i].LibraryOriginalTitleOverride}
		h.applySeriesDisplayTitle(&cards[i], &library, locale)
	}
}
