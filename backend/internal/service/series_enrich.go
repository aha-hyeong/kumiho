package service

import (
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
}

// EnrichList 시리즈 목록 전체를 보정
// 큰 라이브러리에서도 쿼리 수가 시리즈 수에 비례하지 않도록 집계·읽은 분량을
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

// EnrichHomeList uses only bounded DB-backed batch lookups and skips PDF repair.
func (svc *SeriesEnrichService) EnrichHomeList(seriesList []model.Series, userID string) error {
	if len(seriesList) == 0 {
		return nil
	}
	ids := make([]string, 0, len(seriesList))
	for _, s := range seriesList {
		ids = append(ids, s.ID)
	}
	metrics, err := svc.seriesRepo.GetHomeMetrics(nil, userID, ids)
	if err != nil {
		return err
	}
	for i := range seriesList {
		s := &seriesList[i]
		m := metrics[s.ID]
		s.TotalPageCount, s.ReadPageCount = m.TotalPageCount, m.ReadPageCount
		s.VolumeCount, s.ChapterCount, s.DisplayUnit = m.VolumeCount, m.ChapterCount, m.DisplayUnit
		url := util.SeriesCardThumbnailURL(s)
		s.ThumbnailURL = &url
	}
	return nil
}

// EnrichSingle 단일 시리즈 데이터 보정 (썸네일 URL, 진행도 계산)
func (svc *SeriesEnrichService) EnrichSingle(s *model.Series, userID string) {
	svc.enrichSingle(s, userID, &listPrefetch{})
}

func (svc *SeriesEnrichService) enrichSingle(s *model.Series, userID string, prefetch *listPrefetch) {
	url := util.SeriesCardThumbnailURL(s)
	s.ThumbnailURL = &url

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
