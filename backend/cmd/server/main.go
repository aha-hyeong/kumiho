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
	pluginengine "github.com/aha-hyeong/kumiho/backend/internal/plugin"
	binaryruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime/binary"
	serviceruntime "github.com/aha-hyeong/kumiho/backend/internal/plugin/runtime/service"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/scanner"
	"github.com/aha-hyeong/kumiho/backend/internal/service"
	"github.com/aha-hyeong/kumiho/backend/internal/sse"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
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
	seriesCharacterRepo := repository.NewSeriesCharacterRepository()
	volumeRepo := repository.NewVolumeRepository()
	chapterRepo := repository.NewChapterRepository()
	pageRepo := repository.NewPageRepository()
	progressRepo := repository.NewReadingProgressRepository()
	completionRepo := repository.NewVolumeCompletionRepository()
	chapterCompletionRepo := repository.NewChapterCompletionRepository() // 추가
	settingRepo := repository.NewSettingRepository()
	pluginSecretRepo := repository.NewPluginSecretRepository()
	userSettingRepo := repository.NewUserSettingRepository()
	userSeriesSettingRepo := repository.NewUserSeriesSettingRepository()
	sessionRepo := repository.NewSessionRepository()
	viewerSessionRepo := repository.NewViewerSessionRepository()

	// SSE 허브 초기화 및 실행
	hub := sse.NewHub()
	go hub.Run()

	// 서비스 초기화
	authService := service.NewAuthService(userRepo, sessionRepo, cfg)

	// 스캐너 초기화
	fileScanner := scanner.NewScanner(libraryRepo, seriesRepo, volumeRepo, chapterRepo, pageRepo, settingRepo, cfg)
	defer fileScanner.StopScheduler()
	defer fileScanner.StopWatcher()

	// 서버 재시작으로 잔류한 SCANNING 상태 초기화
	if err := fileScanner.ResetStaleScanStates(); err != nil {
		log.Printf("Failed to reset stale scan states: %v", err)
	}

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

	// 공통 서비스 초기화
	seriesEnrichSvc := service.NewSeriesEnrichService(seriesRepo, chapterRepo, volumeRepo)

	// 플러그인 시스템 초기화 (Phase 1)
	pluginStore := pluginengine.NewSQLStore()
	pluginManager := pluginengine.NewManager(
		pluginStore,
		binaryruntime.NewRuntime(),
		serviceruntime.NewRuntime(),
	)
	pluginSecretSvc, secretSvcErr := service.NewPluginSecretService(cfg, pluginSecretRepo)
	if secretSvcErr != nil {
		log.Fatalf("Failed to initialize plugin secret service: %v", secretSvcErr)
	}
	pluginManager.SetEnvProvider(pluginSecretSvc)
	if bootstrapErr := pluginManager.Bootstrap(ctx); bootstrapErr != nil {
		log.Fatalf("Failed to bootstrap plugin manager: %v", bootstrapErr)
	}
	pluginRecords, err := pluginManager.List()
	if err != nil {
		log.Fatalf("Failed to list plugin records: %v", err)
	}
	log.Printf("Plugin manager initialized with %d persisted plugin records", len(pluginRecords))
	metadataSvc := service.NewMetadataService(cfg, nil, seriesRepo, seriesCharacterRepo, libraryRepo, settingRepo, pluginManager)
	pluginInstallSvc := service.NewPluginInstallService(cfg, nil, pluginManager, pluginSecretSvc)
	translationSvc := service.NewTranslationService(pluginManager, seriesRepo, settingRepo)

	// 핸들러 초기화
	authHandler := handler.NewAuthHandler(authService, cfg, hub)
	userHandler := handler.NewUserHandler(authService)
	libraryHandler := handler.NewLibraryHandler(ctx, libraryRepo, authService, fileScanner)
	imageHandler := handler.NewImageHandler(pageRepo, chapterRepo, volumeRepo, seriesRepo, authService, cfg)
	progressHandler := handler.NewProgressHandler(progressRepo, viewerSessionRepo, seriesRepo, authService, volumeRepo, chapterRepo, completionRepo, chapterCompletionRepo, hub, seriesEnrichSvc)
	settingHandler := handler.NewSettingHandler(settingRepo, userSettingRepo, fileScanner)
	seriesHandler := handler.NewSeriesHandler(seriesRepo, seriesCharacterRepo, libraryRepo, authService, volumeRepo, chapterRepo, pageRepo, completionRepo, chapterCompletionRepo, userSeriesSettingRepo, progressRepo, settingRepo, cfg, seriesEnrichSvc)
	downloadHandler := handler.NewDownloadHandler(authService, seriesRepo, volumeRepo, chapterRepo)
	systemHandler := handler.NewSystemHandler(settingRepo) // 추가
	statsHandler := handler.NewStatsHandler(progressRepo, completionRepo, viewerSessionRepo)
	audioHandler := handler.NewAudioHandler(chapterRepo, volumeRepo, seriesRepo, authService)
	bookmarkRepo := repository.NewBookmarkRepository()
	bookmarkHandler := handler.NewBookmarkHandler(bookmarkRepo, seriesRepo, volumeRepo, chapterRepo, authService)
	sseHandler := handler.NewSSEHandler(hub)
	filesystemHandler := handler.NewFilesystemHandler()
	pluginHandler := handler.NewPluginHandler(pluginManager, pluginInstallSvc, pluginSecretSvc)
	metadataHandler := handler.NewMetadataHandler(metadataSvc)
	seriesCharacterHandler := handler.NewSeriesCharacterHandler(seriesRepo, seriesCharacterRepo, cfg)
	translationHandler := handler.NewTranslationHandler(translationSvc)

	// 미들웨어 초기화
	authMiddleware := middleware.NewAuthMiddleware(authService)

	// Fiber 앱 생성
	app := fiber.New(fiber.Config{
		AppName:   "Kumiho API " + version.Version,
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
		ExposeHeaders:    "Accept-Ranges, Content-Range, Content-Length, Content-Disposition",
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
	auth.Get("/sessions", authMiddleware.Protected(), authHandler.ListSessions)
	auth.Delete("/sessions", authMiddleware.Protected(), authHandler.RevokeOtherSessions)
	auth.Delete("/sessions/:id", authMiddleware.Protected(), authHandler.RevokeSession)

	// === SSE 스트림 라우트 ===
	v1.Get("/sse", authMiddleware.Protected(), sseHandler.Handle)

	// === 인증 필요 라우트 ===
	protected := v1.Group("", authMiddleware.Protected())

	// 사용자 관리 (MASTER only)
	users := protected.Group("/users")
	users.Get("", userHandler.List)
	users.Post("", userHandler.Create)
	users.Delete("/:id", userHandler.Delete)
	users.Put("/:id", userHandler.Update)
	users.Put("/:id/libraries", userHandler.UpdateLibraries)
	users.Get("/sessions", authMiddleware.MasterOnly(), authHandler.ListAllSessions)
	users.Delete("/:userId/sessions/:sessionId", authMiddleware.MasterOnly(), authHandler.RevokeSessionByAdmin)

	// 파일시스템 브라우저 (MASTER only)
	protected.Get("/filesystem", authMiddleware.MasterOnly(), filesystemHandler.Browse)

	// 플러그인
	plugins := protected.Group("/plugins")
	plugins.Get("", pluginHandler.List)
	plugins.Get("/catalog", authMiddleware.MasterOnly(), pluginHandler.Catalog)
	plugins.Get("/updates", authMiddleware.MasterOnly(), pluginHandler.Updates)
	plugins.Get("/:id", pluginHandler.Get)
	plugins.Get("/:id/config", authMiddleware.MasterOnly(), pluginHandler.GetConfig)
	plugins.Put("/:id/config", authMiddleware.MasterOnly(), pluginHandler.UpdateConfig)
	plugins.Delete("/:id/config/:field", authMiddleware.MasterOnly(), pluginHandler.DeleteConfig)
	plugins.Post("/:id/auth/:action", authMiddleware.MasterOnly(), pluginHandler.AuthAction)
	plugins.Delete("/:id/auth/:action", authMiddleware.MasterOnly(), pluginHandler.DeleteAuthAction)
	plugins.Get("/:id/health", authMiddleware.MasterOnly(), pluginHandler.Healthcheck)
	plugins.Post("/install", authMiddleware.MasterOnly(), pluginHandler.Install)
	plugins.Delete("/:id", authMiddleware.MasterOnly(), pluginHandler.Uninstall)
	plugins.Post("/register-installed", authMiddleware.MasterOnly(), pluginHandler.RegisterInstalled)
	plugins.Post("/:id/activate", authMiddleware.MasterOnly(), pluginHandler.Activate)
	plugins.Post("/:id/deactivate", authMiddleware.MasterOnly(), pluginHandler.Deactivate)

	translations := protected.Group("/translations")
	translations.Post("/batch", authMiddleware.MasterOnly(), translationHandler.BatchTranslate)

	// 라이브러리
	libraries := protected.Group("/libraries")
	libraries.Get("", libraryHandler.List)
	// NOTE: "/libraries/order" 라우트는 "/libraries/:id"보다 먼저 등록되어야 합니다.
	//       그렇지 않으면 "order"가 ID 파라미터로 매칭될 수 있습니다.
	libraries.Post("", libraryHandler.Create)
	libraries.Put("/order", libraryHandler.UpdateOrder)
	libraries.Post("/scan", libraryHandler.ScanAll)
	libraries.Post("/:id/metadata/reset", authMiddleware.MasterOnly(), metadataHandler.ResetLibrary)
	libraries.Get("/:id", libraryHandler.Get)
	libraries.Put("/:id", libraryHandler.Update)
	libraries.Post("/:id/scan", libraryHandler.Scan)
	libraries.Post("/:id/scan/cancel", libraryHandler.CancelScan)
	libraries.Delete("/:id", libraryHandler.Delete)
	libraries.Get("/:libraryId/series", seriesHandler.ListByLibrary)

	// 시리즈
	series := protected.Group("/series")
	series.Get("/search", seriesHandler.Search)
	series.Post("/extensions/batch", seriesHandler.BatchGetExtensions)
	series.Get("/:id", seriesHandler.GetSeries)
	series.Patch("/:id", seriesHandler.UpdateSeries)
	series.Post("/:id/reset-metadata", authMiddleware.MasterOnly(), seriesHandler.ResetSeriesMetadata)
	series.Post("/:id/translate-description", authMiddleware.MasterOnly(), translationHandler.TranslateSeriesDescription)
	series.Post("/:id/metadata/search", metadataHandler.Search)
	series.Post("/:id/metadata/fetch", metadataHandler.Fetch)
	series.Post("/:id/metadata/apply", metadataHandler.Apply)
	series.Get("/:id/characters", seriesCharacterHandler.List)
	series.Post("/:id/characters", seriesCharacterHandler.Create)
	series.Post("/:id/characters/import", seriesCharacterHandler.Import)
	series.Post("/:id/characters/reorder", seriesCharacterHandler.Reorder)
	series.Patch("/:id/characters/:characterId", seriesCharacterHandler.Update)
	series.Delete("/:id/characters/:characterId", seriesCharacterHandler.Delete)
	series.Post("/:id/characters/:characterId/image", seriesCharacterHandler.UploadImage)
	series.Post("/:id/characters/:characterId/image/url", seriesCharacterHandler.UpdateImageURL)
	series.Delete("/:id/characters/:characterId/image", seriesCharacterHandler.DeleteImage)
	series.Get("/:id/characters/:characterId/image", seriesCharacterHandler.GetImage)
	series.Get("/:seriesId/volumes", seriesHandler.ListVolumes)
	series.Get("/:seriesId/chapters", seriesHandler.ListChaptersBySeries)
	series.Get("/:seriesId/progress", progressHandler.GetProgress)
	series.Get("/:seriesId/progress-list", progressHandler.GetSeriesProgressList)
	series.Patch("/:seriesId/progress", progressHandler.UpdateProgress)
	series.Post("/:seriesId/progress/compare", progressHandler.CompareProgress)
	series.Get("/:seriesId/completions", progressHandler.GetSeriesCompletions)
	series.Post("/:seriesId/complete", progressHandler.MarkSeriesComplete)
	series.Post("/:seriesId/volumes/:volumeId/complete-previous", progressHandler.MarkPreviousVolumesComplete)
	series.Post("/:seriesId/chapters/:chapterId/complete-previous", progressHandler.MarkPreviousChaptersComplete)
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
	volumes.Patch("/:id", seriesHandler.UpdateVolume)
	volumes.Post("/:id/thumbnail", seriesHandler.UploadVolumeThumbnail)
	volumes.Post("/:id/thumbnail/url", seriesHandler.UploadVolumeThumbnailFromURL)
	volumes.Delete("/:id/thumbnail", seriesHandler.DeleteVolumeThumbnail)
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
	chapters.Get("/:chapterId/pdf", imageHandler.ServeChapterPDF)
	chapters.Get("/:chapterId/epub", imageHandler.ServeChapterEpub)
	chapters.Post("/:chapterId/analyze", imageHandler.AnalyzeChapterPages)
	chapters.Get("/:chapterId/progress", progressHandler.GetChapterProgress)
	chapters.Get("/:chapterId/epub-progress", progressHandler.GetEpubProgress)
	chapters.Patch("/:chapterId/epub-progress", progressHandler.UpdateEpubProgress)
	chapters.Post("/:chapterId/complete", progressHandler.MarkChapterComplete)
	chapters.Delete("/:chapterId/progress", progressHandler.ResetChapterProgress)
	chapters.Get("/:id/thumbnail", func(c *fiber.Ctx) error {
		c.Locals("type", "chapters")
		return imageHandler.GetThumbnail(c)
	})
	chapters.Get("/:id/bgm", seriesHandler.GetChapterBGM)
	chapters.Get("/:id/bgm/stream", seriesHandler.ServeChapterBGM)
	chapters.Get("/:chapterId/audio", audioHandler.GetAudioStream)

	// 페이지
	pages := protected.Group("/pages")
	pages.Get("/:id/image", imageHandler.GetPageImage)

	// 읽기 진행도
	progress := protected.Group("/reading-progress")
	progress.Get("", progressHandler.GetAllProgress)
	progress.Get("/recent", progressHandler.GetRecentProgress)
	progress.Post("/sync", progressHandler.SyncProgress)
	progress.Post("/update", progressHandler.UpdateProgressWSReplacement)

	// 뷰어
	viewer := protected.Group("/viewer")
	viewer.Get("/init/:chapterId", seriesHandler.GetViewerInitData)
	viewer.Post("/start", progressHandler.StartViewing)
	viewer.Post("/resume-check", progressHandler.ResumeCheck)

	// 북마크
	bookmarks := protected.Group("/bookmarks")
	bookmarks.Post("", bookmarkHandler.CreateBookmark)
	bookmarks.Get("/series/:seriesId", bookmarkHandler.ListBySeries)
	bookmarks.Put("/:id", bookmarkHandler.UpdateBookmark)
	bookmarks.Delete("/:id", bookmarkHandler.DeleteBookmark)

	// 설정
	settingsApi := protected.Group("/settings")
	settingsApi.Get("", settingHandler.ListSettings)
	settingsApi.Put("/:key", settingHandler.UpdateSetting)

	// 다운로드
	download := protected.Group("/download")
	download.Get("/series/:id", downloadHandler.DownloadSeries)
	download.Get("/volumes/:id", downloadHandler.DownloadVolume)
	download.Get("/chapters/:id", downloadHandler.DownloadChapter)

	// 시스템
	system := protected.Group("/system")
	system.Get("/version", systemHandler.GetVersion)
	system.Get("/plugin-key-status", authMiddleware.MasterOnly(), func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"auto_generated": pluginSecretSvc.AutoGenerated(),
		})
	})

	stats := protected.Group("/stats")
	stats.Get("/personal", statsHandler.GetPersonalStats)
	stats.Post("/heartbeat", statsHandler.UpdateReadingTime)

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
