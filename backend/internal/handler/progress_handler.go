package handler

import (
	"fmt"
	"log"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type ProgressHandler struct {
	progressRepo   *repository.ReadingProgressRepository
	seriesRepo     *repository.SeriesRepository
	authService    *service.AuthService
	volumeRepo     *repository.VolumeRepository
	chapterRepo    *repository.ChapterRepository
	completionRepo *repository.VolumeCompletionRepository
}

func NewProgressHandler(
	progressRepo *repository.ReadingProgressRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	completionRepo *repository.VolumeCompletionRepository,
) *ProgressHandler {
	return &ProgressHandler{
		progressRepo:   progressRepo,
		seriesRepo:     seriesRepo,
		authService:    authService,
		volumeRepo:     volumeRepo,
		chapterRepo:    chapterRepo,
		completionRepo: completionRepo,
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

	progress, err := h.progressRepo.FindByUserAndSeries(nil, userID, seriesID)
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
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
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
	totalVolumes, err := h.volumeRepo.CountBySeriesID(nil, seriesID)
	if err != nil {
		log.Printf("Failed to count volumes for series %s: %v", seriesID, err)
	} else {
		progressSummary["total_volumes"] = totalVolumes
	}

	totalChapters, err := h.chapterRepo.CountBySeriesID(nil, seriesID)
	if err != nil {
		log.Printf("Failed to count chapters for series %s: %v", seriesID, err)
	} else {
		progressSummary["total_chapters"] = totalChapters
	}

	// 2. 현재 읽고 있는 권/화 번호 조회
	if progress.VolumeID != nil {
		volume, err := h.volumeRepo.FindByID(nil, *progress.VolumeID)
		if err != nil {
			log.Printf("Failed to fetch volume %s: %v", *progress.VolumeID, err)
		} else if volume != nil {
			progressSummary["current_volume_number"] = volume.VolumeNumber
		}
	} else if progress.ChapterID != nil {
		// 챕터 ID로 볼륨 ID 추적
		chapter, err := h.chapterRepo.FindByID(nil, *progress.ChapterID)
		if err != nil {
			log.Printf("Failed to fetch chapter %s: %v", *progress.ChapterID, err)
		} else if chapter != nil {
			volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
			if err != nil {
				log.Printf("Failed to fetch volume %s: %v", chapter.VolumeID, err)
			} else if volume != nil {
				progressSummary["current_volume_number"] = volume.VolumeNumber
			}
		}
	}

	if progress.ChapterID != nil {
		chapter, err := h.chapterRepo.FindByID(nil, *progress.ChapterID)
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

	progressList, err := h.progressRepo.FindByUserAndVolume(nil, userID, volumeID)
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

	progress, err := h.progressRepo.FindByUserAndChapter(nil, userID, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progress == nil {
		// 진행도가 없을 때 완독 여부 확인
		chapter, err := h.chapterRepo.FindByID(nil, chapterID)
		if err == nil && chapter != nil {
			isCompleted, _ := h.completionRepo.IsCompleted(nil, userID, chapter.VolumeID)
			if isCompleted {
				// 완독된 볼륨의 챕터라면 마지막 페이지 정보를 가상으로 생성하여 반환
				return c.JSON(fiber.Map{
					"progress": &model.ReadingProgress{
						UserID:      userID,
						ChapterID:   &chapterID,
						VolumeID:    &chapter.VolumeID,
						CurrentPage: chapter.PageCount,
						TotalPages:  chapter.PageCount,
					},
				})
			}
		}

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
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// VolumeID가 없으면 ChapterID로 추론 시도
	if req.VolumeID == nil && req.ChapterID != nil {
		if chapter, _ := h.chapterRepo.FindByID(nil, *req.ChapterID); chapter != nil {
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

	// 진행도 저장
	if err := h.progressRepo.Upsert(nil, progress); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}

	// 완독 상태 해제 체크
	h.removeCompletionIfIncomplete(userID, req.VolumeID, req.CurrentPage, req.TotalPages)

	// 자동 완독 처리 (마지막 챕터의 마지막 페이지 도달 시)
	h.markCompleteIfLastPage(userID, req.VolumeID, req.ChapterID, req.CurrentPage, req.TotalPages)

	return c.JSON(fiber.Map{
		"message":  "progress updated",
		"progress": progress,
	})
}

// GetAllProgress 모든 읽기 진행도 조회
// GET /api/v1/reading-progress
func (h *ProgressHandler) GetAllProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)

	progressList, err := h.progressRepo.FindByUser(nil, userID)
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

	progressList, err := h.progressRepo.FindRecentByUser(nil, userID, limit)
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
		if series, _ := h.seriesRepo.FindByID(nil, p.SeriesID, userID); series != nil {
			result[i].SeriesTitle = series.Title

			// 썸네일 결정: 1. 시리즈 썸네일
			// 현재 로직상 시리즈 썸네일을 먼저 체크하지만, 권 표지가 있다면 덮어씌워짐 (향후 구현 예정)

			// 시리즈 썸네일 URL 생성 (임시 로직, pageID 기반)
			pageID, err := h.seriesRepo.GetFirstPageID(nil, series.ID)
			if err == nil && pageID != "" {
				url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
				result[i].ThumbnailURL = &url
			}
		}

		// 챕터 정보 조회 및 설정
		var chapter *model.Chapter
		if p.ChapterID != nil {
			if c, _ := h.chapterRepo.FindByID(nil, *p.ChapterID); c != nil {
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
			if volume, _ := h.volumeRepo.FindByID(nil, targetVolumeID); volume != nil {
				result[i].VolumeNumber = volume.VolumeNumber
				result[i].VolumeTitle = volume.Title

				// 볼륨 썸네일이 있으면 덮어쓰기 (권 표지가 시리즈 표지보다 구체적이므로)
				pageID, err := h.volumeRepo.GetFirstPageID(nil, volume.ID)
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

		if err := h.progressRepo.Upsert(nil, progress); err != nil {
			errors = append(errors, item.SeriesID+": "+err.Error())
		} else {
			synced++

			// 완독 상태 해제 체크
			h.removeCompletionIfIncomplete(userID, item.VolumeID, item.CurrentPage, item.TotalPages)

			// 자동 완독 처리 (마지막 챕터의 마지막 페이지 도달 시)
			h.markCompleteIfLastPage(userID, item.VolumeID, item.ChapterID, item.CurrentPage, item.TotalPages)
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
	serverProgress, err := h.progressRepo.FindByUserAndSeries(nil, userID, seriesID)
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
		if volume, _ := h.volumeRepo.FindByID(nil, *serverProgress.VolumeID); volume != nil {
			serverVolumeNum = volume.VolumeNumber
		}
	}
	if serverProgress.ChapterID != nil {
		if chapter, _ := h.chapterRepo.FindByID(nil, *serverProgress.ChapterID); chapter != nil {
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

// MarkVolumeComplete 볼륨 완료 표시
// POST /api/v1/volumes/:volumeId/complete
func (h *ProgressHandler) MarkVolumeComplete(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	volumeID := c.Params("volumeId")

	// 볼륨 존재 확인
	volume, err := h.volumeRepo.FindByID(nil, volumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume not found",
		})
	}

	// 이미 완료된 경우 무시 (중복 요청 처리)
	isCompleted, err := h.completionRepo.IsCompleted(nil, userID, volumeID)
	if err == nil && isCompleted {
		return c.JSON(fiber.Map{
			"message": "volume already marked as complete",
		})
	}

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	// 볼륨 내 모든 챕터의 진행도를 100%로 업데이트
	chapters, err := h.chapterRepo.FindByVolumeID(tx, volumeID)
	if err != nil {
		log.Printf("Failed to get chapters for volume %s: %v", volumeID, err)
	} else {
		for _, chapter := range chapters {
			// 각 챕터의 진행도를 마지막 페이지(100%)로 설정
			chapterID := chapter.ID
			progress := &model.ReadingProgress{
				UserID:          userID,
				SeriesID:        volume.SeriesID,
				VolumeID:        &volumeID,
				ChapterID:       &chapterID,
				CurrentPage:     chapter.PageCount,
				TotalPages:      chapter.PageCount,
				ProgressPercent: 100.0,
			}
			if upErr := h.progressRepo.Upsert(tx, progress); upErr != nil {
				log.Printf("Failed to update progress for chapter %s: %v", chapter.ID, upErr)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("failed to update progress for chapter %s", chapter.ID),
				})
			}
		}
	}

	// 완료 표시
	completion, err := h.completionRepo.MarkComplete(tx, userID, volumeID)
	if err != nil {
		log.Printf("Failed to mark volume %s as complete: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark volume as complete",
		})
	}

	// 트랜잭션 커밋
	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message":    "volume marked as complete",
		"completion": completion,
	})
}

// GetVolumeCompletion 볼륨 완료 상태 조회
// GET /api/v1/volumes/:volumeId/completion
func (h *ProgressHandler) GetVolumeCompletion(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	volumeID := c.Params("volumeId")

	isCompleted, err := h.completionRepo.IsCompleted(nil, userID, volumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to check completion status",
		})
	}

	var completion *model.VolumeCompletion
	if isCompleted {
		var err error
		completion, err = h.completionRepo.FindByUserAndVolume(nil, userID, volumeID)
		if err != nil {
			log.Printf("Failed to get completion for user %s and volume %s: %v", userID, volumeID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to get completion detail",
			})
		}
	}

	return c.JSON(fiber.Map{
		"is_completed": isCompleted,
		"completion":   completion,
	})
}

