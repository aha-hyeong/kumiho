package handler

import (
	"database/sql"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/sse"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
)

type ProgressHandler struct {
	progressRepo          *repository.ReadingProgressRepository
	viewerSessionRepo     *repository.ViewerSessionRepository
	seriesRepo            *repository.SeriesRepository
	authService           *service.AuthService
	volumeRepo            *repository.VolumeRepository
	chapterRepo           *repository.ChapterRepository
	completionRepo        *repository.VolumeCompletionRepository
	chapterCompletionRepo *repository.ChapterCompletionRepository
	sseHub                *sse.Hub
	seriesEnrichSvc       *service.SeriesEnrichService
}

const completionThresholdPercent = 100.0
const viewerSessionLeaseTTL = 90 * time.Second

func NewProgressHandler(
	progressRepo *repository.ReadingProgressRepository,
	viewerSessionRepo *repository.ViewerSessionRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	completionRepo *repository.VolumeCompletionRepository,
	chapterCompletionRepo *repository.ChapterCompletionRepository,
	sseHub *sse.Hub,
	seriesEnrichSvc *service.SeriesEnrichService,
) *ProgressHandler {
	return &ProgressHandler{
		progressRepo:          progressRepo,
		viewerSessionRepo:     viewerSessionRepo,
		seriesRepo:            seriesRepo,
		authService:           authService,
		volumeRepo:            volumeRepo,
		chapterRepo:           chapterRepo,
		completionRepo:        completionRepo,
		chapterCompletionRepo: chapterCompletionRepo,
		sseHub:                sseHub,
		seriesEnrichSvc:       seriesEnrichSvc,
	}
}

// UpdateProgressRequest 진행도 업데이트 요청
type UpdateProgressRequest struct {
	VolumeID        *string  `json:"volume_id"`
	ChapterID       *string  `json:"chapter_id"`
	CurrentPage     int      `json:"current_page"`
	AnchorPage      int      `json:"anchor_page"`
	OffsetRatio     float64  `json:"offset_ratio"`
	TotalPages      int      `json:"total_pages"`
	CurrentPosition *int     `json:"current_position"`
	TotalPositions  *int     `json:"total_positions"`
	CurrentTime     *float64 `json:"current_time,omitempty"`
	Duration        *float64 `json:"duration,omitempty"`
	ProgressPercent float64  `json:"progress_percent"`
	DeviceID        *string  `json:"device_id"`
	DeviceName      *string  `json:"device_name"`
	CurrentCFI      *string  `json:"current_cfi"`
}

// UpdateEpubProgressRequest EPUB 전용 진행도 업데이트 요청
type UpdateEpubProgressRequest struct {
	CurrentPage     int     `json:"current_page"`
	TotalPages      int     `json:"total_pages"`
	CurrentPosition int     `json:"current_position"`
	TotalPositions  int     `json:"total_positions"`
	ProgressPercent float64 `json:"progress_percent"`
	CurrentCFI      string  `json:"current_cfi"`
}

type StartViewingRequest struct {
	SeriesID  string `json:"series_id"`
	ChapterID string `json:"chapter_id"`
}

type ResumeCheckRequest struct {
	SeriesID    string `json:"series_id"`
	ChapterID   string `json:"chapter_id"`
	CurrentPage int    `json:"current_page"`
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

	// 시리즈 정보 추가 (progress 유무와 관계없이 필요)
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		log.Printf("Failed to fetch series %s: %v", seriesID, err)
	} else if series != nil {
		// 데이터 보정 (썸네일, 진행도)
		h.enrichSingleSeries(series, userID)
	}

	// 요약 정보 계산 (권/화 진행도)
	progressSummary := fiber.Map{
		"current_volume_number":  0,
		"total_volumes":          0,
		"current_chapter_number": 0,
		"total_chapters":         0,
		"total_pages":            0,
		"read_pages":             0,
	}

	if series != nil {
		totalUnits, totalErr := h.seriesRepo.GetTotalProgressUnits(nil, seriesID)
		if totalErr != nil {
			log.Printf("Failed to calculate total progress units for series %s: %v", seriesID, totalErr)
			progressSummary["total_pages"] = series.TotalPageCount
		} else {
			progressSummary["total_pages"] = totalUnits
		}

		readUnits, readErr := h.seriesRepo.GetReadProgressUnits(nil, userID, seriesID)
		if readErr != nil {
			log.Printf("Failed to calculate read progress units for series %s: %v", seriesID, readErr)
			progressSummary["read_pages"] = series.ReadPageCount
		} else {
			progressSummary["read_pages"] = readUnits
		}
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

	// 2. 현재 읽고 있는 권/화 번호 조회 (progress가 있는 경우만)
	if progress != nil {
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
	}

	// 오디오북 시리즈인 경우 시간 기반 진행도 추가
	if series != nil && series.LibraryType == "audiobook" {
		totalDuration, err := h.chapterRepo.GetTotalDurationBySeriesID(nil, seriesID)
		if err != nil {
			log.Printf("Failed to get total duration for series %s: %v", seriesID, err)
		} else {
			progressSummary["total_duration"] = totalDuration
		}

		listenedDuration, err := h.chapterRepo.GetListenedDurationBySeriesID(nil, userID, seriesID)
		if err != nil {
			log.Printf("Failed to get listened duration for series %s: %v", seriesID, err)
		} else {
			progressSummary["listened_duration"] = listenedDuration
		}
	}

	return c.JSON(fiber.Map{
		"progress": progress,
		"series":   series,
		"summary":  progressSummary,
	})
}

