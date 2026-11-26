package service

import (
	"fmt"
	"log"

	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/aha-hyeong/kumiho/backend/internal/repository"
	"github.com/aha-hyeong/kumiho/backend/internal/util"
)

// SeriesEnrichService 시리즈 데이터 보정 (썸네일 URL, 진행도 계산) 공통 서비스
type SeriesEnrichService struct {
	seriesRepo  *repository.SeriesRepository
	chapterRepo *repository.ChapterRepository
	volumeRepo  *repository.VolumeRepository
}

func NewSeriesEnrichService(
	seriesRepo *repository.SeriesRepository,
	chapterRepo *repository.ChapterRepository,
	volumeRepo *repository.VolumeRepository,
) *SeriesEnrichService {
	return &SeriesEnrichService{
		seriesRepo:  seriesRepo,
		chapterRepo: chapterRepo,
		volumeRepo:  volumeRepo,
	}
}

// listPrefetch 목록 보정에서 미리 묶음 조회한 값. has* 플래그가 false면 해당 값은
// 시리즈별 단건 쿼리로 대신 계산한다.
type listPrefetch struct {
	displayUnits    map[string]string
	hasDisplayUnits bool
	readProgress    map[string]int
	metrics         map[string]repository.SeriesListMetrics
	hasMetrics      bool
	thumbnails      map[string]string
	hasThumbnails   bool
}

// EnrichList 시리즈 목록 전체를 보정
// 큰 라이브러리에서도 쿼리 수가 시리즈 수에 비례하지 않도록 집계·썸네일·읽은 분량을
// 묶음으로 조회하고, 묶음 조회가 실패한 항목만 시리즈별 쿼리로 되돌아간다.
func (svc *SeriesEnrichService) EnrichList(seriesList []model.Series, userID string) {
	if len(seriesList) == 0 {
		return
	}
	ids := make([]string, len(seriesList))
	for i := range seriesList {
		ids[i] = seriesList[i].ID
	}

	var prefetch listPrefetch
	var err error
	prefetch.displayUnits, err = svc.volumeRepo.FindRootDisplayUnitsBySeriesIDs(nil, ids)
	if err != nil {
		log.Printf("batch display units failed, falling back to per-series query: %v", err)
	}
	prefetch.hasDisplayUnits = err == nil

	prefetch.metrics, err = svc.seriesRepo.GetListMetricsBatch(nil, ids)
	if err != nil {
		log.Printf("batch list metrics failed, falling back to per-series query: %v", err)
	}
	prefetch.hasMetrics = err == nil

	prefetch.thumbnails, err = svc.prefetchListThumbnails(seriesList)
	if err != nil {
		log.Printf("batch list thumbnails failed, falling back to per-series query: %v", err)
	}
	prefetch.hasThumbnails = err == nil

	if userID != "" {
		var readErr error
		prefetch.readProgress, readErr = svc.seriesRepo.GetReadProgressUnitsBatch(nil, userID, ids)
		if readErr != nil {
			log.Printf("batch read progress failed, falling back to per-series query: %v", readErr)
		}
	}
	for i := range seriesList {
		svc.enrichSingle(&seriesList[i], userID, &prefetch)
	}
}

// prefetchListThumbnails 커버가 없는 시리즈의 대체 썸네일 URL을 묶음으로 찾는다.
// 첫 페이지를 우선하고, 페이지가 없으면(PDF 등) 첫 볼륨 썸네일을 쓴다.
// 결과에 없는 시리즈는 대체 썸네일이 없다는 뜻이다.
func (svc *SeriesEnrichService) prefetchListThumbnails(seriesList []model.Series) (map[string]string, error) {
	missingCovers := make([]string, 0)
	for _, s := range seriesList {
		if s.ThumbnailPath == nil || *s.ThumbnailPath == "" {
			missingCovers = append(missingCovers, s.ID)
		}
	}
	urls := make(map[string]string, len(missingCovers))
	if len(missingCovers) == 0 {
		return urls, nil
	}
	const batchSize = 400
	for start := 0; start < len(missingCovers); start += batchSize {
		end := start + batchSize
		if end > len(missingCovers) {
			end = len(missingCovers)
		}
		pages, err := svc.seriesRepo.GetFirstPageIDsBatch(nil, missingCovers[start:end])
		if err != nil {
			return nil, err
		}
		for id, pageID := range pages {
			if pageID != "" {
				urls[id] = fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			}
		}
	}
	withoutPages := make([]string, 0, len(missingCovers))
	for _, id := range missingCovers {
		if _, ok := urls[id]; !ok {
			withoutPages = append(withoutPages, id)
		}
	}
	volumes, err := svc.seriesRepo.GetHomeFirstVolumeThumbnails(nil, withoutPages)
	if err != nil {
		return nil, err
	}
	for id, volume := range volumes {
		urls[id] = util.BuildHomeVolumeThumbnailURL(volume.ID, volume.UpdatedAt, volume.Version)
	}
	return urls, nil
}

