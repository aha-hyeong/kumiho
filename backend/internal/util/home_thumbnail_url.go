package util

import (
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

// BuildHomeSeriesThumbnailURL is pure: Home must not stat a thumbnail while
// rendering JSON. The DB version changes even for same-path cover replacements.
// Keep the db- prefix separate from the legacy filesystem-mtime cache keys.
func BuildHomeSeriesThumbnailURL(seriesID string, updatedAt time.Time, version int64) string {
	return fmt.Sprintf("/api/v1/series/%s/thumbnail?t=db-%d-%d", seriesID, updatedAt.UnixNano(), version)
}

// BuildHomeVolumeThumbnailURL uses the saved volume cover version.
func BuildHomeVolumeThumbnailURL(volumeID string, updatedAt time.Time, version int64) string {
	return fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=db-%d-%d", volumeID, updatedAt.UnixNano(), version)
}

// SeriesCardThumbnailURL leaves automatic cover selection to the image request.
func SeriesCardThumbnailURL(s *model.Series) string {
	url := BuildHomeSeriesThumbnailURL(s.ID, s.UpdatedAt, s.ThumbnailVersion)
	if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
		return url
	}
	return fmt.Sprintf("%s-%d&width=400", url, s.LastContentUpdatedAt.UnixNano())
}

// RecentVolumeThumbnailURL also versions the series cover used when the current
// volume has no page. Reading progress timestamps must not invalidate an image.
func RecentVolumeThumbnailURL(v *model.Volume, s *model.Series) string {
	url := BuildHomeVolumeThumbnailURL(v.ID, v.UpdatedAt, v.ThumbnailVersion)
	if v.ThumbnailPath != nil && *v.ThumbnailPath != "" {
		return url
	}
	return fmt.Sprintf("%s-%d-%d-%d&width=400&fallback=series", url,
		s.UpdatedAt.UnixNano(), s.ThumbnailVersion, s.LastContentUpdatedAt.UnixNano())
}