// enrichSingleSeries 단일 시리즈 데이터 보정 (썸네일 URL, 진행도 계산)
func (h *ProgressHandler) enrichSingleSeries(s *model.Series, userID string) {
	h.seriesEnrichSvc.EnrichSingle(s, userID)
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

// GetSeriesProgressList 시리즈 내 모든 챕터 읽기 진행도 조회
// GET /api/v1/series/:seriesId/progress-list
func (h *ProgressHandler) GetSeriesProgressList(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "access denied",
			})
		}
	}

	progressList, err := h.progressRepo.FindByUserAndSeriesAll(nil, userID, seriesID)
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

	progress, err := h.progressRepo.FindViewerProgressByUserAndChapter(nil, userID, chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progress == nil {
		// 진행도가 없을 때 완독 여부 확인 (개별 챕터 -> 볼륨 순)
		chapter, err := h.chapterRepo.FindByID(nil, chapterID)
		if err == nil && chapter != nil {
			// 1. 개별 챕터 완독 여부 확인
			isChapterCompleted, _ := h.chapterCompletionRepo.IsCompleted(nil, userID, chapterID)

			// 2. 볼륨 완독 여부 확인 (하위 호환)
			isVolumeCompleted, _ := h.completionRepo.IsCompleted(nil, userID, chapter.VolumeID)

			if isChapterCompleted || isVolumeCompleted {
				// 볼륨 정보를 가져와서 SeriesID 확인
				volume, _ := h.volumeRepo.FindByID(nil, chapter.VolumeID)
				seriesID := ""
				if volume != nil {
					seriesID = volume.SeriesID
				}

				// 완독된 챕터라면 마지막 페이지 및 포지션 정보를 가상으로 생성하여 반환
				return c.JSON(fiber.Map{
					"progress": &model.ReadingProgress{
						UserID:          userID,
						SeriesID:        seriesID,
						VolumeID:        &chapter.VolumeID,
						ChapterID:       &chapterID,
						CurrentPage:     chapter.PageCount,
						TotalPages:      chapter.PageCount,
						CurrentPosition: chapter.TotalPositions,
						TotalPositions:  chapter.TotalPositions,
						ProgressPercent: 100.0,
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

// GetEpubProgress EPUB 전용 진행도 조회
// GET /api/v1/chapters/:chapterId/epub-progress
func (h *ProgressHandler) GetEpubProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	chapterID := c.Params("chapterId")

	progress, err := h.progressRepo.FindViewerProgressByUserAndChapter(nil, userID, chapterID)
	if err != nil {
		log.Printf("Failed to fetch epub progress for user %s chapter %s: %v", userID, chapterID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch epub progress",
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
	if series, seriesErr := h.seriesRepo.FindByID(nil, seriesID, userID); seriesErr != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// VolumeID가 없거나, TXT 동적 페이지 수 동기화를 위해 ChapterID로 챕터 조회
	var chapter *model.Chapter
	if req.ChapterID != nil {
		chapter, _ = h.chapterRepo.FindByID(nil, *req.ChapterID)
		if chapter != nil {
			if req.VolumeID == nil {
				req.VolumeID = &chapter.VolumeID
			}

			// TXT 파일인 경우 클라이언트가 송신한 동적 TotalPages를 chapter_count에 동기화
			if strings.HasSuffix(strings.ToLower(chapter.Path), ".txt") {
				if req.TotalPages > 0 && chapter.PageCount != req.TotalPages {
					if err := h.chapterRepo.UpdatePageCount(nil, chapter.ID, req.TotalPages); err == nil {
						chapter.PageCount = req.TotalPages
					} else {
						log.Printf("[UpdateProgress] Failed to sync txt page count: %v", err)
					}
				}
			}
		}
	}

	// CFI/position 필드가 누락되면 기존 값을 보존한다.
	if req.ChapterID != nil {
		existing, _ := h.progressRepo.FindByUserAndChapter(nil, userID, *req.ChapterID)
		if existing != nil {
			if req.CurrentCFI == nil || *req.CurrentCFI == "" {
				req.CurrentCFI = existing.CurrentCFI
			}
			if req.CurrentPosition == nil && existing.CurrentPosition > 0 {
				v := existing.CurrentPosition
				req.CurrentPosition = &v
			}
			if req.TotalPositions == nil && existing.TotalPositions > 0 {
				v := existing.TotalPositions
				req.TotalPositions = &v
			}
			if req.AnchorPage <= 0 {
				req.AnchorPage = fallbackAnchorPage(existing)
				req.OffsetRatio = existing.OffsetRatio
			}
		}
	}

	if req.AnchorPage <= 0 {
		req.AnchorPage = req.CurrentPage
	}
	req.OffsetRatio = math.Max(0, math.Min(1, req.OffsetRatio))

	progressPercent := req.ProgressPercent
	if req.TotalPages > 0 {
		// 페이지 기반인 경우 프론트엔드 값 우선 (혹은 여기서 재계산 가능)
		progressPercent = math.Max(0, math.Min(100, req.ProgressPercent))
	} else if req.Duration != nil && *req.Duration > 0 && req.CurrentTime != nil {
		// 오디오북인 경우 시간 기반으로 재계산 (프론트엔드 오차 방지)
		progressPercent = (*req.CurrentTime / *req.Duration) * 100
		progressPercent = math.Max(0, math.Min(100, progressPercent))
	}

	progress := &model.ReadingProgress{
		UserID:          userID,
		SeriesID:        seriesID,
		VolumeID:        req.VolumeID,
		ChapterID:       req.ChapterID,
		CurrentPage:     req.CurrentPage,
		AnchorPage:      req.AnchorPage,
		OffsetRatio:     req.OffsetRatio,
		TotalPages:      req.TotalPages,
		CurrentPosition: intValue(req.CurrentPosition),
		TotalPositions:  intValue(req.TotalPositions),
		CurrentTime:     req.CurrentTime,
		Duration:        req.Duration,
		ProgressPercent: progressPercent,
		DeviceID:        req.DeviceID,
		DeviceName:      req.DeviceName,
		CurrentCFI:      req.CurrentCFI,
	}

	// 진행도 저장
	if err := h.progressRepo.Upsert(nil, progress); err != nil {
		log.Printf("[UpdateProgress] Upsert failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}
	h.touchViewerLease(userID, c, seriesID, stringValue(req.ChapterID))

	// 완독 상태 해제 체크
	h.removeCompletionIfIncomplete(userID, req.VolumeID, req.CurrentPage, req.TotalPages, req.CurrentTime, req.Duration)

	// 챕터 완독 처리
	isChapterComplete := false
	if req.ChapterID != nil {
		if req.TotalPages > 0 && req.CurrentPage >= req.TotalPages && req.ProgressPercent >= completionThresholdPercent {
			isChapterComplete = true
		} else if req.Duration != nil && *req.Duration > 0 && req.CurrentTime != nil {
			// 오디오북인 경우 시간 기반 판단 (98% 이상)
			threshold := *req.Duration * 0.98
			if *req.CurrentTime >= threshold {
				isChapterComplete = true
			}
		}
	}

	if isChapterComplete {
		if err := h.chapterCompletionRepo.MarkComplete(nil, userID, *req.ChapterID); err != nil {
			log.Printf("Failed to mark chapter %s as complete: %v", *req.ChapterID, err)
		}
	}

	// 자동 완독 처리
	h.markCompleteIfLastPage(userID, req.VolumeID, req.ChapterID, req.CurrentPage, req.TotalPages, req.CurrentTime, req.Duration)

	return c.JSON(fiber.Map{
		"message":  "progress updated",
		"progress": progress,
	})
}

// UpdateEpubProgress EPUB 전용 진행도 업데이트
// PATCH /api/v1/chapters/:chapterId/epub-progress
func (h *ProgressHandler) UpdateEpubProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	chapterID := c.Params("chapterId")

	var req UpdateEpubProgressRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	if strings.TrimSpace(req.CurrentCFI) == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "current_cfi is required for epub progress",
		})
	}

	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume not found",
		})
	}

	totalPositions := req.TotalPositions
	currentPosition := req.CurrentPosition
	if currentPosition < 0 {
		currentPosition = 0
	}
	if totalPositions > 0 && currentPosition > totalPositions {
		currentPosition = totalPositions
	}

	totalPages := req.TotalPages
	if totalPages <= 0 {
		if totalPositions > 0 {
			totalPages = totalPositions
		} else if chapter.PageCount > 0 {
			totalPages = chapter.PageCount
		} else {
			totalPages = 1
		}
	}

	currentPage := req.CurrentPage
	if currentPage <= 0 {
		if totalPositions > 0 {
			currentPage = currentPosition + 1
		} else {
			currentPage = 1
		}
	}
	if currentPage > totalPages {
		currentPage = totalPages
	}

	progressPercent := req.ProgressPercent
	if math.IsNaN(progressPercent) || math.IsInf(progressPercent, 0) || progressPercent < 0 || progressPercent > 100 {
		progressPercent = (float64(currentPage) / float64(totalPages)) * 100
	}
	progressPercent = math.Max(0, math.Min(100, progressPercent))

	currentCFI := strings.TrimSpace(req.CurrentCFI)
	volumeID := chapter.VolumeID
	progress := &model.ReadingProgress{
		UserID:          userID,
		SeriesID:        volume.SeriesID,
		VolumeID:        &volumeID,
		ChapterID:       &chapterID,
		CurrentPage:     currentPage,
		AnchorPage:      currentPage,
		TotalPages:      totalPages,
		CurrentPosition: currentPosition,
		TotalPositions:  totalPositions,
		ProgressPercent: progressPercent,
		CurrentCFI:      &currentCFI,
	}

	if err := h.progressRepo.Upsert(nil, progress); err != nil {
		log.Printf("[UpdateEpubProgress] Upsert failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update epub progress",
		})
	}
	h.touchViewerLease(userID, c, volume.SeriesID, chapterID)

	h.removeCompletionIfIncomplete(userID, &volumeID, currentPage, totalPages, nil, nil)

	if currentPage >= totalPages && progressPercent >= completionThresholdPercent {
		if err := h.chapterCompletionRepo.MarkComplete(nil, userID, chapterID); err != nil {
			log.Printf("Failed to mark chapter %s as complete: %v", chapterID, err)
		}
	}

	h.markCompleteIfLastPage(userID, &volumeID, &chapterID, currentPage, totalPages, nil, nil)

	return c.JSON(fiber.Map{
		"message":  "epub progress updated",
		"progress": progress,
	})
}

// UpdateProgressWSReplacement 기존 WebSocket의 UPDATE_PROGRESS 이벤트를 대체하는 엔드포인트
// POST /api/v1/reading-progress/update
func (h *ProgressHandler) UpdateProgressWSReplacement(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	deviceID, _ := c.Locals("deviceID").(string)
	deviceName, _ := c.Locals("deviceName").(string)

	var req struct {
		SeriesID    string `json:"series_id"`
		ChapterID   string `json:"chapter_id"`
		CurrentPage int    `json:"current_page"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// Payload 유효성 검증
	if req.SeriesID == "" || req.ChapterID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "series_id or chapter_id is empty",
		})
	}
	if req.CurrentPage < 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "current_page is negative",
		})
	}

	// 챕터 정보를 조회하여 TotalPages, VolumeID를 채움
	totalPages := 0
	var volumeID *string
	progressPercent := 0.0
	if req.ChapterID != "" {
		chapter, err := h.chapterRepo.FindByID(nil, req.ChapterID)
		if err != nil {
			log.Printf("[ProgressHandler] failed to fetch chapter for progress (chapterID=%s): %v", req.ChapterID, err)
		} else if chapter != nil {
			if chapter.PageCount > 0 {
				totalPages = chapter.PageCount
			}
			volumeID = &chapter.VolumeID
		}
	}

	var existingProgress *model.ReadingProgress
	if req.ChapterID != "" {
		existingProgress, _ = h.progressRepo.FindByUserAndChapter(nil, userID, req.ChapterID)
	}

	if totalPages > 0 {
		progressPercent = (float64(req.CurrentPage) / float64(totalPages)) * 100
		progressPercent = math.Max(0, math.Min(100, progressPercent))
	} else if existingProgress != nil {
		progressPercent = existingProgress.ProgressPercent
	}

	currentPosition := 0
	totalPositions := 0
	var currentCFI *string
	if existingProgress != nil {
		currentPosition = existingProgress.CurrentPosition
		totalPositions = existingProgress.TotalPositions
		currentCFI = existingProgress.CurrentCFI
	}

	progress := &model.ReadingProgress{
		UserID:          userID,
		SeriesID:        req.SeriesID,
		VolumeID:        volumeID,
		ChapterID:       &req.ChapterID,
		CurrentPage:     req.CurrentPage,
		AnchorPage:      req.CurrentPage,
		TotalPages:      totalPages,
		CurrentPosition: currentPosition,
		TotalPositions:  totalPositions,
		ProgressPercent: progressPercent,
		DeviceID:        &deviceID,
		DeviceName:      &deviceName,
		CurrentCFI:      currentCFI,
	}

	// DB 업데이트
	if err := h.progressRepo.Upsert(nil, progress); err != nil {
		log.Printf("[ProgressHandler] Failed to upsert progress: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}
	h.touchViewerLease(userID, c, req.SeriesID, req.ChapterID)

	// 완독 상태 해제 체크
	h.removeCompletionIfIncomplete(userID, volumeID, req.CurrentPage, totalPages, nil, nil)

	// 챕터 완독 처리 (마지막 페이지 도달 시)
	if req.CurrentPage >= totalPages && totalPages > 0 {
		if err := h.chapterCompletionRepo.MarkComplete(nil, userID, req.ChapterID); err != nil {
			log.Printf("Failed to mark chapter %s as complete: %v", req.ChapterID, err)
		}
	}

	// 자동 완독 처리 (마지막 챕터의 마지막 페이지 도달 시)
	h.markCompleteIfLastPage(userID, volumeID, &req.ChapterID, req.CurrentPage, totalPages, nil, nil)

	return c.JSON(fiber.Map{
		"message": "progress updated via POST",
	})
}

// StartViewing 뷰어 진입 시 다른 세션의 뷰어를 강제 종료
// POST /api/v1/viewer/start
func (h *ProgressHandler) StartViewing(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	sessionID, _ := c.Locals("sessionID").(string)

	if sessionID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "session ID is required",
		})
	}

	req := StartViewingRequest{}
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid request body",
			})
		}
	}
	req.SeriesID = strings.TrimSpace(req.SeriesID)
	req.ChapterID = strings.TrimSpace(req.ChapterID)
	if err := h.validateViewerLeaseTarget(userID, req.SeriesID, req.ChapterID); err != nil {
		var fiberErr *fiber.Error
		if errors.As(err, &fiberErr) {
			return c.Status(fiberErr.Code).JSON(fiber.Map{
				"error": fiberErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to validate viewer target",
		})
	}

	currentLease, err := h.viewerSessionRepo.GetByUserID(nil, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query viewer session",
		})
	}

	tookOver := currentLease != nil &&
		currentLease.SessionID != sessionID &&
		!h.viewerSessionRepo.IsExpired(currentLease, viewerSessionLeaseTTL, time.Now())

	if err := h.viewerSessionRepo.Upsert(nil, userID, sessionID, req.SeriesID, req.ChapterID); err != nil {
		if isViewerLeaseForeignKeyError(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid series_id or chapter_id",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to acquire viewer session",
		})
	}

	if tookOver {
		h.sseHub.ForceLogoutOtherSessions(userID, sessionID)
		log.Printf("[StartViewing] takeover force logout: user=%s, new_session=%s, prev_session=%s", userID, sessionID, currentLease.SessionID)
	}

	return c.JSON(fiber.Map{
		"message":   "viewer started",
		"owner":     true,
		"took_over": tookOver,
	})
}

// ResumeCheck 화면 복귀 시 뷰어 소유권 재검증
// POST /api/v1/viewer/resume-check
func (h *ProgressHandler) ResumeCheck(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	sessionID, _ := c.Locals("sessionID").(string)
	if sessionID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "session ID is required",
		})
	}

	req := ResumeCheckRequest{}
	if len(c.Body()) > 0 {
		if err := c.BodyParser(&req); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid request body",
			})
		}
	}
	req.SeriesID = strings.TrimSpace(req.SeriesID)
	req.ChapterID = strings.TrimSpace(req.ChapterID)
	if err := h.validateViewerLeaseTarget(userID, req.SeriesID, req.ChapterID); err != nil {
		var fiberErr *fiber.Error
		if errors.As(err, &fiberErr) {
			return c.Status(fiberErr.Code).JSON(fiber.Map{
				"error": fiberErr.Message,
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to validate viewer target",
		})
	}

	currentLease, err := h.viewerSessionRepo.GetByUserID(nil, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query viewer session",
		})
	}

	if currentLease == nil || h.viewerSessionRepo.IsExpired(currentLease, viewerSessionLeaseTTL, time.Now()) {
		if err := h.viewerSessionRepo.Upsert(nil, userID, sessionID, req.SeriesID, req.ChapterID); err != nil {
			if isViewerLeaseForeignKeyError(err) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "invalid series_id or chapter_id",
				})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to renew viewer session",
			})
		}
		return c.JSON(fiber.Map{
			"owner": true,
		})
	}

	if currentLease.SessionID != sessionID {
		return c.Status(fiber.StatusConflict).JSON(fiber.Map{
			"code":  "VIEWER_TAKEN_OVER",
			"owner": false,
		})
	}

	if err := h.viewerSessionRepo.Upsert(nil, userID, sessionID, req.SeriesID, req.ChapterID); err != nil {
		if isViewerLeaseForeignKeyError(err) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid series_id or chapter_id",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to refresh viewer session",
		})
	}

	return c.JSON(fiber.Map{
		"owner": true,
	})
}

func (h *ProgressHandler) touchViewerLease(userID string, c *fiber.Ctx, seriesID, chapterID string) {
	sessionID, _ := c.Locals("sessionID").(string)
	if userID == "" || sessionID == "" {
		return
	}
	_, err := h.viewerSessionRepo.TouchIfOwner(nil, userID, sessionID, strings.TrimSpace(seriesID), strings.TrimSpace(chapterID))
	if err != nil {
		log.Printf("[ViewerLease] touch failed: user=%s, session=%s, err=%v", userID, sessionID, err)
	}
}

func stringValue(v *string) string {
	if v == nil {
		return ""
	}
	return *v
}

func intValue(v *int) int {
	if v == nil {
		return 0
	}
	return *v
}

func (h *ProgressHandler) validateViewerLeaseTarget(userID, seriesID, chapterID string) error {
	if seriesID == "" && chapterID == "" {
		return nil
	}

	if seriesID != "" {
		validSeries, err := h.isValidViewerSeries(userID, seriesID)
		if err != nil {
			return err
		}
		if !validSeries {
			return fiber.NewError(fiber.StatusBadRequest, "invalid series_id")
		}
	}

	if chapterID != "" {
		chapterSeriesID, validChapter, err := h.findViewerChapterSeriesID(chapterID)
		if err != nil {
			return err
		}
		if !validChapter {
			return fiber.NewError(fiber.StatusBadRequest, "invalid chapter_id")
		}

		if seriesID != "" && chapterSeriesID != seriesID {
			return fiber.NewError(fiber.StatusBadRequest, "chapter_id does not belong to series_id")
		}

		validSeriesForChapter, err := h.isValidViewerSeries(userID, chapterSeriesID)
		if err != nil {
			return err
		}
		if !validSeriesForChapter {
			return fiber.NewError(fiber.StatusBadRequest, "invalid chapter_id")
		}
	}

	return nil
}

func (h *ProgressHandler) isValidViewerSeries(userID, seriesID string) (bool, error) {
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		return false, err
	}
	return series != nil, nil
}

func (h *ProgressHandler) findViewerChapterSeriesID(chapterID string) (string, bool, error) {
	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil {
		return "", false, err
	}
	if chapter == nil {
		return "", false, nil
	}
	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil {
		return "", false, err
	}
	if volume == nil {
		return "", false, nil
	}
	return volume.SeriesID, true, nil
}

func isViewerLeaseForeignKeyError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "foreign key constraint failed")
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

	progressList, err := h.progressRepo.FindRecentEnrichedByUser(nil, userID, limit)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch progress",
		})
	}

	if progressList == nil {
		progressList = []repository.RecentEnrichedProgress{}
	}

	// 시리즈 정보 추가
	type ProgressWithSeries struct {
		repository.RecentEnrichedProgress
		SeriesTitle        string  `json:"series_title"`
		ThumbnailURL       *string `json:"thumbnail_url"`
		VolumeNumber       int     `json:"volume_number"`
		VolumeUnit         string  `json:"volume_unit"`
		VolumeTitle        string  `json:"volume_title"`
		VolumeChapterCount int     `json:"volume_chapter_count"`
		ChapterNumber      int     `json:"chapter_number"`
		ChapterTitle       string  `json:"chapter_title"`
		HasAudio           bool    `json:"has_audio"`
		LibraryType        string  `json:"library_type"`
	}

	result := make([]ProgressWithSeries, len(progressList))
	for i, p := range progressList {
		result[i] = ProgressWithSeries{
			RecentEnrichedProgress: p,
		}

		// 시리즈 정보 (경로 정보는 이미 Repository에서 Join으로 가져옴)
		if series, _ := h.seriesRepo.FindByID(nil, p.SeriesID, userID); series != nil {
			// 데이터 보정 (썸네일, 진행도 등)
			h.enrichSingleSeries(series, userID)

			result[i].SeriesTitle = series.Title
			result[i].HasAudio = series.LibraryType == "audiobook"
			result[i].LibraryType = series.LibraryType

			// 챕터 정보 보급
			if p.ChapterID != nil {
				if c, _ := h.chapterRepo.FindByID(nil, *p.ChapterID); c != nil {
					result[i].ChapterNumber = c.ChapterNumber
					result[i].ChapterTitle = c.Title
				}
			}

			// 볼륨 ID 결정
			var targetVolumeID string
			if p.VolumeID != nil {
				targetVolumeID = *p.VolumeID
			}

			// 볼륨 정보 및 썸네일 설정
			if targetVolumeID != "" {
				if volume, _ := h.volumeRepo.FindByID(nil, targetVolumeID); volume != nil {
					result[i].VolumeID = &volume.ID
					result[i].VolumeNumber = volume.VolumeNumber
					result[i].VolumeUnit = volume.Unit
					result[i].VolumeTitle = volume.Title

					if count, err := h.chapterRepo.CountByVolumeID(nil, volume.ID); err == nil {
						result[i].VolumeChapterCount = count
					}

					if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
						url := util.BuildVolumeThumbnailURL(volume.ID, volume.ThumbnailPath, volume.UpdatedAt)
						result[i].ThumbnailURL = &url
					} else {
						pageID, err := h.volumeRepo.GetFirstPageID(nil, volume.ID)
						if err == nil && pageID != "" {
							url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
							result[i].ThumbnailURL = &url
						}
					}
				}
			}

			// 썸네일 fallback
			if result[i].ThumbnailURL == nil || *result[i].ThumbnailURL == "" {
				// 1. 이미 보정된 시리즈 썸네일이 있으면 사용 (EPUB 등 커버 이미지)
				if series.ThumbnailURL != nil && *series.ThumbnailURL != "" {
					result[i].ThumbnailURL = series.ThumbnailURL
				} else {
					// 2. 없으면 첫 번째 페이지 이미지 시도
					pageID, err := h.seriesRepo.GetFirstPageID(nil, series.ID)
					if err == nil && pageID != "" {
						url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
						result[i].ThumbnailURL = &url
					}
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
		SeriesID        string   `json:"series_id"`
		VolumeID        *string  `json:"volume_id"`
		ChapterID       *string  `json:"chapter_id"`
		CurrentPage     int      `json:"current_page"`
		TotalPages      int      `json:"total_pages"`
		CurrentTime     *float64 `json:"current_time"`
		Duration        *float64 `json:"duration"`
		ProgressPercent float64  `json:"progress_percent"`
		DeviceID        *string  `json:"device_id"`
		DeviceName      *string  `json:"device_name"`
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
			CurrentTime:     item.CurrentTime,
			Duration:        item.Duration,
			ProgressPercent: item.ProgressPercent,
			DeviceID:        item.DeviceID,
			DeviceName:      item.DeviceName,
		}

		if err := h.progressRepo.Upsert(nil, progress); err != nil {
			errors = append(errors, item.SeriesID+": "+err.Error())
		} else {
			synced++

			// 완독 상태 해제 체크
			h.removeCompletionIfIncomplete(userID, item.VolumeID, item.CurrentPage, item.TotalPages, item.CurrentTime, item.Duration)

			// 자동 완독 처리 (마지막 챕터의 마지막 페이지 도달 시)
			h.markCompleteIfLastPage(userID, item.VolumeID, item.ChapterID, item.CurrentPage, item.TotalPages, item.CurrentTime, item.Duration)
		}
	}

	return c.JSON(fiber.Map{
		"message": "sync completed",
		"synced":  synced,
		"errors":  errors,
	})
}

// strOrEmpty 문자열 포인터가 nil이면 빈 문자열 반환
func strOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// CompareProgress 서버와 로컬 진행도 비교 (밀리 스타일 싱크용)
// POST /api/v1/series/:seriesId/progress/compare
func (h *ProgressHandler) CompareProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	var localProgress struct {
		VolumeNumber  int     `json:"volume_number"`
		ChapterNumber int     `json:"chapter_number"`
		CurrentPage   int     `json:"current_page"`
		AnchorPage    int     `json:"anchor_page"`
		OffsetRatio   float64 `json:"offset_ratio"`
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
			"anchor_page":    fallbackAnchorPage(serverProgress),
			"offset_ratio":   serverProgress.OffsetRatio,
			"device_name":    serverProgress.DeviceName,
			"chapter_id":     strOrEmpty(serverProgress.ChapterID),
			"volume_id":      strOrEmpty(serverProgress.VolumeID),
			"updated_at":     serverProgress.UpdatedAt,
		},
	})
}

func fallbackAnchorPage(progress *model.ReadingProgress) int {
	if progress == nil {
		return 0
	}
	if progress.AnchorPage > 0 {
		return progress.AnchorPage
	}
	return progress.CurrentPage
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

	now := time.Now()

	// 1. 재귀적 CTE를 사용하여 모든 하위 볼륨 ID 목록 가져오기
	// 2. 해당되는 모든 챕터의 진행도를 100%로 업데이트 (이미 존재하는 레코드)
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		UPDATE reading_progress
		SET current_page = total_pages,
			current_time = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			duration = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			progress_percent = 100.0,
			updated_at = ?
		WHERE user_id = ? AND chapter_id IN (
			SELECT id FROM chapters WHERE volume_id IN (SELECT id FROM descendant_volumes)
		)
	`, volumeID, now, userID)
	if err != nil {
		log.Printf("Failed to bulk update progress for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress records",
		})
	}

	// 3. 누락된 진행도 생성 (처음 읽는 챕터들)
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		INSERT OR IGNORE INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_time, duration, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, c.volume_id, c.id, c.page_count, c.page_count, c.duration, c.duration, 100.0, ?
		FROM chapters c
		WHERE c.volume_id IN (SELECT id FROM descendant_volumes)
		  AND c.id NOT IN (SELECT chapter_id FROM reading_progress WHERE user_id = ?)
	`, volumeID, userID, volume.SeriesID, now, userID)
	if err != nil {
		log.Printf("Failed to bulk insert progress for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to insert progress records",
		})
	}

	// 4. 챕터 완독 기록 추가 (벌크)
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		INSERT OR IGNORE INTO chapter_completions (id, user_id, chapter_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM chapters
		WHERE volume_id IN (SELECT id FROM descendant_volumes)
	`, volumeID, userID, now)
	if err != nil {
		log.Printf("Failed to bulk mark chapter completions for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark chapters as complete",
		})
	}

	// 5. 볼륨 완독 기록 추가 (모든 하위 볼륨 포함)
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		INSERT OR REPLACE INTO volume_completions (id, user_id, volume_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM descendant_volumes
	`, volumeID, userID, now)
	if err != nil {
		log.Printf("Failed to bulk mark volume completions for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark volumes as complete",
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
		"message": "volume and descendants marked as complete",
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

	// 1. 재귀적 CTE를 사용하여 모든 하위 볼륨 ID 목록 가져오기
	// 2. 모든 대상 볼륨의 완독 상태 삭제
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		DELETE FROM volume_completions
		WHERE user_id = ? AND volume_id IN (SELECT id FROM descendant_volumes)
	`, volumeID, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete completions for volume and descendants",
		})
	}

	// 3. 모든 대상 볼륨 내 챕터들의 읽기 진행도 및 완독 기록 삭제
	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		DELETE FROM reading_progress
		WHERE user_id = ? AND chapter_id IN (
			SELECT id FROM chapters WHERE volume_id IN (SELECT id FROM descendant_volumes)
		)
	`, volumeID, userID)
	if err != nil {
		log.Printf("Failed to bulk delete progress for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to reset progress records",
		})
	}

	_, err = tx.Exec(`
		WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v
			JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		DELETE FROM chapter_completions
		WHERE user_id = ? AND chapter_id IN (
			SELECT id FROM chapters WHERE volume_id IN (SELECT id FROM descendant_volumes)
		)
	`, volumeID, userID)
	if err != nil {
		log.Printf("Failed to bulk delete chapter completions for descendants of volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to reset chapter completions",
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
		"message": "볼륨 및 하위 항목들의 완료 상태와 진행도가 삭제되었습니다",
	})
}

// MarkPreviousVolumesComplete 특정 볼륨 이전의 모든 회차 완독 처리
// POST /api/v1/series/:seriesId/volumes/:volumeId/complete-previous
func (h *ProgressHandler) MarkPreviousVolumesComplete(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")
	volumeID := c.Params("volumeId")

	// 시리즈 존재 확인
	series, seriesErr := h.seriesRepo.FindByID(nil, seriesID, "")
	if seriesErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 라이브러리 접근 권한 확인 (MASTER 제외)
	if middleware.GetUserRole(c) != model.RoleMaster {
		allowedLibraryIDs, allowedErr := h.authService.GetAllowedLibraryIDs(userID)
		if allowedErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		hasAccess := false
		for _, libraryID := range allowedLibraryIDs {
			if libraryID == series.LibraryID {
				hasAccess = true
				break
			}
		}

		if !hasAccess {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "series not found",
			})
		}
	}

	// 기준 볼륨 존재 확인
	baseVolume, err := h.volumeRepo.FindByID(nil, volumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query base volume",
		})
	}
	if baseVolume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "base volume not found",
		})
	}

	// 기준 볼륨이 해당 시리즈 소속인지 확인
	if baseVolume.SeriesID != seriesID {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume does not belong to this series",
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

	now := time.Now()

	// 1. 기준 볼륨보다 번호가 작은 모든 볼륨들의 ID 목록 가져오기 (같은 시리즈 내)
	// 2. 해당되는 모든 챕터의 진행도를 100%로 업데이트
	_, err = tx.Exec(`
		UPDATE reading_progress
		SET current_page = total_pages,
			current_time = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			duration = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			progress_percent = 100.0,
			updated_at = ?
		WHERE user_id = ? AND series_id = ? AND chapter_id IN (
			SELECT c.id FROM chapters c
			JOIN volumes v ON c.volume_id = v.id
			WHERE v.series_id = ? AND v.volume_number < ?
		)
	`, now, userID, seriesID, seriesID, baseVolume.VolumeNumber)
	if err != nil {
		log.Printf("Failed to bulk update progress for previous volumes of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress records",
		})
	}

	// 3. 누락된 진행도 생성
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_time, duration, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, c.volume_id, c.id, c.page_count, c.page_count, c.duration, c.duration, 100.0, ?
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ? AND v.volume_number < ?
		  AND c.id NOT IN (SELECT chapter_id FROM reading_progress WHERE user_id = ?)
	`, userID, seriesID, now, seriesID, baseVolume.VolumeNumber, userID)
	if err != nil {
		log.Printf("Failed to bulk insert progress for previous volumes of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to insert progress records",
		})
	}

	// 4. 챕터 완독 기록 추가
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO chapter_completions (id, user_id, chapter_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, c.id, ?
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ? AND v.volume_number < ?
	`, userID, now, seriesID, baseVolume.VolumeNumber)
	if err != nil {
		log.Printf("Failed to bulk mark chapter completions for previous volumes of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark chapters as complete",
		})
	}

	// 5. 볼륨 완독 기록 추가
	_, err = tx.Exec(`
		INSERT OR REPLACE INTO volume_completions (id, user_id, volume_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM volumes
		WHERE series_id = ? AND volume_number < ?
	`, userID, now, seriesID, baseVolume.VolumeNumber)
	if err != nil {
		log.Printf("Failed to bulk mark volume completions for previous volumes of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark volumes as complete",
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
		"message": "previous volumes marked as complete",
	})
}

// MarkPreviousChaptersComplete 특정 챕터 이전의 모든 회차 완독 처리
// POST /api/v1/series/:seriesId/chapters/:chapterId/complete-previous
func (h *ProgressHandler) MarkPreviousChaptersComplete(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")
	chapterID := c.Params("chapterId")

	// 시리즈 존재 확인
	series, seriesErr := h.seriesRepo.FindByID(nil, seriesID, "")
	if seriesErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 라이브러리 접근 권한 확인 (MASTER 제외)
	if middleware.GetUserRole(c) != model.RoleMaster {
		allowedLibraryIDs, allowedErr := h.authService.GetAllowedLibraryIDs(userID)
		if allowedErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		hasAccess := false
		for _, libraryID := range allowedLibraryIDs {
			if libraryID == series.LibraryID {
				hasAccess = true
				break
			}
		}

		if !hasAccess {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "series not found",
			})
		}
	}

	// 기준 챕터 존재 확인
	baseChapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "base chapter not found",
			})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query base chapter",
		})
	}

	// 기준 볼륨 확인 (순서 비교용)
	baseVolume, err := h.volumeRepo.FindByID(nil, baseChapter.VolumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to query base volume",
		})
	}
	if baseVolume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "base volume not found",
		})
	}

	// 기준 챕터(의 볼륨)가 해당 시리즈 소속인지 확인
	if baseVolume.SeriesID != seriesID {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter does not belong to this series",
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

	now := time.Now()

	// 1. 기준 챕터보다 이전인 모든 챕터들의 진행도를 100%로 업데이트
	// 이전 권의 모든 챕터 + 현재 권의 이전 챕터들
	_, err = tx.Exec(`
		UPDATE reading_progress
		SET current_page = total_pages,
			current_time = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			duration = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
			progress_percent = 100.0,
			updated_at = ?
		WHERE user_id = ? AND series_id = ? AND chapter_id IN (
			SELECT c.id FROM chapters c
			JOIN volumes v ON c.volume_id = v.id
			WHERE v.series_id = ? AND (
				v.volume_number < ? OR (v.volume_number = ? AND c.chapter_number < ?)
			)
		)
	`, now, userID, seriesID, seriesID, baseVolume.VolumeNumber, baseVolume.VolumeNumber, baseChapter.ChapterNumber)
	if err != nil {
		log.Printf("Failed to bulk update progress for previous chapters of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress records",
		})
	}

	// 2. 누락된 진행도 생성
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_time, duration, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, c.volume_id, c.id, c.page_count, c.page_count, c.duration, c.duration, 100.0, ?
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ? AND (
			v.volume_number < ? OR (v.volume_number = ? AND c.chapter_number < ?)
		)
		  AND c.id NOT IN (SELECT chapter_id FROM reading_progress WHERE user_id = ?)
	`, userID, seriesID, now, seriesID, baseVolume.VolumeNumber, baseVolume.VolumeNumber, baseChapter.ChapterNumber, userID)
	if err != nil {
		log.Printf("Failed to bulk insert progress for previous chapters of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to insert progress records",
		})
	}

	// 3. 챕터 완독 기록 추가
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO chapter_completions (id, user_id, chapter_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, c.id, ?
		FROM chapters c
		JOIN volumes v ON c.volume_id = v.id
		WHERE v.series_id = ? AND (
			v.volume_number < ? OR (v.volume_number = ? AND c.chapter_number < ?)
		)
	`, userID, now, seriesID, baseVolume.VolumeNumber, baseVolume.VolumeNumber, baseChapter.ChapterNumber)
	if err != nil {
		log.Printf("Failed to bulk mark chapter completions for previous chapters of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark chapters as complete",
		})
	}

	// 4. 볼륨 완독 기록 추가 (이전 권들은 확실히 완독, 현재 권은 다른 챕터 상태에 따라 다름)
	// 이전 권들 완독 처리
	_, err = tx.Exec(`
		INSERT OR REPLACE INTO volume_completions (id, user_id, volume_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM volumes
		WHERE series_id = ? AND volume_number < ?
	`, userID, now, seriesID, baseVolume.VolumeNumber)
	if err != nil {
		log.Printf("Failed to bulk mark volume completions for previous chapters of series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark volumes as complete",
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
		"message": "previous chapters marked as complete",
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

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("Failed to begin transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	now := time.Now()

	// 1. 기존 진행도 업데이트 (벌크)
	_, err = tx.Exec(`
		UPDATE reading_progress
		SET current_page = (SELECT page_count FROM chapters WHERE chapters.id = reading_progress.chapter_id),
		    total_pages = (SELECT page_count FROM chapters WHERE chapters.id = reading_progress.chapter_id),
		    current_time = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
		    duration = (SELECT duration FROM chapters WHERE chapters.id = reading_progress.chapter_id),
		    progress_percent = 100.0,
		    updated_at = ?
		WHERE user_id = ? AND series_id = ?
	`, now, userID, seriesID)
	if err != nil {
		log.Printf("Failed to bulk update progress for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series progress",
		})
	}

	// 2. 누락된 진행도 생성 (벌크)
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, current_time, duration, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, volume_id, id, page_count, page_count, duration, duration, 100.0, ?
		FROM chapters
		WHERE volume_id IN (SELECT id FROM volumes WHERE series_id = ?)
	`, userID, seriesID, now, seriesID)
	if err != nil {
		log.Printf("Failed to bulk insert progress for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create series progress records",
		})
	}

	// 3. 챕터 완독 기록 추가 (벌크)
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO chapter_completions (id, user_id, chapter_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM chapters
		WHERE volume_id IN (SELECT id FROM volumes WHERE series_id = ?)
	`, userID, now, seriesID)
	if err != nil {
		log.Printf("Failed to bulk mark chapter completions for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark chapters as complete",
		})
	}

	// 4. 볼륨 완독 기록 추가 (벌크)
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO volume_completions (id, user_id, volume_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM volumes
		WHERE series_id = ?
	`, userID, now, seriesID)
	if err != nil {
		log.Printf("Failed to bulk mark volume completions for series %s: %v", seriesID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark volumes as complete",
		})
	}

	// 트랜잭션 커밋
	if err = tx.Commit(); err != nil {
		log.Printf("Failed to commit transaction: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message": "series marked as complete",
	})
}

