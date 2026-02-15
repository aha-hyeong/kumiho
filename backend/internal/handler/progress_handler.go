package handler

import (
	"fmt"
	"log"
	"time"

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
	chapterRepo           *repository.ChapterRepository
	completionRepo        *repository.VolumeCompletionRepository
	chapterCompletionRepo *repository.ChapterCompletionRepository
}

func NewProgressHandler(
	progressRepo *repository.ReadingProgressRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	completionRepo *repository.VolumeCompletionRepository,
	chapterCompletionRepo *repository.ChapterCompletionRepository,
) *ProgressHandler {
	return &ProgressHandler{
		progressRepo:          progressRepo,
		seriesRepo:            seriesRepo,
		authService:           authService,
		volumeRepo:            volumeRepo,
		chapterRepo:           chapterRepo,
		completionRepo:        completionRepo,
		chapterCompletionRepo: chapterCompletionRepo,
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

				// 완독된 챕터라면 마지막 페이지 정보를 가상으로 생성하여 반환
				return c.JSON(fiber.Map{
					"progress": &model.ReadingProgress{
						UserID:          userID,
						SeriesID:        seriesID,
						VolumeID:        &chapter.VolumeID,
						ChapterID:       &chapterID,
						CurrentPage:     chapter.PageCount,
						TotalPages:      chapter.PageCount,
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
		log.Printf("[UpdateProgress] Upsert failed: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress",
		})
	}

	// 완독 상태 해제 체크
	h.removeCompletionIfIncomplete(userID, req.VolumeID, req.CurrentPage, req.TotalPages)

	// 챕터 완독 처리 (마지막 페이지 도달 시)
	if req.ChapterID != nil && req.CurrentPage >= req.TotalPages && req.TotalPages > 0 {
		if err := h.chapterCompletionRepo.MarkComplete(nil, userID, *req.ChapterID); err != nil {
			log.Printf("Failed to mark chapter %s as complete: %v", *req.ChapterID, err)
		}
	}

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
		VolumeNumber       int     `json:"volume_number"`
		VolumeTitle        string  `json:"volume_title"`
		VolumeChapterCount int     `json:"volume_chapter_count"`
		ChapterNumber      int     `json:"chapter_number"`
		ChapterTitle       string  `json:"chapter_title"`
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

				// 볼륨 내 챕터 수 조회
				if count, err := h.chapterRepo.CountByVolumeID(nil, volume.ID); err == nil {
					result[i].VolumeChapterCount = count
				}

				// 볼륨 썸네일이 있으면 덮어쓰기 (권 표지가 시리즈 표지보다 구체적이므로)
				if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
					url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, volume.UpdatedAt.Unix())
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
			"chapter_id":     strOrEmpty(serverProgress.ChapterID),
			"volume_id":      strOrEmpty(serverProgress.VolumeID),
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

	// 볼륨 내 모든 챕터의 진행도를 100%로 업데이트 (벌크 처리)
	now := time.Now()
	
	// 1. 기존 진행도 업데이트 (이미 존재하는 레코드)
	_, err = tx.Exec(`
		UPDATE reading_progress 
		SET current_page = total_pages, 
			progress_percent = 100.0, 
			updated_at = ?
		WHERE user_id = ? AND chapter_id IN (SELECT id FROM chapters WHERE volume_id = ?)
	`, now, userID, volumeID)
	if err != nil {
		log.Printf("Failed to bulk update progress for volume %s: %v", volumeID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update progress records",
		})
	}

	// 2. 누락된 진행도 생성 (처음 읽는 챕터들)
	// SQLite에서 UUID 생성이 어려우므로 간단한 ID 생성 로직 사용하거나 
	// 기존 데이터를 유지하는 방향으로 함. 완독 표시가 우선이므로.
	_, err = tx.Exec(`
		INSERT INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, ?, id, page_count, page_count, 100.0, ?
		FROM chapters
		WHERE volume_id = ? AND id NOT IN (SELECT chapter_id FROM reading_progress WHERE user_id = ?)
	`, userID, volume.SeriesID, volumeID, now, volumeID, userID)
	if err != nil {
		log.Printf("Failed to bulk insert progress for volume %s: %v", volumeID, err)
		// 에러가 나더라도 계속 진행 (이미 있는 레코드는 업데이트됨)
	}

	// 3. 챕터 완독 기록 추가 (벌크)
	_, err = tx.Exec(`
		INSERT OR IGNORE INTO chapter_completions (id, user_id, chapter_id, completed_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, id, ?
		FROM chapters
		WHERE volume_id = ?
	`, userID, now, volumeID)
	if err != nil {
		log.Printf("Failed to bulk mark chapter completions for volume %s: %v", volumeID, err)
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
		// a) 읽기 진행도 삭제
		if err := h.progressRepo.DeleteByUserAndChapter(tx, userID, chapter.ID); err != nil {
			log.Printf("Failed to delete progress for chapter %s: %v", chapter.ID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to reset progress for chapter %s", chapter.ID),
			})
		}
		// b) 챕터 완독 기록 삭제 (추가: 볼륨 초기화 시 챕터 완독도 취소되어야 함)
		if err := h.chapterCompletionRepo.DeleteByChapter(tx, userID, chapter.ID); err != nil {
			log.Printf("Failed to delete completion for chapter %s: %v", chapter.ID, err)
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": fmt.Sprintf("failed to delete completion for chapter %s", chapter.ID),
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
		INSERT OR IGNORE INTO reading_progress (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, updated_at)
		SELECT Lower(Hex(RandomBlob(16))), ?, ?, volume_id, id, page_count, page_count, 100.0, ?
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
	if err := h.completionRepo.DeleteBySeriesID(tx, userID, seriesID); err != nil {
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
	if err := h.progressRepo.DeleteByUserAndSeries(tx, userID, seriesID); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to delete progress",
		})
	}

	if err := tx.Commit(); err != nil {
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
