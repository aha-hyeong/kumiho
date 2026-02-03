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

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type SeriesHandler struct {
	seriesRepo            *repository.SeriesRepository
	libraryRepo           *repository.LibraryRepository
	authService           *service.AuthService
	volumeRepo            *repository.VolumeRepository
	chapterRepo           *repository.ChapterRepository
	pageRepo              *repository.PageRepository
	completionRepo        *repository.VolumeCompletionRepository
	userSeriesSettingRepo repository.UserSeriesSettingRepository
	config                *config.Config
}

func NewSeriesHandler(
	seriesRepo *repository.SeriesRepository,
	libraryRepo *repository.LibraryRepository,
	authService *service.AuthService,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	pageRepo *repository.PageRepository,
	completionRepo *repository.VolumeCompletionRepository,
	userSeriesSettingRepo repository.UserSeriesSettingRepository,
	cfg *config.Config,
) *SeriesHandler {
	return &SeriesHandler{
		seriesRepo:            seriesRepo,
		libraryRepo:           libraryRepo,
		authService:           authService,
		volumeRepo:            volumeRepo,
		chapterRepo:           chapterRepo,
		pageRepo:              pageRepo,
		completionRepo:        completionRepo,
		userSeriesSettingRepo: userSeriesSettingRepo,
		config:                cfg,
	}
}

type UpdateSeriesRequest struct {
	Title           *string `json:"title"`
	Description     *string `json:"description"`
	Status          *string `json:"status"`
	Authors         *string `json:"authors"`
	Tags            *string `json:"tags"`
	IsBookmarked    *bool   `json:"is_bookmarked"`
	PublicationYear *string `json:"publication_year"`
}

type UpdateVolumeRequest struct {
	Title           *string `json:"title"`
	VolumeNumber    *int    `json:"volume_number"`
	Description     *string `json:"description"`
	Authors         *string `json:"authors"`
	PublicationYear *string `json:"publication_year"`
}

type VolumeResponse struct {
	model.Volume
	IsCompleted bool `json:"is_completed"`
}

// ListByLibrary 라이브러리별 시리즈 목록
// GET /api/v1/libraries/:libraryId/series
func (h *SeriesHandler) ListByLibrary(c *fiber.Ctx) error {
	libraryID := c.Params("libraryId")

	// 라이브러리 정보 조회
	library, err := h.libraryRepo.FindByID(nil, libraryID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch library",
		})
	}
	if library == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "library not found",
		})
	}

	// MASTER가 아니면 접근 권한 확인
	role := middleware.GetUserRole(c)
	if role != model.RoleMaster && library.Type != "SYSTEM" {
		userID := middleware.GetUserID(c)
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}

		allowed := false
		for _, aid := range allowedIDs {
			if aid == library.ID {
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

	var seriesList []model.Series
	userID := middleware.GetUserID(c)
	if userID == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "unauthorized",
		})
	}

	if library.Type == "SYSTEM" {
		// 시스템 라이브러리(좋아요)인 경우 북마크된 시리즈 조회
		seriesList, err = h.seriesRepo.FindBookmarked(nil, userID)
	} else {
		// 일반 라이브러리
		seriesList, err = h.seriesRepo.FindByLibraryID(nil, libraryID, userID)
	}

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch series",
		})
	}

	if seriesList == nil {
		seriesList = []model.Series{}
	}

	// 썸네일 URL 및 진행도 설정
	h.enrichSeriesList(seriesList, userID)

	return c.JSON(fiber.Map{
		"series": seriesList,
	})
}

// GetSeries 시리즈 상세
// GET /api/v1/series/:id
func (h *SeriesHandler) GetSeries(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := middleware.GetUserID(c)

	series, err := h.seriesRepo.FindByID(nil, id, userID)
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

	// 데이터 보정 (썸네일, 진행도)
	h.enrichSingleSeries(series, userID)

	return c.JSON(series)
}

