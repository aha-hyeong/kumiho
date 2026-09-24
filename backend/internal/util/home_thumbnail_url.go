package util

import (
	"fmt"
	"time"
)

// BuildHomeSeriesThumbnailURL is pure: Home must not stat a thumbnail while
// rendering JSON. The DB version changes even for same-path cover replacements.
// Keep the db- prefix separate from the legacy filesystem-mtime cache keys.
func BuildHomeSeriesThumbnailURL(seriesID string, updatedAt time.Time, version int64) string {
	return fmt.Sprintf("/api/v1/series/%s/thumbnail?t=db-%d-%d", seriesID, updatedAt.UnixNano(), version)
}

// BuildHomeVolumeThumbnailURL is the DB-only fallback for series without pages.
func BuildHomeVolumeThumbnailURL(volumeID string, updatedAt time.Time, version int64) string {
	return fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=db-%d-%d", volumeID, updatedAt.UnixNano(), version)
}