// ResetSeriesProgress 시리즈 진행도 초기화
// DELETE /api/v1/series/:seriesId/progress
func (h *ProgressHandler) ResetSeriesProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	seriesID := c.Params("seriesId")

	// 시리즈 존재 확인 (PR 피드백 #3)
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	// 1. 시리즈의 모든 볼륨 완독 기록 삭제 (Bulk Delete)
	if err = h.completionRepo.DeleteBySeriesID(tx, userID, seriesID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete volume completions",
		})
	}

	// 2. 시리즈 내 챕터 완독 기록 삭제
	_, err = tx.Exec(
		`DELETE FROM chapter_completions 
		 WHERE user_id = ? AND chapter_id IN (
			SELECT c.id FROM chapters c 
			JOIN volumes v ON c.volume_id = v.id 
			WHERE v.series_id = ?
		 )`,
		userID, seriesID,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete chapter completions",
		})
	}

	// 3. 진행도 삭제
	if err = h.progressRepo.DeleteByUserAndSeries(tx, userID, seriesID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete progress",
		})
	}

	if err = tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message": "series progress reset",
	})
}

// MarkChapterComplete 챕터 완독 처리
// POST /api/v1/chapters/:chapterId/complete
func (h *ProgressHandler) MarkChapterComplete(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	chapterID := c.Params("chapterId")

	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	// SQLite 데드락 방지를 위해 트랜잭션 시작 직후 쓰기 잠금 확보 (DUMMY UPDATE)
	// DEFERRED 트랜잭션이 SELECT 후 UPDATE할 때 발생하는 동시성 충돌 방지
	_, _ = tx.Exec(`UPDATE reading_progress SET id=id WHERE 1=0`)

	// 1. 진행도를 마지막 페이지로 업데이트
	// 시리즈 ID 조회를 위해 볼륨 정보 필요
	volume, _ := h.volumeRepo.FindByID(tx, chapter.VolumeID)
	seriesID := ""
	if volume != nil {
		seriesID = volume.SeriesID
	}

	progress := &model.ReadingProgress{
		UserID:          userID,
		SeriesID:        seriesID,
		VolumeID:        &chapter.VolumeID,
		ChapterID:       &chapterID,
		CurrentPage:     chapter.PageCount,
		TotalPages:      chapter.PageCount,
		CurrentTime:     chapter.Duration,
		Duration:        chapter.Duration,
		ProgressPercent: 100.0,
		UpdatedAt:       time.Now(),
	}

	if err := h.progressRepo.Upsert(tx, progress); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}

	// 2. 챕터 완독 기록 추가
	if err := h.chapterCompletionRepo.MarkComplete(tx, userID, chapterID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to mark chapter complete",
		})
	}

	// 3. 자동 완독 처리 (볼륨 전체)
	isVolumeFinished, _ := h.chapterRepo.IsAllChaptersRead(tx, userID, chapter.VolumeID)
	if isVolumeFinished {
		if _, err := h.completionRepo.MarkComplete(tx, userID, chapter.VolumeID); err != nil {
			log.Printf("Failed to mark volume %s complete: %v", chapter.VolumeID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	return c.JSON(fiber.Map{
		"message": "chapter marked as complete",
	})
}

// ResetChapterProgress 챕터 진행도 초기화
// DELETE /api/v1/chapters/:chapterId/progress
func (h *ProgressHandler) ResetChapterProgress(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	chapterID := c.Params("chapterId")

	maskedUserID := "unknown"
	if len(userID) > 4 {
		maskedUserID = userID[:4] + "****"
	}
	log.Printf("[ResetChapterProgress] Request: userID=%s, chapterID=%s", maskedUserID, chapterID)

	// 트랜잭션 시작
	tx, err := database.DB.Begin()
	if err != nil {
		log.Printf("[ResetChapterProgress] Failed to begin tx: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to start transaction",
		})
	}
	defer func() { _ = tx.Rollback() }()

	// 1. 챕터 완독 기록 삭제
	if errDeleteChapter := h.chapterCompletionRepo.DeleteByChapter(tx, userID, chapterID); errDeleteChapter != nil {
		log.Printf("[ResetChapterProgress] Failed to delete completion: %v", errDeleteChapter)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete chapter completion",
		})
	}
	log.Printf("[ResetChapterProgress] Deleted chapter completion")

	// 2. 진행도 기록 삭제
	if errDeleteProgress := h.progressRepo.DeleteByUserAndChapter(tx, userID, chapterID); errDeleteProgress != nil {
		log.Printf("[ResetChapterProgress] Failed to delete progress: %v", errDeleteProgress)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete progress",
		})
	}
	log.Printf("[ResetChapterProgress] Deleted progress")

	// 3. 볼륨 완독 상태 해제 확인
	// 챕터를 초기화했으므로 볼륨 완독도 해제되어야 함 (선택사항이나 논리적으로 적합)
	chapter, err := h.chapterRepo.FindByID(tx, chapterID)
	if err == nil && chapter != nil {
		if errDeleteVolume := h.completionRepo.Delete(tx, userID, chapter.VolumeID); errDeleteVolume != nil {
			log.Printf("[ResetChapterProgress] Failed to delete volume completion (ignoring): %v", errDeleteVolume)
		} else {
			log.Printf("[ResetChapterProgress] Deleted volume completion for volume %s", chapter.VolumeID)
		}
	} else {
		log.Printf("[ResetChapterProgress] Failed to find chapter %s: %v", chapterID, err)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[ResetChapterProgress] Failed to commit: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to commit transaction",
		})
	}

	log.Printf("[ResetChapterProgress] Success")
	return c.JSON(fiber.Map{
		"message": "chapter progress reset",
	})
}