// UpdateSeries 시리즈 정보 수정
// PATCH /api/v1/series/:id
func (h *SeriesHandler) UpdateSeries(c *fiber.Ctx) error {
	id := c.Params("id")
	userID := middleware.GetUserID(c)

	// 기존 시리즈 조회
	series, err := h.seriesRepo.FindByID(nil, id, userID)
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
	var req UpdateSeriesRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 단독 북마크 업데이트인 경우, updated_at을 변경하지 않고 북마크 상태만 변경
	if req.IsBookmarked != nil && req.Title == nil && req.Description == nil &&
		req.Status == nil && req.Authors == nil && req.Tags == nil && req.PublicationYear == nil {

		if err := h.seriesRepo.UpdateBookmark(nil, userID, series.ID, *req.IsBookmarked); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to update bookmark",
			})
		}

		series.IsBookmarked = *req.IsBookmarked
		return c.JSON(series)
	}

	// 변경 사항 적용
	if req.Title != nil {
		series.Title = *req.Title
	}
	if req.Description != nil {
		series.Description = *req.Description
	}
	if req.IsBookmarked != nil {
		series.IsBookmarked = *req.IsBookmarked
	}

	// 메타데이터 업데이트
	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{SeriesID: series.ID}
	}
	if req.Status != nil {
		series.Metadata.Status = *req.Status
	}
	if req.Authors != nil {
		series.Metadata.Authors = *req.Authors
	}
	if req.Tags != nil {
		series.Metadata.Tags = *req.Tags
	}
	if req.PublicationYear != nil {
		series.Metadata.PublicationYear = *req.PublicationYear
	}

	// DB 업데이트
	if err := h.seriesRepo.Update(nil, series); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series",
		})
	}

	return c.JSON(series)
}

// UpdateVolume 볼륨 정보 수정
// PATCH /api/v1/volumes/:id
func (h *SeriesHandler) UpdateVolume(c *fiber.Ctx) error {
	id := c.Params("id")

	// 기존 볼륨 조회
	volume, err := h.volumeRepo.FindByID(nil, id)
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

	// 요청 바디 파싱
	var req UpdateVolumeRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 권한 확인 (MASTER only)
	if middleware.GetUserRole(c) != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "access denied",
		})
	}

	// 변경 사항 적용
	if req.Title != nil {
		volume.Title = *req.Title
	}
	if req.VolumeNumber != nil {
		volume.VolumeNumber = *req.VolumeNumber
	}
	if req.Description != nil {
		volume.Description = *req.Description
	}
	if req.Authors != nil {
		volume.Authors = *req.Authors
	}
	if req.PublicationYear != nil {
		volume.PublicationYear = *req.PublicationYear
	}

	// DB 업데이트
	if err := h.volumeRepo.Update(nil, volume); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update volume",
		})
	}

	// 썸네일 URL 설정 (응답용)
	if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
		url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, time.Now().Unix())
		volume.ThumbnailURL = &url
	} else {
		pageID, err := h.volumeRepo.GetFirstPageID(nil, volume.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			volume.ThumbnailURL = &url
		}
	}

	return c.JSON(volume)
}

// UploadVolumeThumbnail 볼륨 썸네일 업로드
// POST /api/v1/volumes/:id/thumbnail
func (h *SeriesHandler) UploadVolumeThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")

	// 권한 확인 (MASTER only)
	if middleware.GetUserRole(c) != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "access denied",
		})
	}

	// 볼륨 확인
	volume, err := h.volumeRepo.FindByID(nil, id)
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

	// 파일 가져오기
	file, err := c.FormFile("thumbnail")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "thumbnail file is required",
		})
	}

	// 파일 크기 제한 (15MB)
	if file.Size > 15*1024*1024 {
		return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
			"error": "file size exceeds 15MB",
		})
	}

	// 파일 헤더 읽기를 위해 파일 열기
	src, err := file.Open()
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to open uploaded file",
		})
	}
	defer func() { _ = src.Close() }()

	// MIME 타입 감지
	buffer := make([]byte, 512)
	_, err = src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read file header",
		})
	}

	_, _ = src.Seek(0, 0)

	contentType := http.DetectContentType(buffer)
	if !strings.HasPrefix(contentType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid file type: only images are allowed",
		})
	}

	ext := filepath.Ext(file.Filename)
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

	thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "volumes")
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
	volume.ThumbnailPath = &path
	if err := h.volumeRepo.Update(nil, volume); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update volume thumbnail path",
		})
	}

	// 썸네일 URL 업데이트
	url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, time.Now().Unix())
	volume.ThumbnailURL = &url

	return c.JSON(volume)
}