// DeleteVolumeCompletion 볼륨 완료 상태 삭제 및 읽기 진행도 초기화
// DELETE /api/v1/volumes/:volumeId/completion
func (h *ProgressHandler) DeleteVolumeCompletion(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	volumeID := c.Params("volumeId")

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	// 1. 볼륨 완료 상태 삭제
	if delErr := h.completionRepo.Delete(tx, userID, volumeID); delErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete completion",
		})
	}

	// 2. 볼륨 내 모든 챕터의 읽기 진행도 삭제 (1페이지로 초기화)
	chapters, err := h.chapterRepo.FindByVolumeID(tx, volumeID)
	if err != nil {
		log.Printf("Failed to get chapters for volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get chapters",
		})
	}

	for _, chapter := range chapters {
		if err := h.progressRepo.DeleteByUserAndChapter(tx, userID, chapter.ID); err != nil {
			log.Printf("Failed to delete progress for chapter %s: %v", chapter.ID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to reset progress for chapter %s", chapter.ID),
			})
		}
	}

	// 트랜잭션 커밋
	if err := tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message": "볼륨 완료 상태 및 진행도가 삭제되었습니다",
	})
}

// GetSeriesCompletions 시리즈 내 완료된 볼륨 목록 조회
// GET /api/v1/series/:seriesId/completions
func (h *ProgressHandler) GetSeriesCompletions(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	completions, err := h.completionRepo.FindByUserAndSeries(nil, userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch completions",
		})
	}

	if completions == nil {
		completions = []model.VolumeCompletion{}
	}

	// 완료된 볼륨 수 / 전체 볼륨 수
	totalVolumes, _ := h.volumeRepo.CountBySeriesID(nil, seriesID)
	completedCount := len(completions)

	var completionRate float64
	if totalVolumes > 0 {
		completionRate = float64(completedCount) / float64(totalVolumes) * 100
	} else {
		completionRate = 0.0
	}

	return c.JSON(fiber.Map{
		"completions":     completions,
		"completed_count": completedCount,
		"total_volumes":   totalVolumes,
		"completion_rate": completionRate,
	})
}