// EnrichHomeList uses only bounded DB-backed batch lookups and skips PDF repair.
func (svc *SeriesEnrichService) EnrichHomeList(seriesList []model.Series, userID string) error {
	if len(seriesList) == 0 {
		return nil
	}
	ids := make([]string, 0, len(seriesList))
	missingCovers := make([]string, 0, len(seriesList))
	for _, s := range seriesList {
		ids = append(ids, s.ID)
		if s.ThumbnailPath == nil || *s.ThumbnailPath == "" {
			missingCovers = append(missingCovers, s.ID)
		}
	}
	metrics, err := svc.seriesRepo.GetHomeMetrics(nil, userID, ids)
	if err != nil {
		return err
	}
	pages := make(map[string]string)
	for start := 0; start < len(missingCovers); start += 400 {
		end := start + 400
		if end > len(missingCovers) {
			end = len(missingCovers)
		}
		chunk, pageErr := svc.seriesRepo.GetFirstPageIDsBatch(nil, missingCovers[start:end])
		if pageErr != nil {
			return pageErr
		}
		for id, page := range chunk {
			pages[id] = page
		}
	}
	volumeIDs := make([]string, 0, len(missingCovers))
	for _, id := range missingCovers {
		if pages[id] == "" {
			volumeIDs = append(volumeIDs, id)
		}
	}
	volumes, err := svc.seriesRepo.GetHomeFirstVolumeThumbnails(nil, volumeIDs)
	if err != nil {
		return err
	}
	for i := range seriesList {
		s := &seriesList[i]
		m := metrics[s.ID]
		s.TotalPageCount, s.ReadPageCount = m.TotalPageCount, m.ReadPageCount
		s.VolumeCount, s.ChapterCount, s.DisplayUnit = m.VolumeCount, m.ChapterCount, m.DisplayUnit
		if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
			url := util.BuildHomeSeriesThumbnailURL(s.ID, s.UpdatedAt, s.ThumbnailVersion)
			s.ThumbnailURL = &url
		} else if page := pages[s.ID]; page != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", page)
			s.ThumbnailURL = &url
		} else if volume, ok := volumes[s.ID]; ok {
			url := util.BuildHomeVolumeThumbnailURL(volume.ID, volume.UpdatedAt, volume.Version)
			s.ThumbnailURL = &url
		}
	}
	return nil
}

// EnrichSingle 단일 시리즈 데이터 보정 (썸네일 URL, 진행도 계산)
func (svc *SeriesEnrichService) EnrichSingle(s *model.Series, userID string) {
	svc.enrichSingle(s, userID, &listPrefetch{})
}

func (svc *SeriesEnrichService) enrichSingle(s *model.Series, userID string, prefetch *listPrefetch) {
	// 썸네일 URL 설정
	if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
		url := util.BuildHomeSeriesThumbnailURL(s.ID, s.UpdatedAt, s.ThumbnailVersion)
		s.ThumbnailURL = &url
	} else if prefetch.hasThumbnails {
		if url, ok := prefetch.thumbnails[s.ID]; ok {
			s.ThumbnailURL = &url
		}
	} else {
		pageID, err := svc.seriesRepo.GetFirstPageID(nil, s.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			s.ThumbnailURL = &url
		} else {
			// 페이지가 없는 경우 (PDF 등) 첫 번째 볼륨의 썸네일을 시도
			vol, vErr := svc.volumeRepo.GetFirstVolume(nil, s.ID)
			if vErr == nil && vol != nil && vol.ThumbnailPath != nil && *vol.ThumbnailPath != "" {
				url := util.BuildHomeVolumeThumbnailURL(vol.ID, vol.UpdatedAt, vol.ThumbnailVersion)
				s.ThumbnailURL = &url
			}
		}
	}

	if prefetch.hasMetrics {
		m := prefetch.metrics[s.ID]
		s.TotalPageCount = m.TotalUnits
		s.VolumeCount = m.VolumeCount
		s.ChapterCount = m.ChapterCount
	} else {
		// 진행도 계산
		totalPages, err := svc.seriesRepo.GetTotalProgressUnits(nil, s.ID)
		if err != nil {
			log.Printf("failed to get total pages for series %s: %v", s.ID, err)
		} else {
			s.TotalPageCount = totalPages
		}

		// 권수 및 챕터 수 보정
		if volCount, err := svc.volumeRepo.CountBySeriesID(nil, s.ID); err == nil {
			s.VolumeCount = volCount
		}
		if chapCount, err := svc.chapterRepo.CountBySeriesID(nil, s.ID); err == nil {
			s.ChapterCount = chapCount
		}
	}
	if prefetch.hasDisplayUnits {
		s.DisplayUnit = prefetch.displayUnits[s.ID]
	} else {
		svc.assignDisplayUnit(s)
	}

	if userID != "" {
		if readPages, ok := prefetch.readProgress[s.ID]; ok {
			s.ReadPageCount = readPages
		} else {
			readPages, err := svc.seriesRepo.GetReadProgressUnits(nil, userID, s.ID)
			if err != nil {
				log.Printf("failed to get read pages for user %s, series %s: %v", userID, s.ID, err)
			} else {
				s.ReadPageCount = readPages
			}
		}
	}
}

func (svc *SeriesEnrichService) assignDisplayUnit(s *model.Series) {
	if s == nil {
		return
	}

	rootVolumes, err := svc.volumeRepo.FindRootVolumesBySeriesID(nil, s.ID)
	if err != nil || len(rootVolumes) == 0 {
		s.DisplayUnit = ""
		return
	}

	allChapterRoots := true
	for _, volume := range rootVolumes {
		if volume.Unit != "chapter" {
			allChapterRoots = false
			break
		}
	}

	if allChapterRoots {
		s.DisplayUnit = "chapter"
		return
	}

	s.DisplayUnit = "volume"
}
