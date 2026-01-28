package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/gofiber/fiber/v2"
)

type SystemHandler struct {
	settingRepo repository.SettingRepository
	
	// 버전 캐시
	versionCache     *VersionInfo
	cacheMutex       sync.Mutex
	lastChecked      time.Time
	
	// 수동 체크 제한 (Rate Limit)
	manualCheckCount map[string]int // date -> count
	countMutex       sync.Mutex
}

type VersionInfo struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	NeedsUpdate    bool   `json:"needs_update"`
}

const CurrentVersion = "v0.2.10"
const GithubRepo = "aha-hyeong/kumiho"

func NewSystemHandler(settingRepo repository.SettingRepository) *SystemHandler {
	return &SystemHandler{
		settingRepo:      settingRepo,
		manualCheckCount: make(map[string]int),
	}
}

// GetVersion 시스템 버전 정보 조회
// GET /api/v1/system/version
func (h *SystemHandler) GetVersion(c *fiber.Ctx) error {
	force := c.Query("force") == "true"
	
	if force {
		// 수동 체크 제한 확인
		today := time.Now().Format("2006-01-02")
		h.countMutex.Lock()
		if h.manualCheckCount[today] >= 10 {
			h.countMutex.Unlock()
			return c.Status(fiber.StatusTooManyRequests).JSON(fiber.Map{
				"error": "오늘의 수동 업데이트 확인 횟수(10회)를 초과했습니다.",
			})
		}
		h.manualCheckCount[today]++
		h.countMutex.Unlock()
	} else if h.versionCache != nil && time.Since(h.lastChecked) < 24*time.Hour {
		// 캐시 반환
		return c.JSON(h.versionCache)
	}

	// 최신 버전 조회
	latest, err := h.fetchLatestVersion()
	if err != nil {
		// 조회 실패 시 캐시가 있으면 캐시라도 반환
		if h.versionCache != nil {
			return c.JSON(h.versionCache)
		}
		return c.JSON(VersionInfo{
			CurrentVersion: CurrentVersion,
			LatestVersion:  "알 수 없음",
			NeedsUpdate:    false,
		})
	}

	h.cacheMutex.Lock()
	h.versionCache = &VersionInfo{
		CurrentVersion: CurrentVersion,
		LatestVersion:  latest,
		NeedsUpdate:    CurrentVersion != latest && latest != "",
	}
	h.lastChecked = time.Now()
	h.cacheMutex.Unlock()

	return c.JSON(h.versionCache)
}

func (h *SystemHandler) fetchLatestVersion() (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("https://api.github.com/repos/%s/releases/latest", GithubRepo))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github api returned status: %d", resp.StatusCode)
	}

	var data struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	return data.TagName, nil
}
