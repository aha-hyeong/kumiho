package handler

import (
	"context"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
	"golang.org/x/sync/errgroup"
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
	TotalSeries          int                         `json:"total_series"`
	TotalReadTime        int                         `json:"total_read_time"` // seconds
	TotalVolumes         int                         `json:"total_volumes"`   // Completed volumes
	TotalChapters        int                         `json:"total_chapters"`
	TotalCompletedSeries int                         `json:"total_completed_series"`
	DailyActivity      []repository.DailyActivity  `json:"daily_activity"`
	HourlyActivity     []repository.HourlyActivity `json:"hourly_activity"`
	TopSeries          []model.Series              `json:"top_series"`
}

// GetPersonalStats returns reading statistics for the current user
// GET /api/v1/stats/personal
func (h *StatsHandler) GetPersonalStats(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	db := database.DB

	var (
		totalSeries          int
		totalReadTime        int
		totalVolumes         int
		totalChapters        int
		totalCompletedSeries int
		dailyActivity        []repository.DailyActivity
		hourlyActivity       []repository.HourlyActivity
		topSeries            []model.Series
	)

	g, _ := errgroup.WithContext(context.Background())

	// 1. Total Series Read
	g.Go(func() error {
		var err error
		totalSeries, err = h.progressRepo.CountTotalSeriesRead(db, userID)
		return err
	})

	// 2. Total Read Time
	g.Go(func() error {
		var err error
		totalReadTime, err = h.progressRepo.CountTotalReadTime(db, userID)
		return err
	})

	// 3. Total Volumes Completed
	g.Go(func() error {
		var err error
		totalVolumes, err = h.completionRepo.CountTotalCompleted(db, userID)
		return err
	})

	// 4. Total Chapters Read
	g.Go(func() error {
		var err error
		totalChapters, err = h.progressRepo.CountTotalChaptersRead(db, userID)
		return err
	})

	// 5. Completed Series
	g.Go(func() error {
		var err error
		totalCompletedSeries, err = h.completionRepo.CountCompletedSeries(db, userID)
		return err
	})

	// 6. Daily Activity
	g.Go(func() error {
		var err error
		dailyActivity, err = h.progressRepo.GetDailyActivity(db, userID, 365)
		return err
	})

	// 7. Hourly Activity
	g.Go(func() error {
		var err error
		hourlyActivity, err = h.progressRepo.GetHourlyActivity(db, userID)
		return err
	})

	// 8. Top Series
	g.Go(func() error {
		var err error
		topSeries, err = h.progressRepo.GetTopSeries(db, userID, 5)
		return err
	})

	if err := g.Wait(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	if dailyActivity == nil {
		dailyActivity = []repository.DailyActivity{}
	}
	if hourlyActivity == nil {
		hourlyActivity = []repository.HourlyActivity{}
	}
	if topSeries == nil {
		topSeries = []model.Series{}
	}

	return c.JSON(PersonalStatsResponse{
		TotalSeries:          totalSeries,
		TotalReadTime:        totalReadTime,
		TotalVolumes:         totalVolumes,
		TotalChapters:        totalChapters,
		TotalCompletedSeries: totalCompletedSeries,
		DailyActivity:        dailyActivity,
		HourlyActivity:       hourlyActivity,
		TopSeries:            topSeries,
	})
}

// HeartbeatRequest 하트비트 요청 바디
type HeartbeatRequest struct {
	SeriesID  string `json:"series_id"`
	ChapterID string `json:"chapter_id"` // 추가
	Seconds   int    `json:"seconds"`
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
	rowsAffected, err := h.progressRepo.UpdateReadingTime(db, userID, req.SeriesID, req.ChapterID, req.Seconds)
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
