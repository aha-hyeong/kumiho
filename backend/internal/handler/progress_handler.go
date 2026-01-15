package handler

import (
	"fmt"
	"log"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

type ProgressHandler struct {
	progressRepo *repository.ReadingProgressRepository
	seriesRepo   *repository.SeriesRepository
	volumeRepo   *repository.VolumeRepository
	chapterRepo  *repository.ChapterRepository
}

func NewProgressHandler(
	progressRepo *repository.ReadingProgressRepository,
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
) *ProgressHandler {
	return &ProgressHandler{
		progressRepo: progressRepo,
		seriesRepo:   seriesRepo,
		volumeRepo:   volumeRepo,
		chapterRepo:  chapterRepo,
	}
}

// UpdateProgressRequest 진행도 업데이트 요청
type UpdateProgressRequest struct {
	VolumeID        *string `json:"volume_id"`
	ChapterID       *string `json:"chapter_id"`
	CurrentPage     int     `json:"current_page"`
	TotalPages      int     `json:"total_pages"`
	ProgressPercent float64 `json:"progress_percent"`
	DeviceID        *string `json:"device_id"`
	DeviceName      *string `json:"device_name"`
}

// GetProgress 시리즈별 읽기 진행도 조회
// GET /api/v1/series/:seriesId/progress
func (h *ProgressHandler) GetProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	progress, err := h.progressRepo.FindByUserAndSeries(userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progress == nil {
		return c.JSON(fiber.Map{
			"progress": nil,
		})
	}

	// 시리즈 정보 추가
	series, err := h.seriesRepo.FindByID(seriesID)
	if err != nil {
		log.Printf("Failed to fetch series %s: %v", seriesID, err)
	}

	// 요약 정보 계산 (권/화 진행도)
	progressSummary := fiber.Map{
		"current_volume_number":  0,
		"total_volumes":          0,
		"current_chapter_number": 0,
		"total_chapters":         0,
	}

	// 1. 전체 권/화 수 조회
	totalVolumes, err := h.volumeRepo.CountBySeriesID(seriesID)
	if err != nil {
		log.Printf("Failed to count volumes for series %s: %v", seriesID, err)
	} else {
		progressSummary["total_volumes"] = totalVolumes
	}

	totalChapters, err := h.chapterRepo.CountBySeriesID(seriesID)
	if err != nil {
		log.Printf("Failed to count chapters for series %s: %v", seriesID, err)
	} else {
		progressSummary["total_chapters"] = totalChapters
	}

	// 2. 현재 읽고 있는 권/화 번호 조회
	if progress.VolumeID != nil {
		volume, err := h.volumeRepo.FindByID(*progress.VolumeID)
		if err != nil {
			log.Printf("Failed to fetch volume %s: %v", *progress.VolumeID, err)
		} else if volume != nil {
			progressSummary["current_volume_number"] = volume.VolumeNumber
		}
	} else if progress.ChapterID != nil {
		// 챕터 ID로 볼륨 ID 추적
		chapter, err := h.chapterRepo.FindByID(*progress.ChapterID)
		if err != nil {
			log.Printf("Failed to fetch chapter %s: %v", *progress.ChapterID, err)
		} else if chapter != nil {
			volume, err := h.volumeRepo.FindByID(chapter.VolumeID)
			if err != nil {
				log.Printf("Failed to fetch volume %s: %v", chapter.VolumeID, err)
			} else if volume != nil {
				progressSummary["current_volume_number"] = volume.VolumeNumber
			}
		}
	}

	if progress.ChapterID != nil {
		chapter, err := h.chapterRepo.FindByID(*progress.ChapterID)
		if err != nil {
			log.Printf("Failed to fetch chapter %s: %v", *progress.ChapterID, err)
		} else if chapter != nil {
			progressSummary["current_chapter_number"] = chapter.ChapterNumber
		}
	}

	return c.JSON(fiber.Map{
		"progress": progress,
		"series":   series,
		"summary":  progressSummary,
	})
}

// GetVolumeProgress 볼륨 내 모든 챕터 읽기 진행도 조회
// GET /api/v1/volumes/:volumeId/progress
func (h *ProgressHandler) GetVolumeProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	volumeID := c.Params("volumeId")

	progressList, err := h.progressRepo.FindByUserAndVolume(userID, volumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progressList == nil {
		progressList = []model.ReadingProgress{}
	}

	return c.JSON(fiber.Map{
		"progress_list": progressList,
	})
}

// GetChapterProgress 챕터별 읽기 진행도 조회
// GET /api/v1/chapters/:chapterId/progress
func (h *ProgressHandler) GetChapterProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	chapterID := c.Params("chapterId")

	progress, err := h.progressRepo.FindByUserAndChapter(userID, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progress == nil {
		return c.JSON(fiber.Map{
			"progress": nil,
		})
	}

	return c.JSON(fiber.Map{
		"progress": progress,
	})
}

// UpdateProgress 읽기 진행도 업데이트
// PATCH /api/v1/series/:seriesId/progress
func (h *ProgressHandler) UpdateProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	var req UpdateProgressRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 시리즈 존재 확인
	series, err := h.seriesRepo.FindByID(seriesID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// VolumeID가 없으면 ChapterID로 추론 시도
	if req.VolumeID == nil && req.ChapterID != nil {
		if chapter, _ := h.chapterRepo.FindByID(*req.ChapterID); chapter != nil {
			req.VolumeID = &chapter.VolumeID
		}
	}

	progress := &model.ReadingProgress{
		UserID:          userID,
		SeriesID:        seriesID,
		VolumeID:        req.VolumeID,
		ChapterID:       req.ChapterID,
		CurrentPage:     req.CurrentPage,
		TotalPages:      req.TotalPages,
		ProgressPercent: req.ProgressPercent,
		DeviceID:        req.DeviceID,
		DeviceName:      req.DeviceName,
	}

	if err := h.progressRepo.Upsert(progress); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}

	return c.JSON(fiber.Map{
		"message":  "progress updated",
		"progress": progress,
	})
}

