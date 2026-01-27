package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/filesystem"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/frontend"
	"github.com/aha-hyeong/kumiho/backend/internal/handler"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
)

func main() {
	// 설정 로드
	cfg := config.Load()

	// 앱 컨텍스트 생성 (Graceful Shutdown 용)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 데이터베이스 연결
	if err := database.Connect(cfg.DatabasePath); err != nil {
		log.Fatalf("Failed to connect to database: %v", err)
	}
	defer func() { _ = database.Close() }()

	// 리포지토리 초기화
	userRepo := repository.NewUserRepository()
	libraryRepo := repository.NewLibraryRepository()
	seriesRepo := repository.NewSeriesRepository()
	volumeRepo := repository.NewVolumeRepository()
	chapterRepo := repository.NewChapterRepository()
	pageRepo := repository.NewPageRepository()
	progressRepo := repository.NewReadingProgressRepository()
	completionRepo := repository.NewVolumeCompletionRepository()
	settingRepo := repository.NewSettingRepository()
	userSettingRepo := repository.NewUserSettingRepository()
	userSeriesSettingRepo := repository.NewUserSeriesSettingRepository()

	// 서비스 초기화
	authService := service.NewAuthService(userRepo, cfg)

	// 스캐너 초기화
	fileScanner := scanner.NewScanner(libraryRepo, seriesRepo, volumeRepo, chapterRepo, pageRepo, settingRepo)
	defer fileScanner.StopScheduler()
	defer fileScanner.StopWatcher()

	// 저장된 스캔 설정 로드 및 적용
	if setting, err := settingRepo.GetByKey(nil, "scan_interval"); err == nil && setting != nil {
		var interval int
		_, _ = fmt.Sscanf(setting.Value, "%d", &interval)
		fileScanner.StartScheduler(interval)
	}
	if setting, err := settingRepo.GetByKey(nil, "scan_watch"); err == nil && setting != nil && setting.Value == "true" {
		if err := fileScanner.StartWatcher(); err != nil {
			log.Printf("Failed to start file watcher: %v", err)
		}
	}

	// 핸들러 초기화
	authHandler := handler.NewAuthHandler(authService, cfg)
	userHandler := handler.NewUserHandler(authService)
	libraryHandler := handler.NewLibraryHandler(ctx, libraryRepo, authService, fileScanner)
	imageHandler := handler.NewImageHandler(pageRepo, chapterRepo, volumeRepo, seriesRepo, authService, cfg)
	progressHandler := handler.NewProgressHandler(progressRepo, seriesRepo, authService, volumeRepo, chapterRepo, completionRepo)
	settingHandler := handler.NewSettingHandler(settingRepo, userSettingRepo, fileScanner)
	seriesHandler := handler.NewSeriesHandler(seriesRepo, libraryRepo, authService, volumeRepo, chapterRepo, pageRepo, completionRepo, userSeriesSettingRepo, cfg)
	downloadHandler := handler.NewDownloadHandler(authService, seriesRepo, volumeRepo)
	systemHandler := handler.NewSystemHandler(settingRepo) // 추가

	// 미들웨어 초기화
	authMiddleware := middleware.NewAuthMiddleware(authService)

	// Fiber 앱 생성
	app := fiber.New(fiber.Config{
		AppName:   "Kumiho API v0.2.2",
		BodyLimit: 50 * 1024 * 1024, // 50MB
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"error": err.Error(),
			})
		},
	})

	// 글로벌 미들웨어
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "http://localhost:5173, http://localhost:3000, http://127.0.0.1:5173, http://localhost:5174",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, Cache-Control, Pragma, Expires",
		AllowMethods:     "GET, POST, PUT, PATCH, DELETE, OPTIONS",
		AllowCredentials: true,
	}))

	// 헬스체크
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok",
			"app":    "kumiho",
		})
	})

	// API v1 라우트
	v1 := app.Group("/api/v1")

	// === 인증 라우트 (공개) ===
	auth := v1.Group("/auth")
	auth.Get("/setup", authHandler.Setup)
	auth.Post("/register", authHandler.Register)
	auth.Post("/login", authHandler.Login)
	auth.Post("/logout", authHandler.Logout)
	auth.Post("/refresh", authHandler.Refresh)
	auth.Get("/me", authMiddleware.Protected(), authHandler.Me)
	auth.Put("/me", authMiddleware.Protected(), authHandler.UpdateProfile)
	auth.Put("/me/password", authMiddleware.Protected(), authHandler.ChangePassword)

	// === 인증 필요 라우트 ===
	protected := v1.Group("", authMiddleware.Protected())

	// 사용자 관리 (MASTER only)
	users := protected.Group("/users")
	users.Get("", userHandler.List)
	users.Post("", userHandler.Create)
	users.Delete("/:id", userHandler.Delete)
	users.Put("/:id", userHandler.Update)
	users.Put("/:id/libraries", userHandler.UpdateLibraries)

	// 라이브러리
	libraries := protected.Group("/libraries")
	libraries.Get("", libraryHandler.List)
	// NOTE: "/libraries/order" 라우트는 "/libraries/:id"보다 먼저 등록되어야 합니다.
	//       그렇지 않으면 "order"가 ID 파라미터로 매칭될 수 있습니다.
	libraries.Post("", libraryHandler.Create)
	libraries.Put("/order", libraryHandler.UpdateOrder)
	libraries.Get("/:id", libraryHandler.Get)
	libraries.Put("/:id", libraryHandler.Update)
	libraries.Post("/:id/scan", libraryHandler.Scan)
	libraries.Delete("/:id", libraryHandler.Delete)
	libraries.Get("/:libraryId/series", seriesHandler.ListByLibrary)

	// 시리즈
	series := protected.Group("/series")
	series.Get("/search", seriesHandler.Search)
	series.Get("/:id", seriesHandler.GetSeries)
	series.Patch("/:id", seriesHandler.UpdateSeries)
	series.Get("/:seriesId/volumes", seriesHandler.ListVolumes)
	series.Get("/:seriesId/progress", progressHandler.GetProgress)
	series.Patch("/:seriesId/progress", progressHandler.UpdateProgress)
	series.Post("/:seriesId/progress/compare", progressHandler.CompareProgress)
	series.Get("/:seriesId/completions", progressHandler.GetSeriesCompletions)
	series.Post("/:seriesId/complete", progressHandler.MarkSeriesComplete)
	series.Delete("/:seriesId/progress", progressHandler.ResetSeriesProgress)
	series.Post("/:id/thumbnail", seriesHandler.UploadThumbnail)
	series.Post("/:id/thumbnail/url", seriesHandler.DownloadThumbnail)
	series.Delete("/:id/thumbnail", seriesHandler.DeleteThumbnail)
	series.Get("/:id/viewer-settings", seriesHandler.GetViewerSettings)
	series.Patch("/:id/viewer-settings", seriesHandler.UpdateViewerSettings)
	series.Get("/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "series")
		return imageHandler.GetThumbnail(c)
	})

	// 볼륨
	volumes := protected.Group("/volumes")
	volumes.Get("/:id", seriesHandler.GetVolume)
	volumes.Get("/:volumeId/chapters", seriesHandler.ListChapters)
	volumes.Get("/:volumeId/progress", progressHandler.GetVolumeProgress)
	volumes.Post("/:volumeId/complete", progressHandler.MarkVolumeComplete)
	volumes.Get("/:volumeId/completion", progressHandler.GetVolumeCompletion)
	volumes.Delete("/:volumeId/completion", progressHandler.DeleteVolumeCompletion)
	volumes.Get("/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "volumes")
		return imageHandler.GetThumbnail(c)
	})
	volumes.Get("/:id/bgm", seriesHandler.GetVolumeBGM)
	volumes.Get("/:id/bgm/stream", seriesHandler.ServeVolumeBGM)

	// 챕터
	chapters := protected.Group("/chapters")
	chapters.Get("/:id", seriesHandler.GetChapter)
	chapters.Get("/:chapterId/pages", seriesHandler.ListPages)
	chapters.Get("/:chapterId/pages/:pageNumber/image", imageHandler.PageImageByNumber)
	chapters.Get("/:chapterId/progress", progressHandler.GetChapterProgress)
	chapters.Get("/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "chapters")
		return imageHandler.GetThumbnail(c)
	})

	// 페이지
	pages := protected.Group("/pages")
	pages.Get("/:id/image", imageHandler.GetPageImage)

	// 읽기 진행도
	progress := protected.Group("/reading-progress")
	progress.Get("", progressHandler.GetAllProgress)
	progress.Get("/recent", progressHandler.GetRecentProgress)
	progress.Post("/sync", progressHandler.SyncProgress)

	// 설정
	settingsApi := protected.Group("/settings")
	settingsApi.Get("", settingHandler.ListSettings)
	settingsApi.Put("/:key", settingHandler.UpdateSetting)

	// 다운로드
	download := protected.Group("/download")
	download.Get("/series/:id", downloadHandler.DownloadSeries)
	download.Get("/volumes/:id", downloadHandler.DownloadVolume)

	// 시스템
	system := protected.Group("/system")
	system.Get("/version", systemHandler.GetVersion)

	// === Frontend Serving (SPA Support) ===
	// API 라우트가 매칭되지 않은 모든 요청을 처리합니다.
	// 반드시 API 라우트 정의가 끝난 뒤에 위치해야 합니다.
	app.Get("/*", func(c *fiber.Ctx) error {
		// API 경로(/api/...)에 대한 404는 JSON 에러로 명확히 처리
		if strings.HasPrefix(c.Path(), "/api/") {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "api endpoint not found",
			})
		}

		// 그 외(웹 페이지) 요청은 임베딩된 프론트엔드 파일 서빙
		return filesystem.New(filesystem.Config{
			Root:         frontend.GetFileSystem(),
			Index:        "index.html",
			NotFoundFile: "index.html", // SPA Refresh 대응
		})(c)
	})
	// 시그널 핸들링 (graceful shutdown)
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)
		<-sigChan

		log.Println("Shutting down server...")
		cancel() // 컨텍스트 취소로 백그라운드 작업(스캐너 등) 중단

		if err := app.Shutdown(); err != nil {
			log.Printf("Error shutting down server: %v", err)
		}
	}()

	// 서버 시작
	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("🦊 Kumiho server starting on %s", addr)

	if err := app.Listen(addr); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
