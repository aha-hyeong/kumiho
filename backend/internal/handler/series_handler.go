package handler

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

type SeriesHandler struct {
	seriesRepo     *repository.SeriesRepository
	volumeRepo     *repository.VolumeRepository
	chapterRepo    *repository.ChapterRepository
	pageRepo       *repository.PageRepository
	completionRepo *repository.VolumeCompletionRepository
	config         *config.Config
}

func NewSeriesHandler(
	seriesRepo *repository.SeriesRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
	completionRepo *repository.VolumeCompletionRepository,
	cfg *config.Config,
) *SeriesHandler {
	return &SeriesHandler{
		seriesRepo:     seriesRepo,
		volumeRepo:     volumeRepo,
		chapterRepo:    chapterRepo,
		pageRepo:       pageRepo,
		completionRepo: completionRepo,
		config:         cfg,
	}
}

// ListByLibrary 라이브러리별 시리즈 목록
// GET /api/v1/libraries/:libraryId/series
func (h *SeriesHandler) ListByLibrary(c *fiber.Ctx) error {
	libraryID := c.Params("libraryId")

	seriesList, err := h.seriesRepo.FindByLibraryID(libraryID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}

	if seriesList == nil {
		seriesList = []model.Series{}
	}

	// 썸네일 URL 설정
	for i := range seriesList {
		if seriesList[i].ThumbnailPath != nil && *seriesList[i].ThumbnailPath != "" {
			url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", seriesList[i].ID, seriesList[i].UpdatedAt.Unix())
			seriesList[i].ThumbnailURL = &url
		} else {
			pageID, err := h.seriesRepo.GetFirstPageID(seriesList[i].ID)
			if err == nil && pageID != "" {
				url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
				seriesList[i].ThumbnailURL = &url
			}
		}
	}

	return c.JSON(fiber.Map{
		"series": seriesList,
	})
}

// GetSeries 시리즈 상세
// GET /api/v1/series/:id
func (h *SeriesHandler) GetSeries(c *fiber.Ctx) error {
	id := c.Params("id")

	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 썸네일 URL 설정
	if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
		url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", series.ID, series.UpdatedAt.Unix())
		series.ThumbnailURL = &url
	} else {
		pageID, err := h.seriesRepo.GetFirstPageID(series.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			series.ThumbnailURL = &url
		}
	}

	// 페이지 진행도 계산
	userID := middleware.GetUserID(c)

	totalPages, _ := h.seriesRepo.GetTotalPages(series.ID)
	series.TotalPageCount = totalPages

	if userID != "" {
		readPages, _ := h.seriesRepo.GetReadPages(userID, series.ID)
		series.ReadPageCount = readPages
	}

	return c.JSON(series)
}

// UpdateSeries 시리즈 정보 수정
// PATCH /api/v1/series/:id
func (h *SeriesHandler) UpdateSeries(c *fiber.Ctx) error {
	id := c.Params("id")

	// 기존 시리즈 조회
	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 요청 바디 파싱
	type UpdateSeriesRequest struct {
		Title        *string `json:"title"`
		Description  *string `json:"description"`
		Status       *string `json:"status"`
		Authors      *string `json:"authors"`
		Tags         *string `json:"tags"`
		IsBookmarked *bool   `json:"is_bookmarked"`
		PublicationYear *string `json:"publication_year"`
	}

	var req UpdateSeriesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 변경 사항 적용
	if req.Title != nil {
		series.Title = *req.Title
	}
	if req.Description != nil {
		series.Description = *req.Description
	}
	if req.Status != nil {
		series.Status = *req.Status
	}
	if req.Authors != nil {
		series.Authors = *req.Authors
	}
	if req.Tags != nil {
		series.Tags = *req.Tags
	}
	if req.IsBookmarked != nil {
		series.IsBookmarked = *req.IsBookmarked
	}
	if req.PublicationYear != nil {
		series.PublicationYear = *req.PublicationYear
	}

	// DB 업데이트
	if err := h.seriesRepo.Update(series); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series",
		})
	}

	return c.JSON(series)
}