// GetAllProgress 모든 읽기 진행도 조회
// GET /api/v1/reading-progress
func (h *ProgressHandler) GetAllProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	progressList, err := h.progressRepo.FindByUser(userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progressList == nil {
		progressList = []model.ReadingProgress{}
	}

	return c.JSON(fiber.Map{
		"reading_progress": progressList,
	})
}

// GetRecentProgress 최근 읽기 진행도 (이어보기 목록)
// GET /api/v1/reading-progress/recent
func (h *ProgressHandler) GetRecentProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	limit := c.QueryInt("limit", 10)

	progressList, err := h.progressRepo.FindRecentByUser(userID, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progressList == nil {
		progressList = []model.ReadingProgress{}
	}

	// 시리즈 정보 추가
	type ProgressWithSeries struct {
		model.ReadingProgress
		SeriesTitle   string  `json:"series_title"`
		ThumbnailURL  *string `json:"thumbnail_url"`
		VolumeNumber  int     `json:"volume_number"`
		VolumeTitle   string  `json:"volume_title"`
		ChapterNumber int     `json:"chapter_number"`
		ChapterTitle  string  `json:"chapter_title"`
	}

	result := make([]ProgressWithSeries, len(progressList))
	for i, p := range progressList {
		result[i] = ProgressWithSeries{
			ReadingProgress: p,
		}
		
		// 시리즈 정보
		if series, _ := h.seriesRepo.FindByID(p.SeriesID); series != nil {
			result[i].SeriesTitle = series.Title
			
			// 썸네일 결정: 1. 시리즈 썸네일
			if series.ThumbnailPath != nil {
				// 시리즈 썸네일이 있으면 사용 (우선순위가 낮음? 보통 권 표지가 더 좋음)
				// 하지만 현재 로직상 시리즈 썸네일을 먼저 체크
			}
			
			// 시리즈 썸네일 URL 생성 (임시 로직, pageID 기반)
			pageID, err := h.seriesRepo.GetFirstPageID(series.ID)
			if err == nil && pageID != "" {
				url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
				result[i].ThumbnailURL = &url
			}
		}

		// 챕터 정보 조회 및 설정
		var chapter *model.Chapter
		if p.ChapterID != nil {
			if c, _ := h.chapterRepo.FindByID(*p.ChapterID); c != nil {
				chapter = c
				result[i].ChapterNumber = chapter.ChapterNumber
				result[i].ChapterTitle = chapter.Title
			}
		}

		// 볼륨 ID 결정 (명시적 ID 우선, 없으면 챕터의 VolumeID 사용)
		var targetVolumeID string
		if p.VolumeID != nil {
			targetVolumeID = *p.VolumeID
		} else if chapter != nil {
			targetVolumeID = chapter.VolumeID
		}

		// 볼륨 정보 조회 및 설정
		if targetVolumeID != "" {
			if volume, _ := h.volumeRepo.FindByID(targetVolumeID); volume != nil {
				result[i].VolumeNumber = volume.VolumeNumber
				result[i].VolumeTitle = volume.Title

				// 볼륨 썸네일이 있으면 덮어쓰기 (권 표지가 시리즈 표지보다 구체적이므로)
				pageID, err := h.volumeRepo.GetFirstPageID(volume.ID)
				if err == nil && pageID != "" {
					url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
					result[i].ThumbnailURL = &url
				}
			}
		}
	}

	return c.JSON(fiber.Map{
		"recent_progress": result,
	})
}

