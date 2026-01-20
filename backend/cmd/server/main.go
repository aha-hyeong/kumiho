package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"

	"github.com/aha-hyeong/kumiho/backend/internal/config"
	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/handler"
	"github.com/aha-hyeong/kumiho/backend/internal/middleware"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
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
	defer database.Close()

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

	// 서비스 초기화
	authService := service.NewAuthService(userRepo, cfg)

	// 스캐너 초기화
	fileScanner := scanner.NewScanner(libraryRepo, seriesRepo, volumeRepo, chapterRepo, pageRepo)
	defer fileScanner.StopScheduler()
	defer fileScanner.StopWatcher()

	// 저장된 스캔 설정 로드 및 적용
	if setting, err := settingRepo.GetByKey(nil, "scan_interval"); err == nil && setting != nil {
		var interval int
		fmt.Sscanf(setting.Value, "%d", &interval)
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
	seriesHandler := handler.NewSeriesHandler(seriesRepo, libraryRepo, authService, volumeRepo, chapterRepo, pageRepo, completionRepo, cfg)
	imageHandler := handler.NewImageHandler(pageRepo, chapterRepo, volumeRepo, seriesRepo, authService, cfg)
	progressHandler := handler.NewProgressHandler(progressRepo, seriesRepo, authService, volumeRepo, chapterRepo, completionRepo)
	settingHandler := handler.NewSettingHandler(settingRepo, fileScanner)

	// 미들웨어 초기화
	authMiddleware := middleware.NewAuthMiddleware(authService)

	// Fiber 앱 생성
	app := fiber.New(fiber.Config{
		AppName:   "Kumiho API v1.0.0",
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

	// 404 핸들러
	app.Use(func(c *fiber.Ctx) error {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "not found",
		})
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
