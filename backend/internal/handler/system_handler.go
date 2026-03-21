package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/version"
	"github.com/gofiber/fiber/v2"
)

type SystemHandler struct {
	settingRepo repository.SettingRepository

	// 버전 캐시
	versionCache *VersionInfo
	cacheMutex   sync.RWMutex
	lastChecked  time.Time

	// 수동 체크 제한 (Rate Limit)
	manualCheckCount map[string]int // date -> count
	countMutex       sync.Mutex
}

type VersionInfo struct {
	CurrentVersion string `json:"current_version"`
	LatestVersion  string `json:"latest_version"`
	NeedsUpdate    bool   `json:"needs_update"`
}

type githubRelease struct {
	TagName    string `json:"tag_name"`
	Prerelease bool   `json:"prerelease"`
	Draft      bool   `json:"draft"`
}

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
	}

	// 캐시 확인 (Read Lock) - 수동 체크(force=true)가 아닐 때만 유효함
	h.cacheMutex.RLock()
	if !force && h.versionCache != nil && time.Since(h.lastChecked) < 24*time.Hour {
		cached := *h.versionCache
		h.cacheMutex.RUnlock()
		return c.JSON(cached)
	}
	h.cacheMutex.RUnlock()

	// 최신 버전 조회
	latest, err := h.fetchLatestVersion(version.Version)
	if err != nil {
		// 조회 실패 시 캐시가 있으면 캐시라도 반환 (Read Lock)
		h.cacheMutex.RLock()
		if h.versionCache != nil {
			cached := *h.versionCache
			h.cacheMutex.RUnlock()
			return c.JSON(cached)
		}
		h.cacheMutex.RUnlock()

		return c.JSON(VersionInfo{
			CurrentVersion: version.Version,
			LatestVersion:  "알 수 없음",
			NeedsUpdate:    false,
		})
	}

	needsUpdate := false
	if latest != "" {
		if cmp, cmpErr := version.Compare(latest, version.Version); cmpErr == nil {
			needsUpdate = cmp > 0
		} else {
			needsUpdate = latest != version.Version
		}
	}

	h.cacheMutex.Lock()
	info := &VersionInfo{
		CurrentVersion: version.Version,
		LatestVersion:  latest,
		NeedsUpdate:    needsUpdate,
	}
	h.versionCache = info
	h.lastChecked = time.Now()
	h.cacheMutex.Unlock()

	return c.JSON(info)
}

func (h *SystemHandler) fetchLatestVersion(currentVersion string) (string, error) {
	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(fmt.Sprintf("https://api.github.com/repos/%s/releases?per_page=100", GithubRepo))
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github api returned status: %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return "", err
	}

	return selectLatestVersion(releases, currentVersion), nil
}

func selectLatestVersion(releases []githubRelease, currentVersion string) string {
	currentIsPrerelease := version.IsPrerelease(currentVersion)
	best := ""

	for _, release := range releases {
		if release.Draft || release.TagName == "" {
			continue
		}

		if !currentIsPrerelease && release.Prerelease {
			continue
		}

		if _, err := version.Compare(release.TagName, release.TagName); err != nil {
			continue
		}

		if best == "" {
			best = release.TagName
			continue
		}

		cmp, err := version.Compare(release.TagName, best)
		if err != nil {
			continue
		}
		if cmp > 0 {
			best = release.TagName
		}
	}

	return best
}
