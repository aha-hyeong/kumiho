package handler

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type AudioHandler struct {
	chapterRepo *repository.ChapterRepository
	volumeRepo  *repository.VolumeRepository
	seriesRepo  *repository.SeriesRepository
	authService *service.AuthService
}

func NewAudioHandler(
	chapterRepo *repository.ChapterRepository,
	volumeRepo *repository.VolumeRepository,
	seriesRepo *repository.SeriesRepository,
	authService *service.AuthService,
) *AudioHandler {
	return &AudioHandler{
		chapterRepo: chapterRepo,
		volumeRepo:  volumeRepo,
		seriesRepo:  seriesRepo,
		authService: authService,
	}
}

// GetAudioStream 오디오 스트리밍 (HTTP Range 지원)
// GET /api/v1/chapters/:chapterId/audio
func (h *AudioHandler) GetAudioStream(c *fiber.Ctx) error {
	chapterID := c.Params("chapterId")
	userID := middleware.GetUserID(c)

	// 1. 챕터 정보 조회
	chapter, err := h.chapterRepo.FindByID(nil, chapterID)
	if err != nil || chapter == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "chapter not found"})
	}

	// 2. 권한 확인 (Series/Library 레벨)
	volume, err := h.volumeRepo.FindByID(nil, chapter.VolumeID)
	if err != nil || volume == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	series, err := h.seriesRepo.FindByID(nil, volume.SeriesID, userID)
	if err != nil || series == nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	role := middleware.GetUserRole(c)
	if role != model.RoleMaster {
		allowedIDs, checkErr := h.authService.GetAllowedLibraryIDs(userID)
		if checkErr != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permissions"})
		}
		allowed := false
		for _, aid := range allowedIDs {
			if aid == series.LibraryID {
				allowed = true
				break
			}
		}
		if !allowed {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "access denied"})
		}
	}

	// 3. 파일 경로 확인
	audioPath, pathErr := resolvePathWithinBase(chapter.Path, series.Path)
	if pathErr != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "audio file not found"})
	}
	if !chapter.HasAudio && !isSupportedAudioPath(audioPath) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "chapter is not an audio resource"})
	}
	if !isSupportedAudioPath(audioPath) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "unsupported audio format"})
	}

	// 4. 파일 존재 여부 및 타입 확인
	info, err := os.Stat(audioPath)
	if err != nil {
		if os.IsNotExist(err) {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "audio file not found on disk"})
		}
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to access audio file"})
	}

	if info.IsDir() {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "target path is a directory"})
	}

	// 5. Content-Type 설정 (SendFile 이전에 Type()으로 설정하면 Fiber가 덮어쓰지 않음)
	ext := strings.ToLower(filepath.Ext(audioPath))
	switch ext {
	case ".mp3":
		c.Type("mp3")
	case ".m4a", ".m4b", ".mp4":
		c.Set("Content-Type", "audio/mp4")
	case ".aac":
		c.Set("Content-Type", "audio/aac")
	case ".wav":
		c.Type("wav")
	case ".flac":
		c.Set("Content-Type", "audio/flac")
	case ".ogg", ".oga":
		c.Type("ogg")
	case ".wma":
		c.Set("Content-Type", "audio/x-ms-wma")
	case ".opus":
		c.Set("Content-Type", "audio/opus")
	default:
		c.Set("Content-Type", "audio/mpeg")
	}

	// 6. Fiber의 SendFile은 내부적으로 HTTP Range를 처리함
	return c.SendFile(audioPath)
}