// UploadVolumeThumbnailFromURL 볼륨 썸네일 URL 업로드
// POST /api/v1/volumes/:id/thumbnail/url
func (h *SeriesHandler) UploadVolumeThumbnailFromURL(c *fiber.Ctx) error {
	id := c.Params("id")

	// 권한 확인 (MASTER only)
	if middleware.GetUserRole(c) != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "access denied",
		})
	}
	
	volume, err := h.volumeRepo.FindByID(nil, id)
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

	var req struct {
		URL string `json:"url"`
	}
	if parseErr := c.BodyParser(&req); parseErr != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}
	if req.URL == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "url is required",
		})
	}

	client := &http.Client{Timeout: 10 * time.Second}
	imgReq, err := http.NewRequest("GET", req.URL, nil)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create request",
		})
	}

	imgReq.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
	imgReq.Header.Set("Referer", req.URL)
	imgReq.Header.Set("Accept", "image/*")

	resp, err := client.Do(imgReq)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to download image: %v", err),
		})
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": fmt.Sprintf("failed to download image: status code %d", resp.StatusCode),
		})
	}

	contentType := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "image/") {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "url is not an image",
		})
	}

	ext := ".jpg"
	if strings.Contains(contentType, "png") {
		ext = ".png"
	} else if strings.Contains(contentType, "gif") {
		ext = ".gif"
	} else if strings.Contains(contentType, "webp") {
		ext = ".webp"
	}

	thumbnailsDir := filepath.Join(h.config.DataDir, "thumbnails", "volumes")
	if mkErr := os.MkdirAll(thumbnailsDir, 0755); mkErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create thumbnails directory",
		})
	}

	path := filepath.Join(thumbnailsDir, fmt.Sprintf("%s%s", id, ext))

	outFile, err := os.Create(path)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to create thumbnail file",
		})
	}
	defer func() { _ = outFile.Close() }()

	limitReader := io.LimitReader(resp.Body, 15*1024*1024)
	if _, err := io.Copy(outFile, limitReader); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save thumbnail content",
		})
	}

	volume.ThumbnailPath = &path
	if err := h.volumeRepo.Update(nil, volume); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update volume thumbnail path",
		})
	}

	url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, time.Now().Unix())
	volume.ThumbnailURL = &url

	return c.JSON(volume)
}

// DeleteVolumeThumbnail 볼륨 썸네일 삭제
// DELETE /api/v1/volumes/:id/thumbnail
func (h *SeriesHandler) DeleteVolumeThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")

	// 권한 확인 (MASTER only)
	if middleware.GetUserRole(c) != model.RoleMaster {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"error": "access denied",
		})
	}

	volume, err := h.volumeRepo.FindByID(nil, id)
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

	if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
		if remErr := os.Remove(*volume.ThumbnailPath); remErr != nil && !os.IsNotExist(remErr) {
			log.Printf("failed to delete thumbnail file: %v", remErr)
		}
	}

	volume.ThumbnailPath = nil
	volume.ThumbnailURL = nil

	if upErr := h.volumeRepo.Update(nil, volume); upErr != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update volume",
		})
	}

	// 첫 페이지를 썸네일로 보정
	pageID, err := h.volumeRepo.GetFirstPageID(nil, volume.ID)
	if err == nil && pageID != "" {
		url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
		volume.ThumbnailURL = &url
	}

	return c.JSON(volume)
}