// UploadThumbnail 시리즈 썸네일 업로드
// POST /api/v1/series/:id/thumbnail
func (h *SeriesHandler) UploadThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")

	// 시리즈 확인
	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 파일 가져오기
	file, err := c.FormFile("thumbnail")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "thumbnail file is required",
		})
	}

	// 파일 헤더 읽기를 위해 파일 열기
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to open uploaded file",
		})
	}
	defer src.Close()

	// MIME 타입 감지 (첫 512바이트 읽기)
	buffer := make([]byte, 512)
	_, err = src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read file header",
		})
	}

	// 파일 포인터 초기화
	src.Seek(0, 0)

	contentType := http.DetectContentType(buffer)
	if !strings.HasPrefix(contentType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid file type: only images are allowed",
		})
	}

	// 확장자 결정 (MIME 타입 기반 또는 기존 확장자 사용하되 검증)
	ext := filepath.Ext(file.Filename)
	// MIME 타입이 image인데 확장자가 이상하면 MIME 타입에 맞춰 보정할 수도 있지만
	// 여기서는 단순히 허용된 확장자인지만 체크하거나, 안전하게 .jpg 등으로 통일할 수도 있음.
	// 일단 기존 로직을 보완하여 확장자가 없으면 MIME 타입에 따라 설정
	if ext == "" {
		switch contentType {
		case "image/png":
			ext = ".png"
		case "image/gif":
			ext = ".gif"
		case "image/webp":
			ext = ".webp"
		default:
			ext = ".jpg"
		}
	}

	thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "series")
	if err := os.MkdirAll(thumbnailsDir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create thumbnails directory",
		})
	}

	path := filepath.Join(thumbnailsDir, fmt.Sprintf("%s%s", id, ext))

	// 파일 저장
	if err := c.SaveFile(file, path); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save thumbnail",
		})
	}

	// DB 업데이트
	series.ThumbnailPath = &path
	if err := h.seriesRepo.Update(series); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series thumbnail path",
		})
	}
	
	// 썸네일 URL 업데이트 (응답용)
	url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", series.ID, time.Now().Unix())
	series.ThumbnailURL = &url

	return c.JSON(series)
}

