package handler

import (
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

type StatsHandler struct {
	progressRepo   *repository.ReadingProgressRepository
	completionRepo *repository.VolumeCompletionRepository
}

func NewStatsHandler(progressRepo *repository.ReadingProgressRepository, completionRepo *repository.VolumeCompletionRepository) *StatsHandler {
	return &StatsHandler{
		progressRepo:   progressRepo,
		completionRepo: completionRepo,
	}
}

type PersonalStatsResponse struct {
	TotalSeries    int                         `json:"total_series"`
	TotalReadTime  int                         `json:"total_read_time"` // seconds
	TotalVolumes   int                         `json:"total_volumes"`   // Completed volumes
	TotalChapters  int                         `json:"total_chapters"`
	TotalCompletedSeries int                         `json:"total_completed_series"`
	DailyActivity  []repository.DailyActivity  `json:"daily_activity"`
	HourlyActivity []repository.HourlyActivity `json:"hourly_activity"`
	TopSeries      []model.Series              `json:"top_series"`
}

// GetPersonalStats returns reading statistics for the current user
// GET /api/v1/stats/personal
func (h *StatsHandler) GetPersonalStats(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	db := database.DB // Using the global DB connection

	// Fetch all stats
	// 1. Total Series Read
	totalSeries, err := h.progressRepo.CountTotalSeriesRead(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count series"})
	}

	totalReadTime, err := h.progressRepo.CountTotalReadTime(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count read time"})
	}

	// 2. Total Volumes Completed (from completions)
	totalVolumes, err := h.completionRepo.CountTotalCompleted(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count volumes"})
	}

	// 3. Total Chapters Read
	totalChapters, err := h.progressRepo.CountTotalChaptersRead(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count chapters"})
	}

	// 4. Completed Series
	totalCompletedSeries, err := h.completionRepo.CountCompletedSeries(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to count completed series"})
	}

	// 5. Daily Activity (Heatmap) - Last 365 days
	dailyActivity, err := h.progressRepo.GetDailyActivity(db, userID, 365)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get daily activity"})
	}
	if dailyActivity == nil {
		dailyActivity = []repository.DailyActivity{}
	}

	// 6. Hourly Activity
	hourlyActivity, err := h.progressRepo.GetHourlyActivity(db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get hourly activity"})
	}
	if hourlyActivity == nil {
		hourlyActivity = []repository.HourlyActivity{}
	}

	// 7. Top Series
	topSeries, err := h.progressRepo.GetTopSeries(db, userID, 5)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to get top series"})
	}
	if topSeries == nil {
		topSeries = []model.Series{}
	}

	return c.JSON(PersonalStatsResponse{
		TotalSeries:    totalSeries,
		TotalReadTime:  totalReadTime,
		TotalVolumes:   totalVolumes,
		TotalChapters:  totalChapters,
		TotalCompletedSeries: totalCompletedSeries,
		DailyActivity:  dailyActivity,
		HourlyActivity: hourlyActivity,
		TopSeries:      topSeries,
	})
}

// HeartbeatRequest 하트비트 요청 바디
type HeartbeatRequest struct {
	SeriesID string `json:"series_id"`
	Seconds  int    `json:"seconds"`
}

// UpdateReadingTime 하트비트 수신 및 읽은 시간 누적
// POST /api/v1/stats/heartbeat
func (h *StatsHandler) UpdateReadingTime(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	var req HeartbeatRequest

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid request body"})
	}

	if req.SeriesID == "" || req.Seconds <= 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid parameters"})
	}

	// 최대 1회 업데이트 시간을 제한 (예: 5분)하여 조작 방지
	isCapped := false
	originalSeconds := req.Seconds
	if req.Seconds > 300 {
		req.Seconds = 300
		isCapped = true
	}

	db := database.DB
	rowsAffected, err := h.progressRepo.UpdateReadingTime(db, userID, req.SeriesID, req.Seconds)
	if err != nil {
		// 로깅 추가
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update reading time",
		})
	}

	if rowsAffected == 0 {
		// 진행도가 아예 없는 경우(아직 페이지를 안 넘겨서 upsert전)
		// 204 No Content를 반환하여 데이터가 기록되지 않았음을 명시적으로 알림
		return c.SendStatus(fiber.StatusNoContent)
	}

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status":           "ok",
		"recorded_seconds": req.Seconds,
		"original_seconds": originalSeconds,
		"is_capped":        isCapped,
	})
}