// MarkSeriesComplete 시리즈 전체 완독 처리
// POST /api/v1/series/:seriesId/complete
func (h *ProgressHandler) MarkSeriesComplete(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	// 시리즈 존재 확인
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 시리즈 내 모든 볼륨 조회
	volumes, err := h.volumeRepo.FindBySeriesID(nil, seriesID)
	if err != nil {
		log.Printf("Failed to get volumes for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get volumes",
		})
	}

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	completedVolumes := 0
	completedChapters := 0

	// 각 볼륨에 대해 완독 처리
	for _, volume := range volumes {
		// 볼륨 내 모든 챕터 조회
		chapters, chErr := h.chapterRepo.FindByVolumeID(tx, volume.ID)
		if chErr != nil {
			log.Printf("Failed to get chapters for volume %s: %v", volume.ID, chErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to get chapters for volume %s", volume.ID),
			})
		}

		// 각 챕터의 진행도를 100%로 설정
		for _, chapter := range chapters {
			chapterID := chapter.ID
			volumeID := volume.ID
			progress := &model.ReadingProgress{
				UserID:          userID,
				SeriesID:        seriesID,
				VolumeID:        &volumeID,
				ChapterID:       &chapterID,
				CurrentPage:     chapter.PageCount,
				TotalPages:      chapter.PageCount,
				ProgressPercent: 100.0,
			}
			if upErr := h.progressRepo.Upsert(tx, progress); upErr != nil {
				log.Printf("Failed to update progress for chapter %s: %v", chapter.ID, upErr)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": fmt.Sprintf("failed to update progress for chapter %s", chapter.ID),
				})
			}
			completedChapters++
		}

		// 볼륨 완료 상태 표시
		if _, compErr := h.completionRepo.MarkComplete(tx, userID, volume.ID); compErr != nil {
			log.Printf("Failed to mark volume %s as complete: %v", volume.ID, compErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to mark volume %s as complete", volume.ID),
			})
		}
		completedVolumes++
	}

	// 트랜잭션 커밋
	if err = tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message":            "series marked as complete",
		"completed_volumes":  completedVolumes,
		"completed_chapters": completedChapters,
	})
}