// UploadThumbnail 시리즈 썸네일 업로드
// POST /api/v1/series/:id/thumbnail
func (h *SeriesHandler) UploadThumbnail(c *fiber.Ctx) error {
	id := c.Params("id")

	// 시리즈 확인
	userID := middleware.GetUserID(c)
	series, err := h.seriesRepo.FindByID(nil, id, userID)
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
	defer func() { _ = src.Close() }()

	// MIME 타입 감지 (첫 512바이트 읽기)
	buffer := make([]byte, 512)
	_, err = src.Read(buffer)
	if err != nil && err != io.EOF {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to read file header",
		})
	}

	// 파일 포인터 초기화
	_, _ = src.Seek(0, 0)

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
	if err := h.seriesRepo.Update(nil, series); err != nil {
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
	userID := middleware.GetUserID(c)
	series, err := h.seriesRepo.FindByID(nil, id, userID)
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
	if parseErr := c.BodyParser(&req); parseErr != nil {
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
	defer func() { _ = resp.Body.Close() }()

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
	if mkErr := os.MkdirAll(thumbnailsDir, 0755); mkErr != nil {
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
	defer func() { _ = outFile.Close() }()

	// 최대 크기 제한 (10MB)
	limitReader := io.LimitReader(resp.Body, 10*1024*1024)

	if _, err := io.Copy(outFile, limitReader); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to save thumbnail content: " + err.Error(),
		})
	}

	// DB 업데이트
	series.ThumbnailPath = &path
	if err := h.seriesRepo.Update(nil, series); err != nil {
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
	userID := middleware.GetUserID(c)
	fmt.Printf("[DEBUG] DeleteThumbnail called for series: %s\n", id)

	// 시리즈 확인
	series, err := h.seriesRepo.FindByID(nil, id, userID)
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
		if remErr := os.Remove(*series.ThumbnailPath); remErr != nil && !os.IsNotExist(remErr) {
			// 파일 삭제 실패해도 DB 업데이트는 진행 (로그만 남김)
			fmt.Printf("failed to delete thumbnail file: %v\n", remErr)
		}
	} else {
		fmt.Printf("[DEBUG] No custom thumbnail path to remove\n")
	}

	// DB 업데이트 (ThumbnailPath = nil, ThumbnailURL = nil)
	series.ThumbnailPath = nil
	series.ThumbnailURL = nil

	if upErr := h.seriesRepo.Update(nil, series); upErr != nil {
		fmt.Printf("[DEBUG] Failed to update series in DB: %v\n", upErr)
		log.Printf("[DEBUG] Failed to update series in DB: %v\n", upErr)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update series",
		})
	}

	// 기본 썸네일 URL 설정 (응답용)
	pageID, err := h.seriesRepo.GetFirstPageID(nil, series.ID)
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

	volumes, err := h.volumeRepo.FindBySeriesID(nil, seriesID)
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
	completions, err := h.completionRepo.FindByUserAndSeries(nil, userID, seriesID)
	if err == nil {
		for _, c := range completions {
			completedVolumeIDs[c.VolumeID] = true
		}
	}

	// 응답 데이터 구성 (썸네일 URL + 완독 상태 + 진행도)
	result := make([]VolumeResponse, len(volumes))
	for i := range volumes {
		// 썸네일 URL 설정
		// 썸네일 URL 설정
		if volumes[i].ThumbnailPath != nil && *volumes[i].ThumbnailPath != "" {
			url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volumes[i].ID, time.Now().Unix())
			volumes[i].ThumbnailURL = &url
		} else {
			pageID, err := h.volumeRepo.GetFirstPageID(nil, volumes[i].ID)
			if err == nil && pageID != "" {
				url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
				volumes[i].ThumbnailURL = &url
			}
		}

		// 진행도 계산
		totalPages, err := h.volumeRepo.GetTotalPages(nil, volumes[i].ID)
		if err != nil {
			log.Printf("failed to get total pages for volume %s: %v", volumes[i].ID, err)
		} else {
			volumes[i].TotalPageCount = totalPages
		}

		readPages, err := h.volumeRepo.GetReadPages(nil, userID, volumes[i].ID)
		if err != nil {
			log.Printf("failed to get read pages for user %s, volume %s: %v", userID, volumes[i].ID, err)
		} else {
			volumes[i].ReadPageCount = readPages
		}

		isCompleted := completedVolumeIDs[volumes[i].ID]
		// 완독 상태지만 읽은 페이지가 0인 경우 (예: 직접 완독 처리했으나 진행도 업데이트 실패 등) 100%로 보정
		if isCompleted && readPages == 0 && totalPages > 0 {
			volumes[i].ReadPageCount = totalPages
		}

		result[i] = VolumeResponse{
			Volume:      volumes[i],
			IsCompleted: isCompleted,
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

	volume, err := h.volumeRepo.FindByID(nil, id)
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
	// 썸네일 URL 설정
	if volume.ThumbnailPath != nil && *volume.ThumbnailPath != "" {
		url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", volume.ID, time.Now().Unix())
		volume.ThumbnailURL = &url
	} else {
		pageID, pErr := h.volumeRepo.GetFirstPageID(nil, volume.ID)
		if pErr == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			volume.ThumbnailURL = &url
		}
	}

	// 페이지 진행도 계산 및 완독 상태 확인
	userID := middleware.GetUserID(c)

	totalPages, err := h.volumeRepo.GetTotalPages(nil, volume.ID)
	if err != nil {
		log.Printf("failed to get total pages for volume %s: %v", volume.ID, err)
	} else {
		volume.TotalPageCount = totalPages
	}

	readPages := 0
	if userID != "" {
		rp, rpErr := h.volumeRepo.GetReadPages(nil, userID, volume.ID)
		if rpErr != nil {
			log.Printf("failed to get read pages for user %s, volume %s: %v", userID, volume.ID, rpErr)
		} else {
			readPages = rp
			volume.ReadPageCount = readPages
		}
	}

	// 완독 상태 조회
	isCompleted := false
	if userID != "" {
		isCompleted, err = h.completionRepo.IsCompleted(nil, userID, volume.ID)
		if err != nil {
			log.Printf("failed to check completion for volume %s: %v", volume.ID, err)
		}
	}

	// 완독 상태지만 읽은 페이지가 0인 경우 100%로 보정
	if isCompleted && readPages == 0 && totalPages > 0 {
		volume.ReadPageCount = totalPages
	}

	return c.JSON(VolumeResponse{
		Volume:      *volume,
		IsCompleted: isCompleted,
	})
}

