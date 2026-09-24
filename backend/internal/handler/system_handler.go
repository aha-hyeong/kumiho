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
	versionCache      *VersionInfo
	cacheMutex        sync.RWMutex
	lastChecked       time.Time
	refreshing        bool
	retryAfter        time.Time
	versionGeneration uint64
	releaseClient     *http.Client
	releaseBaseURL    string

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
const githubAPIBaseURL = "https://api.github.com/repos/" + GithubRepo

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

	if !force {
		h.cacheMutex.Lock()
		cached := VersionInfo{CurrentVersion: version.Version, LatestVersion: "알 수 없음"}
		if h.versionCache != nil {
			cached = *h.versionCache
		}
		if (h.versionCache == nil || time.Since(h.lastChecked) >= 24*time.Hour) &&
			!h.refreshing && !time.Now().Before(h.retryAfter) {
			h.refreshing = true
			generation := h.versionGeneration
			go h.refreshAutomaticVersion(generation)
		}
		h.cacheMutex.Unlock()
		return c.JSON(cached)
	}

	// 최신 버전 조회
	latest, err := h.fetchLatestVersion(version.Version)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).JSON(fiber.Map{"error": "version check failed"})
	}

	h.cacheMutex.Lock()
	info := versionInfoFor(latest)
	h.versionCache = info
	h.lastChecked = time.Now()
	h.retryAfter = time.Time{}
	h.versionGeneration++
	h.cacheMutex.Unlock()

	return c.JSON(info)
}

func versionInfoFor(latest string) *VersionInfo {
	needsUpdate := false
	if latest != "" {
		if cmp, err := version.Compare(latest, version.Version); err == nil {
			needsUpdate = cmp > 0
		} else {
			needsUpdate = latest != version.Version
		}
	}
	return &VersionInfo{CurrentVersion: version.Version, LatestVersion: latest, NeedsUpdate: needsUpdate}
}

func (h *SystemHandler) refreshAutomaticVersion(generation uint64) {
	latest, err := h.fetchLatestVersion(version.Version)
	h.cacheMutex.Lock()
	defer h.cacheMutex.Unlock()
	if generation != h.versionGeneration {
		h.refreshing = false
		return // Manual refresh superseded the background result.
	}
	h.refreshing = false
	if err != nil {
		h.retryAfter = time.Now().Add(updateFailureCooldown)
		return
	}
	h.versionCache = versionInfoFor(latest)
	h.lastChecked = time.Now()
	h.retryAfter = time.Time{}
}

func (h *SystemHandler) fetchLatestVersion(currentVersion string) (string, error) {
	client := h.releaseClient
	if client == nil {
		client = &http.Client{Timeout: 5 * time.Second}
	}
	baseURL := h.releaseBaseURL
	if baseURL == "" {
		baseURL = githubAPIBaseURL
	}
	return h.fetchLatestVersionWithClient(currentVersion, client, baseURL)
}

func (h *SystemHandler) fetchLatestVersionWithClient(currentVersion string, client *http.Client, baseURL string) (string, error) {
	if !version.IsPrerelease(currentVersion) {
		release, err := fetchLatestStableRelease(client, baseURL+"/releases/latest")
		if err != nil {
			return "", err
		}
		return release.TagName, nil
	}

	releases, err := fetchGitHubReleases(client, baseURL+"/releases?per_page=100")
	if err != nil {
		return "", err
	}

	latest := selectLatestVersion(releases, currentVersion)
	if latest == "" {
		return "", fmt.Errorf("no suitable release found")
	}

	return latest, nil
}

func fetchLatestStableRelease(client *http.Client, url string) (*githubRelease, error) {
	release, err := fetchGitHubRelease(client, url)
	if err != nil {
		return nil, err
	}

	if release.Draft || release.Prerelease || release.TagName == "" {
		return nil, fmt.Errorf("no suitable stable release found")
	}

	if !version.IsValid(release.TagName) {
		return nil, fmt.Errorf("invalid version tag from github: %s", release.TagName)
	}

	return release, nil
}

func fetchGitHubRelease(client *http.Client, url string) (*githubRelease, error) {
	req, err := newGitHubRequest(url)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status: %d", resp.StatusCode)
	}

	var release githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&release); err != nil {
		return nil, err
	}

	return &release, nil
}

func fetchGitHubReleases(client *http.Client, url string) ([]githubRelease, error) {
	req, err := newGitHubRequest(url)
	if err != nil {
		return nil, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("github api returned status: %d", resp.StatusCode)
	}

	var releases []githubRelease
	if err := json.NewDecoder(resp.Body).Decode(&releases); err != nil {
		return nil, err
	}

	return releases, nil
}

func newGitHubRequest(url string) (*http.Request, error) {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("User-Agent", "kumiho/"+version.Version)
	req.Header.Set("Accept", "application/vnd.github+json")

	return req, nil
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

		if !version.IsValid(release.TagName) {
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