// ResetSeriesProgress 시리즈 전체 독서 기록 초기화
// DELETE /api/v1/series/:seriesId/progress
func (h *ProgressHandler) ResetSeriesProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	// 시리즈 존재 확인
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 시리즈 내 모든 볼륨 조회
	volumes, err := h.volumeRepo.FindBySeriesID(nil, seriesID)
	if err != nil {
		log.Printf("Failed to get volumes for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to get volumes",
		})
	}

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }() // 함수 종료 시 무조건 롤백 시도 (이미 커밋되었으면 무시됨)

	deletedCompletions := 0
	deletedProgress := 0

	// 각 볼륨에 대해 초기화 처리
	for _, volume := range volumes {
		// 볼륨 완료 상태 삭제
		if delErr := h.completionRepo.Delete(tx, userID, volume.ID); delErr != nil {
			log.Printf("Failed to delete completion for volume %s: %v", volume.ID, delErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":               fmt.Sprintf("failed to reset completion for volume %s", volume.ID),
				"deleted_completions": deletedCompletions,
				"deleted_progress":    deletedProgress,
			})
		}
		deletedCompletions++

		// 볼륨 내 모든 챕터의 진행도 삭제
		chapters, chErr := h.chapterRepo.FindByVolumeID(tx, volume.ID)
		if chErr != nil {
			log.Printf("Failed to get chapters for volume %s: %v", volume.ID, chErr)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error":               fmt.Sprintf("failed to get chapters for volume %s", volume.ID),
				"deleted_completions": deletedCompletions,
				"deleted_progress":    deletedProgress,
			})
		}

		for _, chapter := range chapters {
			if delErr := h.progressRepo.DeleteByUserAndChapter(tx, userID, chapter.ID); delErr != nil {
				log.Printf("Failed to delete progress for chapter %s: %v", chapter.ID, delErr)
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":               fmt.Sprintf("failed to reset progress for chapter %s", chapter.ID),
					"deleted_completions": deletedCompletions,
					"deleted_progress":    deletedProgress,
				})
			}
			deletedProgress++
		}
	}

	// 트랜잭션 커밋
	if err = tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message":             "series progress reset",
		"deleted_completions": deletedCompletions,
		"deleted_progress":    deletedProgress,
	})
}

// removeCompletionIfIncomplete 진행도가 완료가 아닐 경우 완독 상태를 해제
func (h *ProgressHandler) removeCompletionIfIncomplete(userID string, volumeID *string, currentPage, totalPages int) {
	if volumeID != nil && totalPages > 0 && currentPage < totalPages {
		if err := h.completionRepo.Delete(nil, userID, *volumeID); err != nil {
			log.Printf("Failed to delete completion for volume %s: %v", *volumeID, err)
		}
	}
}

// markCompleteIfLastPage 마지막 챕터의 마지막 페이지에 도달한 경우 볼륨 완독 처리
func (h *ProgressHandler) markCompleteIfLastPage(userID string, volumeID, chapterID *string, currentPage, totalPages int) {
	if volumeID == nil || chapterID == nil {
		return
	}

	// 챕터 정보 조회 (PageCount, ChapterNumber, VolumeID 확인용)
	chapter, err := h.chapterRepo.FindByID(nil, *chapterID)
	if err != nil || chapter == nil {
		return
	}

	// 서버에 저장된 PageCount를 우선 사용하고, 없는 경우 클라이언트 요청값(totalPages)으로 fallback
	lastPage := totalPages
	if chapter.PageCount > 0 {
		lastPage = chapter.PageCount
	}

	// 유효한 마지막 페이지 정보가 없으면 종료
	if lastPage <= 0 {
		return
	}

	// 마지막 페이지인지 확인
	if currentPage < lastPage {
		// 마지막 페이지가 아니면 무시
		return
	}

	// 요청된 VolumeID와 실제 챕터의 VolumeID 일치 여부 확인 (잘못된 요청 방지)
	// 클라이언트가 잘못된 VolumeID를 보냈을 경우엔 실제 챕터의 VolumeID를 기준으로 처리하거나 무시할 수 있음
	// 여기서는 안전하게 실제 챕터 정보의 VolumeID를 사용
	targetVolumeID := chapter.VolumeID
	if *volumeID != targetVolumeID {
		log.Printf("Warning: VolumeID mismatch in markCompleteIfLastPage. Request: %s, Actual: %s", *volumeID, targetVolumeID)
	}

	// 볼륨의 마지막 챕터인지 확인
	isLast, err := h.chapterRepo.IsLastChapter(nil, targetVolumeID, chapter.ChapterNumber)
	if err != nil || !isLast {
		return
	}

	// 이미 완료된 상태인지 확인 (중복 호출 방지)
	isCompleted, _ := h.completionRepo.IsCompleted(nil, userID, targetVolumeID)
	if isCompleted {
		return
	}

	// 완독 처리
	if _, err := h.completionRepo.MarkComplete(nil, userID, targetVolumeID); err != nil {
		log.Printf("Failed to auto-mark completion for volume %s: %v", targetVolumeID, err)
	} else {
		log.Printf("Auto-marked volume %s as complete for user %s", targetVolumeID, userID)
	}
}