// SyncProgress 벌크 싱크 (오프라인 후 복귀)
// POST /api/v1/reading-progress/sync
func (h *ProgressHandler) SyncProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	type SyncRequest struct {
		ProgressList []UpdateProgressRequest `json:"progress_list"`
		SeriesID     string                  `json:"series_id"`
	}

	type SyncItem struct {
		SeriesID        string  `json:"series_id"`
		VolumeID        *string `json:"volume_id"`
		ChapterID       *string `json:"chapter_id"`
		CurrentPage     int     `json:"current_page"`
		TotalPages      int     `json:"total_pages"`
		ProgressPercent float64 `json:"progress_percent"`
		DeviceID        *string `json:"device_id"`
		DeviceName      *string `json:"device_name"`
	}

	var req struct {
		Items []SyncItem `json:"items"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	synced := 0
	errors := []string{}

	for _, item := range req.Items {
		progress := &model.ReadingProgress{
			UserID:          userID,
			SeriesID:        item.SeriesID,
			VolumeID:        item.VolumeID,
			ChapterID:       item.ChapterID,
			CurrentPage:     item.CurrentPage,
			TotalPages:      item.TotalPages,
			ProgressPercent: item.ProgressPercent,
			DeviceID:        item.DeviceID,
			DeviceName:      item.DeviceName,
		}

		if err := h.progressRepo.Upsert(progress); err != nil {
			errors = append(errors, item.SeriesID+": "+err.Error())
		} else {
			synced++
		}
	}

	return c.JSON(fiber.Map{
		"message": "sync completed",
		"synced":  synced,
		"errors":  errors,
	})
}

// CompareProgress 서버와 로컬 진행도 비교 (밀리 스타일 싱크용)
// POST /api/v1/series/:seriesId/progress/compare
func (h *ProgressHandler) CompareProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	var localProgress struct {
		VolumeNumber  int `json:"volume_number"`
		ChapterNumber int `json:"chapter_number"`
		CurrentPage   int `json:"current_page"`
	}

	if err := c.BodyParser(&localProgress); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 서버 진행도 조회
	serverProgress, err := h.progressRepo.FindByUserAndSeries(userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch server progress",
		})
	}

	if serverProgress == nil {
		// 서버에 진행도가 없으면 로컬을 사용하라고 응답
		return c.JSON(fiber.Map{
			"sync_needed":     false,
			"server_progress": nil,
		})
	}

	// 서버 진행도의 볼륨/챕터 번호 조회
	serverVolumeNum := 0
	serverChapterNum := 0

	if serverProgress.VolumeID != nil {
		if volume, _ := h.volumeRepo.FindByID(*serverProgress.VolumeID); volume != nil {
			serverVolumeNum = volume.VolumeNumber
		}
	}
	if serverProgress.ChapterID != nil {
		if chapter, _ := h.chapterRepo.FindByID(*serverProgress.ChapterID); chapter != nil {
			serverChapterNum = chapter.ChapterNumber
		}
	}

	// 비교: 권 > 화 > 페이지 순서로 어디가 더 앞인지 판단
	serverAhead := false
	localAhead := false

	if serverVolumeNum > localProgress.VolumeNumber {
		serverAhead = true
	} else if serverVolumeNum < localProgress.VolumeNumber {
		localAhead = true
	} else if serverChapterNum > localProgress.ChapterNumber {
		serverAhead = true
	} else if serverChapterNum < localProgress.ChapterNumber {
		localAhead = true
	} else if serverProgress.CurrentPage > localProgress.CurrentPage {
		serverAhead = true
	} else if serverProgress.CurrentPage < localProgress.CurrentPage {
		localAhead = true
	}

	return c.JSON(fiber.Map{
		"sync_needed":  serverAhead || localAhead,
		"server_ahead": serverAhead,
		"local_ahead":  localAhead,
		"server_progress": fiber.Map{
			"volume_number":  serverVolumeNum,
			"chapter_number": serverChapterNum,
			"current_page":   serverProgress.CurrentPage,
			"device_name":    serverProgress.DeviceName,
			"updated_at":     serverProgress.UpdatedAt,
		},
	})
}
