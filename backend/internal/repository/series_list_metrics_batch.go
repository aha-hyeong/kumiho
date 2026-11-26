package repository

import (
	"fmt"
	"math"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

// SeriesListMetrics 라이브러리 목록 카드에 필요한 시리즈별 집계값.
type SeriesListMetrics struct {
	VolumeCount  int
	ChapterCount int
	TotalUnits   int
}

// GetListMetricsBatch 라이브러리 목록용 권수·화수·총 진행 단위를 묶음 단위로 조회한다.
// 쿼리 수는 시리즈 수가 아니라 묶음 수에 비례하고, 집계식은 각각
// VolumeRepository.CountBySeriesID, ChapterRepository.CountBySeriesID,
// GetTotalProgressUnits와 같다. 볼륨이나 챕터가 없는 시리즈는 0으로 채운다.
func (r *SeriesRepository) GetListMetricsBatch(q database.Queryer, ids []string) (map[string]SeriesListMetrics, error) {
	result := make(map[string]SeriesListMetrics, len(ids))
	for _, id := range ids {
		result[id] = SeriesListMetrics{}
	}
	if len(ids) == 0 {
		return result, nil
	}
	q = database.GetQueryer(q)
	const batchSize = 400
	for start := 0; start < len(ids); start += batchSize {
		end := start + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		placeholders := homePlaceholders(len(chunk))
		args := homeArgs(chunk)

		rows, err := q.Query(fmt.Sprintf(
			`SELECT series_id, COUNT(*) FROM volumes WHERE series_id IN (%s) GROUP BY series_id`,
			placeholders,
		), args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var count int
			if err = rows.Scan(&id, &count); err != nil {
				rows.Close()
				return nil, err
			}
			m := result[id]
			m.VolumeCount = count
			result[id] = m
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()

		rows, err = q.Query(fmt.Sprintf(
			`SELECT v.series_id, COUNT(*), COALESCE(SUM(
				CASE
					WHEN c.duration > 0 THEN c.duration
					WHEN c.page_count > 0 THEN c.page_count
					WHEN c.total_positions > 0 THEN c.total_positions
					ELSE 0
				END
			), 0)
			FROM chapters c
			JOIN volumes v ON c.volume_id = v.id
			WHERE v.series_id IN (%s)
			GROUP BY v.series_id`,
			placeholders,
		), args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var count int
			var total float64
			if err = rows.Scan(&id, &count, &total); err != nil {
				rows.Close()
				return nil, err
			}
			m := result[id]
			m.ChapterCount = count
			if !math.IsNaN(total) && !math.IsInf(total, 0) && total >= 0 {
				m.TotalUnits = int(math.Round(total))
			}
			result[id] = m
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return result, nil
}
