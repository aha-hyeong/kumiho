package handler

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"
)

// thumbnailResizeCache stores one entry per source, archive member and width.
// Source metadata is checked at most once per second per handler and source.
// External replacements can therefore serve an old resize for up to one second.
type thumbnailResizeCache struct {
	flight     singleflight.Group
	statFlight singleflight.Group
	pruneOnce  sync.Once
	metadataMu sync.Mutex
	metadata   map[string]thumbnailSourceMetadata
}

type thumbnailSourceMetadata struct {
	size      int64
	mtime     int64
	checkedAt time.Time
}

func (cache *thumbnailResizeCache) sourceMetadata(source string) (thumbnailSourceMetadata, error) {
	fresh := func() (thumbnailSourceMetadata, bool) {
		cache.metadataMu.Lock()
		defer cache.metadataMu.Unlock()
		entry, ok := cache.metadata[source]
		return entry, ok && time.Since(entry.checkedAt) < time.Second
	}
	if entry, ok := fresh(); ok {
		return entry, nil
	}
	result, err, _ := cache.statFlight.Do(source, func() (any, error) {
		if entry, ok := fresh(); ok {
			return entry, nil
		}
		info, err := os.Stat(source)
		if err != nil {
			return nil, err
		}
		entry := thumbnailSourceMetadata{info.Size(), info.ModTime().UnixNano(), time.Now()}
		cache.metadataMu.Lock()
		if cache.metadata == nil {
			cache.metadata = make(map[string]thumbnailSourceMetadata)
		}
		if len(cache.metadata) >= 1024 {
			clear(cache.metadata)
		}
		cache.metadata[source] = entry
		cache.metadataMu.Unlock()
		return entry, nil
	})
	if err != nil {
		return thumbnailSourceMetadata{}, err
	}
	entry, ok := result.(thumbnailSourceMetadata)
	if !ok {
		return thumbnailSourceMetadata{}, fmt.Errorf("unexpected thumbnail source metadata result")
	}
	return entry, nil
}

func (cache *thumbnailResizeCache) load(dataDir, source, member string, width int, thumbVersion int64, read func() ([]byte, string, error), resize func([]byte, int) ([]byte, error)) ([]byte, string, error) {
	if width <= 0 || width > 1200 { // ponytail: cache only card-sized widths; expand if larger repeats justify disk use.
		data, typ, err := read()
		if err != nil {
			return nil, "", err
		}
		if width <= 0 {
			return data, typ, nil
		}
		if resized, resizeErr := resize(data, width); resizeErr == nil {
			return resized, "image/jpeg", nil
		}
		return data, typ, nil
	}
	info, statErr := cache.sourceMetadata(source)
	if statErr != nil {
		return nil, "", statErr
	}
	key := sha256.Sum256([]byte(fmt.Sprintf("v1:%s:%s:%d", source, member, width)))
	version := sha256.Sum256([]byte(fmt.Sprintf("%s:%d:%d:%d", source, info.size, info.mtime, thumbVersion)))
	path := filepath.Join(dataDir, "cache", "thumbnail-resize", fmt.Sprintf("%x", key))
	cache.pruneOnce.Do(func() { go pruneThumbnailResizeCache(filepath.Dir(path)) })
	result, err, _ := cache.flight.Do(fmt.Sprintf("%x:%x", key, version), func() (any, error) {
		if cached, err := os.ReadFile(path); err == nil && len(cached) > len(version) && string(cached[:len(version)]) == string(version[:]) {
			return cached[len(version):], nil
		}
		data, typ, err := read()
		if err != nil {
			return nil, err
		}
		resized, resizeErr := resize(data, width)
		if resizeErr != nil {
			return thumbnailResult{data, typ}, nil
		}
		payload := append(version[:], resized...)
		if os.MkdirAll(filepath.Dir(path), 0o755) == nil {
			if temp, err := os.CreateTemp(filepath.Dir(path), ".resize-*"); err == nil {
				name := temp.Name()
				if _, writeErr := temp.Write(payload); writeErr == nil {
					if closeErr := temp.Close(); closeErr == nil {
						if os.Rename(name, path) != nil {
							_ = os.Remove(name)
						}
					} else {
						_ = os.Remove(name)
					}
				} else {
					_ = temp.Close()
					_ = os.Remove(name)
				}
			}
		}
		return thumbnailResult{resized, "image/jpeg"}, nil
	})
	if err != nil {
		return nil, "", err
	}
	switch value := result.(type) {
	case []byte:
		return value, "image/jpeg", nil
	case thumbnailResult:
		return value.data, value.typ, nil
	default:
		return nil, "", fmt.Errorf("unexpected thumbnail cache result")
	}
}

type thumbnailResult struct {
	data []byte
	typ  string
}

// pruneThumbnailResizeCache is an opportunistic startup cleanup for removed sources.
func pruneThumbnailResizeCache(dir string) {
	_ = filepath.WalkDir(dir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err == nil && time.Since(info.ModTime()) > 30*24*time.Hour {
			_ = os.Remove(path)
		}
		return nil
	})
}