// removeCompletionIfIncomplete 진행도가 완료가 아닐 경우 완독 상태를 해제
func (h *ProgressHandler) removeCompletionIfIncomplete(userID string, volumeID *string, currentPage, totalPages int, currentTime, duration *float64) {
	isComplete := false
	if totalPages > 0 {
		if currentPage >= totalPages {
			isComplete = true
		}
	} else if duration != nil && *duration > 0 && currentTime != nil {
		// 시간 기반 판단 (오디오북)
		if *currentTime >= *duration*0.95 {
			isComplete = true
		}
	}

	if volumeID != nil && !isComplete {
		if err := h.completionRepo.Delete(nil, userID, *volumeID); err != nil {
			log.Printf("Failed to delete completion for volume %s: %v", *volumeID, err)
		}
	}
}

// markCompleteIfLastPage 마지막 챕터의 마지막 페이지(또는 시간)에 도달한 경우 볼륨 완독 처리
func (h *ProgressHandler) markCompleteIfLastPage(userID string, volumeID, chapterID *string, currentPage, totalPages int, currentTime, duration *float64) {
	if volumeID == nil || chapterID == nil {
		return
	}

	// 챕터 정보 조회 (PageCount, ChapterNumber, VolumeID 확인용)
	chapter, err := h.chapterRepo.FindByID(nil, *chapterID)
	if err != nil || chapter == nil {
		return
	}

	// 클라이언트 요청값(totalPages)을 우선 사용하고, 없는 경우 서버에 저장된 PageCount로 fallback
	lastPage := totalPages
	if lastPage <= 0 && chapter.PageCount > 0 {
		lastPage = chapter.PageCount
	}

	hasDuration := duration != nil && *duration > 0 && currentTime != nil

	// 유효한 마지막 페이지 정보가 없고 시간 정보도 없으면 종료
	if lastPage <= 0 && !hasDuration {
		return
	}

	// 완료 여부 판단
	isComplete := false
	if lastPage > 0 {
		if currentPage >= lastPage {
			isComplete = true
		}
	} else if duration != nil && *duration > 0 && currentTime != nil {
		// 시간 기반 판단 (오디오북)
		threshold := *duration * 0.95
		if *currentTime >= threshold {
			isComplete = true
		}
	}

	if !isComplete {
		return
	}

	// 요청된 VolumeID와 실제 챕터의 VolumeID 일치 여부 확인 (잘못된 요청 방지)
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
