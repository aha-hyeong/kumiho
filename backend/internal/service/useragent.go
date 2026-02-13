package service

import "strings"

// DeviceInfo User-Agent에서 파싱한 기기 정보
type DeviceInfo struct {
	DeviceName string // 기기 이름 (간략)
	DeviceType string // desktop, tablet, mobile, unknown
	Browser    string // Chrome, Safari, Firefox 등
	OS         string // Windows, macOS, Linux, Android, iOS 등
}

// ParseUserAgent User-Agent 문자열에서 기기 정보를 추출 (간단한 문자열 매칭)
func ParseUserAgent(ua string) DeviceInfo {
	info := DeviceInfo{
		DeviceType: "unknown",
		Browser:    "Unknown",
		OS:         "Unknown",
	}

	if ua == "" {
		return info
	}

	lowerUA := strings.ToLower(ua)

	// OS 판별
	switch {
	case strings.Contains(lowerUA, "iphone"):
		info.OS = "iOS"
		info.DeviceType = "mobile"
	case strings.Contains(lowerUA, "ipad"):
		info.OS = "iPadOS"
		info.DeviceType = "tablet"
	case strings.Contains(lowerUA, "android"):
		info.OS = "Android"
		if strings.Contains(lowerUA, "mobile") {
			info.DeviceType = "mobile"
		} else {
			info.DeviceType = "tablet"
		}
	case strings.Contains(lowerUA, "windows"):
		info.OS = "Windows"
		info.DeviceType = "desktop"
	case strings.Contains(lowerUA, "macintosh") || strings.Contains(lowerUA, "mac os"):
		info.OS = "macOS"
		info.DeviceType = "desktop"
	case strings.Contains(lowerUA, "linux"):
		info.OS = "Linux"
		info.DeviceType = "desktop"
	case strings.Contains(lowerUA, "cros"):
		info.OS = "Chrome OS"
		info.DeviceType = "desktop"
	}

	// 브라우저 판별 (순서 중요: Edge/OPR은 Chrome보다 먼저 체크)
	switch {
	case strings.Contains(lowerUA, "edg"):
		info.Browser = "Edge"
	case strings.Contains(lowerUA, "opr") || strings.Contains(lowerUA, "opera"):
		info.Browser = "Opera"
	case strings.Contains(lowerUA, "whale"):
		info.Browser = "Whale"
	case strings.Contains(lowerUA, "samsung"):
		info.Browser = "Samsung Browser"
	case strings.Contains(lowerUA, "firefox") || strings.Contains(lowerUA, "fxios"):
		info.Browser = "Firefox"
	case strings.Contains(lowerUA, "crios"):
		info.Browser = "Chrome"
	case strings.Contains(lowerUA, "chrome"):
		info.Browser = "Chrome"
	case strings.Contains(lowerUA, "safari"):
		info.Browser = "Safari"
	}

	// 기기 이름 조합
	info.DeviceName = info.Browser + " / " + info.OS

	return info
}
