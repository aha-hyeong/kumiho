package util

import (
	"fmt"
	"testing"
	"time"
)

func TestHomeThumbnailURLVersions(t *testing.T) {
	stamp := time.Date(2026, 9, 24, 1, 2, 3, 456, time.UTC)
	for _, tc := range []struct {
		name, route string
		build       func(string, time.Time, int64) string
	}{
		{"series", "series", BuildHomeSeriesThumbnailURL},
		{"volume", "volumes", BuildHomeVolumeThumbnailURL},
	} {
		t.Run(tc.name, func(t *testing.T) {
			before := tc.build("id", stamp, 0)
			if want := fmt.Sprintf("/api/v1/%s/id/thumbnail?t=db-%d-0", tc.route, stamp.UnixNano()); before != want {
				t.Fatalf("got %s want %s", before, want)
			}
			if tc.build("id", stamp, 1) == before {
				t.Error("thumbnail version must invalidate the URL")
			}
			if tc.build("id", stamp.Add(time.Nanosecond), 0) == before {
				t.Error("sub-second timestamp change must invalidate the URL")
			}
			if tc.build("id", stamp.In(time.FixedZone("KST", 9*60*60)), 0) != before {
				t.Error("same instant must have a stable URL across timezones")
			}
		})
	}
}
