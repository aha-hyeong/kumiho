package handler

import (
	"archive/zip"
	"bufio"
	"fmt"
	"io"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
)

type DownloadHandler struct {
	authService *service.AuthService
	seriesRepo  *repository.SeriesRepository
	volumeRepo  *repository.VolumeRepository
}

func NewDownloadHandler(authService *service.AuthService, seriesRepo *repository.SeriesRepository, volumeRepo *repository.VolumeRepository) *DownloadHandler {
	return &DownloadHandler{
		authService: authService,
		seriesRepo:  seriesRepo,
		volumeRepo:  volumeRepo,
	}
}

// checkPermission 다운로드 권한 확인
func (h *DownloadHandler) checkPermission(c *fiber.Ctx) error {
	userID := middleware.GetUserID(c)
	log.Printf("Checking download permissions for userID: %s", userID)

	user, err := h.authService.GetUserByID(userID)
	if err != nil {
		log.Printf("Failed to get user by ID: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to check permission"})
	}
	if user == nil {
		log.Printf("User not found: %s", userID)
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "user not found"})
	}

	if user.Role != model.RoleMaster && !user.CanDownload {
		log.Printf("User %s denied download (Role: %s, CanDownload: %v)", userID, user.Role, user.CanDownload)
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "download permission required"})
	}
	return nil
}

// DownloadSeries 시리즈 전체 다운로드 (Zip 스트리밍)
// GET /api/v1/download/series/:id
func (h *DownloadHandler) DownloadSeries(c *fiber.Ctx) error {
	seriesID := c.Params("id")
	log.Printf("DownloadSeries requested for ID: %s", seriesID)

	if err := h.checkPermission(c); err != nil {
		return err
	}

	userID := middleware.GetUserID(c)
	// FindByID(db, id, userID) 순서 맞춤
	series, err := h.seriesRepo.FindByID(nil, seriesID, userID)
	if err != nil {
		log.Printf("Series query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to query series"})
	}
	if series == nil {
		log.Printf("Series not found: %s", seriesID)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "series not found"})
	}

	// 파일명 정리 (특수문자 제거 등)
	safeTitle := sanitizeFilename(series.Title)
	filename := fmt.Sprintf("%s.zip", safeTitle)
	encodedFilename := url.QueryEscape(filename)

	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", filename, encodedFilename))
	c.Set("Content-Type", "application/zip")
	// 버퍼링 방지 및 즉시 전송
	c.Set("X-Content-Type-Options", "nosniff")

	// 스트리밍 응답
	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		basePath := series.Path
		_ = filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("Walk error at %s: %v", path, err)
				return nil // 에러 발생 시 건너뜀
			}
			if info.IsDir() {
				return nil
			}

			// 썸네일 등 숨김 파일 제외 (선택 사항)
			if strings.HasPrefix(info.Name(), ".") {
				return nil
			}

			// 상대 경로 계산
			relPath, err := filepath.Rel(basePath, path)
			if err != nil {
				log.Printf("Failed to get relative path for %s: %v", path, err)
				return nil
			}

			// ZIP 내부 경로는 항상 슬래시(/) 사용 (Windows 호환성)
			relPath = filepath.ToSlash(relPath)

			// Zip 엔트리 생성
			zipFile, err := zipWriter.Create(relPath)
			if err != nil {
				log.Printf("Failed to create zip entry for %s: %v", relPath, err)
				return nil
			}

			// 파일 내용 복사
			fsFile, err := os.Open(path)
			if err != nil {
				log.Printf("Failed to open file %s: %v", path, err)
				return nil
			}
			defer fsFile.Close()

			if _, err := io.Copy(zipFile, fsFile); err != nil {
				log.Printf("Failed to copy content to zip for %s: %v", relPath, err)
				return nil
			}

			// 주기적으로 Flush하여 타임아웃 방지
			w.Flush()
			return nil
		})
	})

	return nil
}

// DownloadVolume 볼륨 다운로드 (파일이면 직접 전송, 폴더면 Zip 스트리밍)
// GET /api/v1/download/volumes/:id
func (h *DownloadHandler) DownloadVolume(c *fiber.Ctx) error {
	volumeID := c.Params("id")
	log.Printf("DownloadVolume requested for ID: %s", volumeID)

	if err := h.checkPermission(c); err != nil {
		return err
	}

	// volumeID 이미 선언됨
	volume, err := h.volumeRepo.FindByID(nil, volumeID)
	if err != nil {
		log.Printf("Volume query error: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to query volume"})
	}
	if volume == nil {
		log.Printf("Volume not found: %s", volumeID)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume not found"})
	}

	info, err := os.Stat(volume.Path)
	if err != nil {
		log.Printf("Volume path access error: %v", err)
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "volume file/directory not found"})
	}

	safeTitle := sanitizeFilename(volume.Title)

	// 파일인 경우 (cbz, zip, rar 등)
	if !info.IsDir() {
		ext := filepath.Ext(volume.Path)
		filename := fmt.Sprintf("%s%s", safeTitle, ext) // 원본 확장자 유지
		encodedFilename := url.QueryEscape(filename)

		c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", filename, encodedFilename))
		return c.SendFile(volume.Path)
	}

	// 디렉토리인 경우 Zip 스트리밍
	filename := fmt.Sprintf("%s.zip", safeTitle)
	encodedFilename := url.QueryEscape(filename)

	c.Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", filename, encodedFilename))
	c.Set("Content-Type", "application/zip")

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		zipWriter := zip.NewWriter(w)
		defer zipWriter.Close()

		basePath := volume.Path
		_ = filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				log.Printf("Walk error at %s: %v", path, err)
				return nil
			}
			if info.IsDir() || strings.HasPrefix(info.Name(), ".") {
				return nil
			}

			relPath, err := filepath.Rel(basePath, path)
			if err != nil {
				log.Printf("Failed to get relative path for %s: %v", path, err)
				return nil
			}

			// ZIP 내부 경로는 항상 슬래시(/) 사용
			relPath = filepath.ToSlash(relPath)

			zipFile, err := zipWriter.Create(relPath)
			if err != nil {
				log.Printf("Failed to create zip entry for %s: %v", relPath, err)
				return nil
			}

			fsFile, err := os.Open(path)
			if err != nil {
				log.Printf("Failed to open file %s: %v", path, err)
				return nil
			}
			defer fsFile.Close()

			if _, err := io.Copy(zipFile, fsFile); err != nil {
				log.Printf("Failed to copy content to zip for %s: %v", relPath, err)
				return nil
			}
			w.Flush()
			return nil
		})
	})

	return nil
}

func sanitizeFilename(name string) string {
	// 윈도우/리눅스 파일명 금지 문자 제거
	invalid := []string{"/", "\\", ":", "*", "?", "\"", "<", ">", "|"}
	for _, char := range invalid {
		name = strings.ReplaceAll(name, char, "_")
	}
	return name
}
