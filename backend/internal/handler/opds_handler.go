package handler

import (
	"encoding/base64"
	"encoding/xml"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

type OPDSHandler struct {
	seriesRepo  *repository.SeriesRepository
	libraryRepo *repository.LibraryRepository
	volumeRepo  *repository.VolumeRepository
	chapterRepo *repository.ChapterRepository
	userRepo    *repository.UserRepository
	authService *service.AuthService
	config      *config.Config
}

func NewOPDSHandler(
	seriesRepo *repository.SeriesRepository,
	libraryRepo *repository.LibraryRepository,
	volumeRepo *repository.VolumeRepository,
	chapterRepo *repository.ChapterRepository,
	userRepo *repository.UserRepository,
	authService *service.AuthService,
	cfg *config.Config,
) *OPDSHandler {
	return &OPDSHandler{
		seriesRepo:  seriesRepo,
		libraryRepo: libraryRepo,
		volumeRepo:  volumeRepo,
		chapterRepo: chapterRepo,
		userRepo:    userRepo,
		authService: authService,
		config:      cfg,
	}
}

// BasicAuthMiddleware OPDS 전용 Basic Auth 미들웨어
func (h *OPDSHandler) BasicAuthMiddleware(c *fiber.Ctx) error {
	// 1. URL 파라미터 또는 헤더에서 API Key 확인 (Kavita 방식)
	apiKey := c.Query("key")
	if apiKey == "" {
		apiKey = c.Get("X-OPDS-API-KEY")
	}

	if apiKey != "" {
		// API Key로 사용자 조회
		user, err := h.userRepo.FindByOPDSKey(nil, apiKey)
		if err != nil {
			return h.sendError(c, http.StatusInternalServerError, "failed to verify api key")
		}
		if user != nil {
			// 컨텍스트에 사용자 정보 저장
			c.Locals("userID", user.ID)
			c.Locals("role", user.Role)
			return c.Next()
		}
		// 유효하지 않은 키인 경우 계속해서 Basic Auth 시도 (또는 에러 반환)
	}

	// 2. 표준 HTTP Basic Auth 확인
	auth := c.Get("Authorization")
	if auth == "" {
		c.Set("WWW-Authenticate", `Basic realm="Kumiho OPDS"`)
		return c.SendStatus(http.StatusUnauthorized)
	}

	parts := strings.Split(auth, " ")
	if len(parts) != 2 || parts[0] != "Basic" {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "invalid auth header"})
	}

	payload, err := base64.StdEncoding.DecodeString(parts[1])
	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "failed to decode auth"})
	}

	pair := strings.SplitN(string(payload), ":", 2)
	if len(pair) != 2 {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "invalid auth format"})
	}

	username, password := pair[0], pair[1]

	// AuthService를 통한 사용자 검증
	tokenResp, err := h.authService.Login(&service.LoginRequest{
		Username: username,
		Password: password,
	}, nil)

	if err != nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "invalid credentials"})
	}

	// 컨텍스트에 사용자 정보 저장
	c.Locals("userID", tokenResp.User.ID)
	c.Locals("role", tokenResp.User.Role)

	return c.Next()
}

// Catalog 최상위 카탈로그 (라이브러리 목록)
// GET /api/v1/opds
func (h *OPDSHandler) Catalog(c *fiber.Ctx) error {
	userID := c.Locals("userID").(string)
	
	libraries, err := h.libraryRepo.FindAll(nil)
	if err != nil {
		return h.sendError(c, http.StatusInternalServerError, "failed to fetch libraries")
	}

	allowedIDs, _ := h.authService.GetAllowedLibraryIDs(userID)
	role := c.Locals("role").(model.Role)

	feed := h.newFeed("Kumiho OPDS Catalog", h.baseURL(c, "/api/v1/opds"))
	
	for _, lib := range libraries {
		// 권한 확인
		if role != model.RoleMaster && lib.Type != "SYSTEM" {
			allowed := false
			for _, aid := range allowedIDs {
				if aid == lib.ID {
					allowed = true
					break
				}
			}
			if !allowed {
				continue
			}
		}

		entry := model.Entry{
			ID:      fmt.Sprintf("urn:kumiho:library:%s", lib.ID),
			Title:   lib.Name,
			Updated: lib.UpdatedAt,
			Links: []model.Link{
				{
					Rel:  "subsection",
					Type: "application/atom+xml;profile=opds-catalog;kind=navigation",
					Href: h.baseURL(c, fmt.Sprintf("/api/v1/opds/library/%s", lib.ID)),
				},
			},
		}
		feed.Entries = append(feed.Entries, entry)
	}

	return h.sendXML(c, feed)
}

