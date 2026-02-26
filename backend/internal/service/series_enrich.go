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
	for i := range seriesList {
		svc.EnrichSingle(&seriesList[i], userID)
	}
}

// EnrichSingle 단일 시리즈 데이터 보정 (썸네일 URL, 진행도 계산)
func (svc *SeriesEnrichService) EnrichSingle(s *model.Series, userID string) {
	// 썸네일 URL 설정
	if s.ThumbnailPath != nil && *s.ThumbnailPath != "" {
		url := fmt.Sprintf("/api/v1/series/%s/thumbnail?t=%d", s.ID, s.UpdatedAt.Unix())
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
				url := fmt.Sprintf("/api/v1/volumes/%s/thumbnail?t=%d", vol.ID, vol.UpdatedAt.Unix())
				s.ThumbnailURL = &url
			}
		}
	}

	// 진행도 계산
	totalPages, err := svc.seriesRepo.GetTotalPages(nil, s.ID)
	if err != nil {
		log.Printf("failed to get total pages for series %s: %v", s.ID, err)
	} else {
		s.TotalPageCount = totalPages
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
		readPages, err := svc.seriesRepo.GetReadPages(nil, userID, s.ID)
		if err != nil {
			log.Printf("failed to get read pages for user %s, series %s: %v", userID, s.ID, err)
		} else {
			s.ReadPageCount = readPages
		}
	}
}