// ListChapters 볼륨별 챕터 목록
// GET /api/v1/volumes/:volumeId/chapters
func (h *SeriesHandler) ListChapters(c *fiber.Ctx) error {
	volumeID := c.Params("volumeId")

	chapters, err := h.chapterRepo.FindByVolumeID(nil, volumeID)
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
		pageID, err := h.chapterRepo.GetFirstPageID(nil, chapters[i].ID)
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

	chapter, err := h.chapterRepo.FindByID(nil, id)
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

	pages, err := h.pageRepo.FindByChapterID(nil, chapterID)
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

// GetViewerSettings 시리즈별 뷰어 설정 조회
// GET /api/v1/series/:id/viewer-settings
func (h *SeriesHandler) GetViewerSettings(c *fiber.Ctx) error {
	seriesID := c.Params("id")
	userID := middleware.GetUserID(c)

	settings, err := h.userSeriesSettingRepo.Get(nil, userID, seriesID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to fetch viewer settings",
		})
	}

	if settings == nil {
		return c.JSON(fiber.Map{})
	}

	return c.JSON(settings)
}

// BGMResponse BGM 정보 응답
type BGMResponse struct {
	Exists bool    `json:"exists"`
	URL    *string `json:"url,omitempty"`
}

// GetVolumeBGM 볼륨 BGM 존재 여부 확인
// GET /api/v1/volumes/:id/bgm
func (h *SeriesHandler) GetVolumeBGM(c *fiber.Ctx) error {
	id := c.Params("id")

	volume, err := h.volumeRepo.FindByID(nil, id)
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

	bgmPath, exists := h.findBGMFile(volume.Path)
	if !exists {
		return c.JSON(BGMResponse{Exists: false})
	}

	// 파일이 존재하면 URL 반환 (캐싱 방지를 위해 timestamp 추가)
	url := fmt.Sprintf("/api/v1/volumes/%s/bgm/stream", id)

	// 변화 감지를 위해 파일 수정 시간 확인
	info, err := os.Stat(bgmPath)
	if err == nil {
		url += fmt.Sprintf("?t=%d", info.ModTime().Unix())
	}

	return c.JSON(BGMResponse{
		Exists: true,
		URL:    &url,
	})
}

// ServeVolumeBGM 볼륨 BGM 스트리밍
// GET /api/v1/volumes/:id/bgm/stream
func (h *SeriesHandler) ServeVolumeBGM(c *fiber.Ctx) error {
	id := c.Params("id")

	volume, err := h.volumeRepo.FindByID(nil, id)
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

	bgmPath, exists := h.findBGMFile(volume.Path)
	if !exists {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "bgm not found",
		})
	}

	// 컨텐츠 타입 명시적 설정
	ext := strings.ToLower(filepath.Ext(bgmPath))
	switch ext {
	case ".mp3":
		c.Set("Content-Type", "audio/mpeg")
	case ".ogg":
		c.Set("Content-Type", "audio/ogg")
	case ".wav":
		c.Set("Content-Type", "audio/wav")
	case ".flac":
		c.Set("Content-Type", "audio/flac")
	case ".m4a":
		c.Set("Content-Type", "audio/mp4")
	}

	return c.SendFile(bgmPath)
}

// findBGMFile 볼륨 경로를 기반으로 BGM 파일 찾기
func (h *SeriesHandler) findBGMFile(volumePath string) (string, bool) {
	// 볼륨 패스가 파일(zip/cbz)인 경우 확장자 제거
	// 볼륨 패스가 디렉토리인 경우 그대로 사용

	basePath := volumePath
	ext := filepath.Ext(volumePath)
	if ext != "" {
		basePath = strings.TrimSuffix(volumePath, ext)
	}

	// 지원하는 오디오 확장자
	audioExts := []string{".mp3", ".ogg", ".wav", ".flac", ".m4a"}

	for _, audioExt := range audioExts {
		candidate := basePath + audioExt
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate, true
		}
	}

	return "", false
}