// LibrarySeries 라이브러리 내 시리즈 목록
// GET /api/v1/opds/library/:id
func (h *OPDSHandler) LibrarySeries(c *fiber.Ctx) error {
	libraryID := c.Params("id")
	userID := c.Locals("userID").(string)

	seriesList, err := h.seriesRepo.FindByLibraryID(nil, libraryID, userID)
	if err != nil {
		return h.sendError(c, http.StatusInternalServerError, "failed to fetch series")
	}

	lib, _ := h.libraryRepo.FindByID(nil, libraryID)
	title := "Series List"
	if lib != nil {
		title = lib.Name
	}

	feed := h.newFeed(title, h.baseURL(c, fmt.Sprintf("/api/v1/opds/library/%s", libraryID)))
	feed.Links = append(feed.Links, model.Link{
		Rel:  "up",
		Type: "application/atom+xml;profile=opds-catalog;kind=navigation",
		Href: h.baseURL(c, "/api/v1/opds"),
	})

	for _, s := range seriesList {
		entry := model.Entry{
			ID:      fmt.Sprintf("urn:kumiho:series:%s", s.ID),
			Title:   s.Title,
			Updated: s.UpdatedAt,
			Summary: s.Description,
			Links: []model.Link{
				{
					Rel:  "subsection",
					Type: "application/atom+xml;profile=opds-catalog;kind=navigation",
					Href: h.baseURL(c, fmt.Sprintf("/api/v1/opds/series/%s", s.ID)),
				},
			},
		}

		if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
			entry.Links = append(entry.Links, model.Link{
				Rel:  "http://opds-spec.org/image",
				Type: "image/jpeg",
				Href: h.baseURL(c, fmt.Sprintf("/api/v1/series/%s/thumbnail", s.ID)),
			})
			entry.Links = append(entry.Links, model.Link{
				Rel:  "http://opds-spec.org/image/thumbnail",
				Type: "image/jpeg",
				Href: h.baseURL(c, fmt.Sprintf("/api/v1/series/%s/thumbnail", s.ID)),
			})
		}

		feed.Entries = append(feed.Entries, entry)
	}

	return h.sendXML(c, feed)
}

// SeriesVolumes 시리즈 내 볼륨 목록
// GET /api/v1/opds/series/:id
func (h *OPDSHandler) SeriesVolumes(c *fiber.Ctx) error {
	seriesID := c.Params("id")
	userID := c.Locals("userID").(string)

	series, _ := h.seriesRepo.FindByID(nil, seriesID, userID)
	if series == nil {
		return h.sendError(c, http.StatusNotFound, "series not found")
	}

	volumes, err := h.volumeRepo.FindBySeriesID(nil, seriesID)
	if err != nil {
		return h.sendError(c, http.StatusInternalServerError, "failed to fetch volumes")
	}

	feed := h.newFeed(series.Title, h.baseURL(c, fmt.Sprintf("/api/v1/opds/series/%s", seriesID)))
	feed.Links = append(feed.Links, model.Link{
		Rel:  "up",
		Type: "application/atom+xml;profile=opds-catalog;kind=navigation",
		Href: h.baseURL(c, fmt.Sprintf("/api/v1/opds/library/%s", series.LibraryID)),
	})

	for _, v := range volumes {
		entry := model.Entry{
			ID:      fmt.Sprintf("urn:kumiho:volume:%s", v.ID),
			Title:   v.Title,
			Updated: v.UpdatedAt,
			Summary: v.Description,
			Links: []model.Link{
				{
					Rel:  "http://opds-spec.org/acquisition",
					Type: "application/zip", // 만화책은 보통 zip/cbz 형태 다운로드 지원 시
					Href: h.baseURL(c, fmt.Sprintf("/api/v1/download/volumes/%s", v.ID)),
				},
			},
		}

		if v.ThumbnailPath != nil && *v.ThumbnailPath != "" {
			entry.Links = append(entry.Links, model.Link{
				Rel:  "http://opds-spec.org/image",
				Type: "image/jpeg",
				Href: h.baseURL(c, fmt.Sprintf("/api/v1/volumes/%s/thumbnail", v.ID)),
			})
		}

		feed.Entries = append(feed.Entries, entry)
	}

	return h.sendXML(c, feed)
}

// Helper methods

func (h *OPDSHandler) newFeed(title, href string) model.Feed {
	return model.Feed{
		ID:      href,
		Title:   title,
		Updated: time.Now(),
		Links: []model.Link{
			{Rel: "self", Type: "application/atom+xml;profile=opds-catalog;kind=navigation", Href: href},
			{Rel: "start", Type: "application/atom+xml;profile=opds-catalog;kind=navigation", Href: h.baseURL(nil, "/api/v1/opds")},
		},
	}
}

func (h *OPDSHandler) baseURL(c *fiber.Ctx, path string) string {
	// 기본 도메인 설정이 있으면 사용, 없으면 요청 헤더에서 추출
	host := ""
	if c != nil {
		host = c.Hostname()
		protocol := "http"
		if c.Secure() {
			protocol = "https"
		}
		// 포트가 있으면 포함 (localhost:3000 등)
		return fmt.Sprintf("%s://%s%s", protocol, host, path)
	}
	return path
}

func (h *OPDSHandler) sendXML(c *fiber.Ctx, feed model.Feed) error {
	output, err := xml.MarshalIndent(feed, "", "  ")
	if err != nil {
		return c.Status(http.StatusInternalServerError).SendString(err.Error())
	}

	c.Set("Content-Type", "application/atom+xml; charset=utf-8")
	return c.SendString(xml.Header + string(output))
}

func (h *OPDSHandler) sendError(c *fiber.Ctx, code int, message string) error {
	return c.Status(code).JSON(fiber.Map{"error": message})
}