// DownloadThumbnail 이미지 URL로 썸네일 다운로드
// POST /api/v1/series/:id/thumbnail/url
func (h *SeriesHandler) DownloadThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")

	// 시리즈 확인
	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 요청 바디 파싱
	var req struct {
		URL string `json:"url"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}
	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "url is required",
		})
	}

	// 이미지 다운로드
	// 단순 http.Get 대신 커스텀 요청을 사용하여 User-Agent 등 헤더 설정
	client := &http.Client{
		Timeout: 10 * time.Second,
	}
	
	imgReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create request",
		})
	}

	// 브라우저 흉내를 위한 헤더 설정 (나무위키 등 차단 우회)
	imgReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
	imgReq.Header.Set("Referer", req.URL) // 일부 사이트는 Referer 필요
	imgReq.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")

	resp, err := client.Do(imgReq)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to download image: %v", err),
		})
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to download image: status code %d", resp.StatusCode),
		})
	}

	// Content-Type 확인 및 확장자 결정
	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "url is not an image",
		})
	}

	ext := ".jpg" // 기본값
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "gif") {
		ext = ".gif"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}

	// 저장 디렉토리 생성
	thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "series")
	if err := os.MkdirAll(thumbnailsDir, 0755); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create thumbnails directory",
		})
	}

	path := filepath.Join(thumbnailsDir, fmt.Sprintf("%s%s", id, ext))

	// 파일 생성 및 저장
	outFile, err := os.Create(path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create thumbnail file",
		})
	}
	defer outFile.Close()

	// 최대 크기 제한 (10MB)
	limitReader := io.LimitReader(resp.Body, 10*1024*1024)

	if _, err := io.Copy(outFile, limitReader); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save thumbnail content: " + err.Error(),
		})
	}

	// DB 업데이트
	series.ThumbnailPath = &path
	if err := h.seriesRepo.Update(series); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series thumbnail path",
		})
	}

	// 썸네일 URL 업데이트 (응답용)
	url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", series.ID, time.Now().Unix())
	series.ThumbnailURL = &url

	return c.JSON(series)
}

// DeleteThumbnail 시리즈 썸네일 초기화 (삭제)
// DELETE /api/v1/series/:id/thumbnail
func (h *SeriesHandler) DeleteThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")
	fmt.Printf("[DEBUG] DeleteThumbnail called for series: %s\n", id)

	// 시리즈 확인
	series, err := h.seriesRepo.FindByID(id)
	if err != nil {
		fmt.Printf("[DEBUG] Failed to fetch series: %v\n", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}
	if series == nil {
		fmt.Printf("[DEBUG] Series not found\n")
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "series not found",
		})
	}

	// 기존 썸네일 파일 삭제
	if series.ThumbnailPath != nil && *series.ThumbnailPath != "" {
		fmt.Printf("[DEBUG] Removing thumbnail file: %s\n", *series.ThumbnailPath)
		if err := os.Remove(*series.ThumbnailPath); err != nil && !os.IsNotExist(err) {
			// 파일 삭제 실패해도 DB 업데이트는 진행 (로그만 남김)
			fmt.Printf("failed to delete thumbnail file: %v\n", err)
		}
	} else {
		fmt.Printf("[DEBUG] No custom thumbnail path to remove\n")
	}

	// DB 업데이트 (ThumbnailPath = nil, ThumbnailURL = nil)
	series.ThumbnailPath = nil
	series.ThumbnailURL = nil 

	if err := h.seriesRepo.Update(series); err != nil {
		fmt.Printf("[DEBUG] Failed to update series in DB: %v\n", err)
		log.Printf("[DEBUG] Failed to update series in DB: %v\n", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series",
		})
	}

	// 기본 썸네일 URL 설정 (응답용)
	pageID, err := h.seriesRepo.GetFirstPageID(series.ID)
	if err == nil && pageID != "" {
		url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
		series.ThumbnailURL = &url
		log.Printf("[DEBUG] Set fallback URL: %s\n", url)
	} else {
		log.Printf("[DEBUG] Failed to get first page ID or empty: %v\n", err)
	}

	return c.JSON(series)
}

// ListVolumes 시리즈별 볼륨 목록
// GET /api/v1/series/:seriesId/volumes
func (h *SeriesHandler) ListVolumes(c *fiber.Ctx) error {
	seriesID := c.Params("seriesId")
	
	// 사용자 ID 가져오기 (authMiddleware에서 "userID" 키로 저장함)
	userID := middleware.GetUserID(c)
	if userID == "" {
		// 인증 미들웨어를 통과했지만 userID가 없는 비정상 상황
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "unauthorized",
		})
	}

	volumes, err := h.volumeRepo.FindBySeriesID(seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch volumes",
		})
	}

	if volumes == nil {
		volumes = []model.Volume{}
	}

	// 완독 상태 조회 (시리즈 내 모든 완독된 볼륨을 한 번에 조회)
	completedVolumeIDs := make(map[string]bool)
	completions, err := h.completionRepo.FindByUserAndSeries(userID, seriesID)
	if err == nil {
		for _, c := range completions {
			completedVolumeIDs[c.VolumeID] = true
		}
	}

	// 응답 데이터 구성 (썸네일 URL + 완독 상태)
	type VolumeWithCompletion struct {
		model.Volume
		IsCompleted bool `json:"is_completed"`
	}

	result := make([]VolumeWithCompletion, len(volumes))
	for i := range volumes {
		// 썸네일 URL 설정
		if volumes[i].ThumbnailPath == nil {
			pageID, err := h.volumeRepo.GetFirstPageID(volumes[i].ID)
			if err == nil && pageID != "" {
				url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
				volumes[i].ThumbnailURL = &url
			}
		}

		result[i] = VolumeWithCompletion{
			Volume:      volumes[i],
			IsCompleted: completedVolumeIDs[volumes[i].ID],
		}
	}

	return c.JSON(fiber.Map{
		"volumes": result,
	})
}

// GetVolume 볼륨 상세
// GET /api/v1/volumes/:id
func (h *SeriesHandler) GetVolume(c *fiber.Ctx) error {
	id := c.Params("id")

	volume, err := h.volumeRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch volume",
		})
	}
	if volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "volume not found",
		})
	}

	// 썸네일 URL 설정
	if volume.ThumbnailPath == nil || *volume.ThumbnailPath == "" {
		pageID, err := h.volumeRepo.GetFirstPageID(volume.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			volume.ThumbnailURL = &url
		}
	} else {
		// 커스텀 썸네일이 있는 경우 (필요시 구현)
	}

	return c.JSON(volume)
}

// ListChapters 볼륨별 챕터 목록
// GET /api/v1/volumes/:volumeId/chapters
func (h *SeriesHandler) ListChapters(c *fiber.Ctx) error {
	volumeID := c.Params("volumeId")

	chapters, err := h.chapterRepo.FindByVolumeID(volumeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapters",
		})
	}

	if chapters == nil {
		chapters = []model.Chapter{}
	}

	// 썸네일 URL 설정
	for i := range chapters {
		// 챕터는 보통 별도 썸네일 파일이 없으므로 항상 첫 페이지를 썸네일로 사용
		pageID, err := h.chapterRepo.GetFirstPageID(chapters[i].ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			chapters[i].ThumbnailURL = &url
		}
	}

	return c.JSON(fiber.Map{
		"chapters": chapters,
	})
}

// GetChapter 챕터 상세
// GET /api/v1/chapters/:id
func (h *SeriesHandler) GetChapter(c *fiber.Ctx) error {
	id := c.Params("id")

	chapter, err := h.chapterRepo.FindByID(id)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch chapter",
		})
	}
	if chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "chapter not found",
		})
	}

	return c.JSON(chapter)
}

// ListPages 챕터별 페이지 목록
// GET /api/v1/chapters/:chapterId/pages
func (h *SeriesHandler) ListPages(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")

	pages, err := h.pageRepo.FindByChapterID(chapterID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch pages",
		})
	}

	if pages == nil {
		pages = []model.Page{}
	}

	return c.JSON(fiber.Map{
		"pages": pages,
	})
}