// UpdateViewerSettings 시리즈별 뷰어 설정 업데이트
// PATCH /api/v1/series/:id/viewer-settings
func (h *SeriesHandler) UpdateViewerSettings(c *fiber.Ctx) error {
	seriesID := c.Params("id")
	userID := middleware.GetUserID(c)

	var req model.UserSeriesSetting
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "invalid request body",
		})
	}

	// 입력 값 검증
	if req.ReadingMode != nil && *req.ReadingMode != "" && !h.isValidSetting("viewer_reading_mode", *req.ReadingMode) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid reading_mode"})
	}
	if req.ReadingDirection != nil && *req.ReadingDirection != "" && !h.isValidSetting("viewer_reading_direction", *req.ReadingDirection) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid reading_direction"})
	}
	if req.ClickDirection != nil && *req.ClickDirection != "" && !h.isValidSetting("viewer_click_direction", *req.ClickDirection) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid click_direction"})
	}
	if req.KeyboardDirection != nil && *req.KeyboardDirection != "" && !h.isValidSetting("viewer_keyboard_direction", *req.KeyboardDirection) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid keyboard_direction"})
	}
	if req.FitMode != nil && *req.FitMode != "" && !h.isValidSetting("viewer_fit_mode", *req.FitMode) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid fit_mode"})
	}
	// BackgroundColor 등 다른 필드 검증도 필요하다면 추가 (현재는 별도 검증 로직이 없으므로 생략)

	req.UserID = userID
	req.SeriesID = seriesID

	if err := h.userSeriesSettingRepo.Upsert(nil, &req); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to update viewer settings",
		})
	}

	return c.JSON(fiber.Map{
		"message": "viewer settings updated successfully",
	})
}

// enrichSeriesList 시리즈 목록 데이터 보정
func (h *SeriesHandler) enrichSeriesList(seriesList []model.Series, userID string) {
	for i := range seriesList {
		h.enrichSingleSeries(&seriesList[i], userID)
	}
}

// enrichSingleSeries 단일 시리즈 데이터 보정 (썸네일 URL, 진행도 계산)
func (h *SeriesHandler) enrichSingleSeries(s *model.Series, userID string) {
	// 썸네일 URL 설정
	if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
		url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", s.ID, s.UpdatedAt.Unix())
		s.ThumbnailURL = &url
	} else {
		pageID, err := h.seriesRepo.GetFirstPageID(nil, s.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			s.ThumbnailURL = &url
		}
	}

	// 진행도 계산
	totalPages, err := h.seriesRepo.GetTotalPages(nil, s.ID)
	if err != nil {
		log.Printf("failed to get total pages for series %s: %v", s.ID, err)
	} else {
		s.TotalPageCount = totalPages
	}

	if userID != "" {
		readPages, err := h.seriesRepo.GetReadPages(nil, userID, s.ID)
		if err != nil {
			log.Printf("failed to get read pages for user %s, series %s: %v", userID, s.ID, err)
		} else {
			s.ReadPageCount = readPages
		}
	}
}

// Search 시리즈 검색
// GET /api/v1/series/search
func (h *SeriesHandler) Search(c *fiber.Ctx) error {
	query := c.Query("q")
	if query == "" {
		return c.JSON(fiber.Map{
			"series": []model.Series{},
		})
	}

	userID := middleware.GetUserID(c)
	role := middleware.GetUserRole(c)

	var allowedIDs []string
	var err error
	if role != model.RoleMaster {
		allowedIDs, err = h.authService.GetAllowedLibraryIDs(userID)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "failed to check permissions",
			})
		}
	}

	seriesList, err := h.seriesRepo.Search(nil, query, userID, allowedIDs, role == model.RoleMaster)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "failed to search series",
		})
	}

	if seriesList == nil {
		seriesList = []model.Series{}
	}

	// 데이터 보정 (썸네일, 진행도)
	h.enrichSeriesList(seriesList, userID)

	return c.JSON(fiber.Map{
		"series": seriesList,
	})
}

// isValidSetting은 설정 값 유효성을 검사하는 간단한 헬퍼 (SettingHandler의 로직을 재사용하거나 복제)
func (h *SeriesHandler) isValidSetting(key, value string) bool {
	switch key {
	case "viewer_reading_mode":
		return value == "single" || value == "double" || value == "vertical"
	case "viewer_reading_direction", "viewer_click_direction", "viewer_keyboard_direction":
		return value == "ltr" || value == "rtl"
	case "viewer_fit_mode":
		return value == "screen" || value == "width" || value == "height" || value == "original"
	default:
		return true
	}
}
