package service

import (
	"fmt"
	"log"
	"os"
	"strings"

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

// EnrichList 시리즈 목록 전체를 보정
func (svc *SeriesEnrichService) EnrichList(seriesList []model.Series, userID string) {
	displayUnits, err := svc.prefetchDisplayUnits(seriesList)
	if err != nil {
		log.Printf("prefetchDisplayUnits failed, falling back to per-series query: %v", err)
	}
	usePrefetchedDisplayUnit := err == nil
	for i := range seriesList {
		svc.enrichSingle(&seriesList[i], userID, displayUnits, usePrefetchedDisplayUnit)
	}
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
		chunk, err := svc.seriesRepo.GetFirstPageIDsBatch(nil, missingCovers[start:end])
		if err != nil {
			return err
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
	svc.enrichSingle(s, userID, nil, false)
}

func (svc *SeriesEnrichService) enrichSingle(s *model.Series, userID string, displayUnits map[string]string, usePrefetchedDisplayUnit bool) {
	// 썸네일 URL 설정
	if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
		url := util.BuildSeriesThumbnailURL(s.ID, s.ThumbnailPath, s.UpdatedAt)
		s.ThumbnailURL = &url
	} else {
		pageID, err := svc.seriesRepo.GetFirstPageID(nil, s.ID)
		if err == nil && pageID != "" {
			url := fmt.Sprintf("/api/v1/pages/%s/image?width=400", pageID)
			s.ThumbnailURL = &url
		} else {
			// 페이지가 없는 경우 (PDF 등) 첫 번째 볼륨의 썸네일을 시도
			vol, vErr := svc.volumeRepo.GetFirstVolume(nil, s.ID)
			if vErr == nil && vol != nil && vol.ThumbnailPath != nil && *vol.ThumbnailPath != "" {
				url := util.BuildVolumeThumbnailURL(vol.ID, vol.ThumbnailPath, vol.UpdatedAt)
				s.ThumbnailURL = &url
			}
		}
	}

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
	if usePrefetchedDisplayUnit {
		s.DisplayUnit = displayUnits[s.ID]
	} else {
		svc.assignDisplayUnit(s)
	}

	// PDF 또는 누락된 페이지 정보 보정 (Data Repair/Fallback)
	// 스캔 시점에 페이지 수가 추출되지 않은 PDF 등을 위해 온더플라이로 보정합니다.
	if s.TotalPageCount <= 0 {
		chapters, err := svc.chapterRepo.FindBySeriesID(nil, s.ID)
		if err == nil && len(chapters) > 0 {
			total := 0
			for _, c := range chapters {
				if c.TotalPositions > 0 {
					total += c.TotalPositions
				} else if c.PageCount > 0 {
					total += c.PageCount
				} else if c.PageCount == 0 && strings.HasSuffix(strings.ToLower(c.Path), ".pdf") {
					if _, err := os.Stat(c.Path); err == nil {
						pc, pageErr := util.GetPdfPageCount(c.Path)
						if pageErr != nil {
							// PDF 페이지 수 추출 실패는 sentinel(-1)로 기록해
							// 0(실제 빈 문서 가능)과 구분되도록 한다.
							_ = svc.chapterRepo.UpdatePageCount(nil, c.ID, -1)
							continue
						}
						if pc > 0 {
							_ = svc.chapterRepo.UpdatePageCount(nil, c.ID, pc)
							total += pc
						} else {
							_ = svc.chapterRepo.UpdatePageCount(nil, c.ID, -1)
						}
					}
				}
			}
			s.TotalPageCount = total
		}
	}

	if userID != "" {
		readPages, err := svc.seriesRepo.GetReadProgressUnits(nil, userID, s.ID)
		if err != nil {
			log.Printf("failed to get read pages for user %s, series %s: %v", userID, s.ID, err)
		} else {
			s.ReadPageCount = readPages
		}
	}
}

func (svc *SeriesEnrichService) prefetchDisplayUnits(seriesList []model.Series) (map[string]string, error) {
	if len(seriesList) == 0 {
		return map[string]string{}, nil
	}

	seriesIDs := make([]string, 0, len(seriesList))
	for _, series := range seriesList {
		seriesIDs = append(seriesIDs, series.ID)
	}

	return svc.volumeRepo.FindRootDisplayUnitsBySeriesIDs(nil, seriesIDs)
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
