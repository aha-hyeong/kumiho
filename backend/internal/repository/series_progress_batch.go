package repository

import (
	"fmt"
	"math"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

// GetReadProgressUnitsBatch applies the scalar progress calculation to bounded
// groups of series. Missing series or chapters have zero read units.
func (r *SeriesRepository) GetReadProgressUnitsBatch(q database.Queryer, userID string, ids []string) (map[string]int, error) {
	result := make(map[string]int, len(ids))
	for _, id := range ids {
		result[id] = 0
	}
	q = database.GetQueryer(q)
	const batchSize = 400
	for start := 0; start < len(ids); start += batchSize {
		end := start + batchSize
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		// CROSS JOIN keeps the current user's records ahead of the chapter and volume lookups.
		query := fmt.Sprintf(`WITH progress_chapters AS (
			SELECT v.series_id, c.has_audio, rp.duration, rp.current_time, rp.current_cfi,
				rp.progress_percent, rp.total_pages, rp.current_page,
				CASE WHEN c.duration > 0 THEN c.duration
					WHEN c.page_count > 0 THEN c.page_count
					WHEN c.total_positions > 0 THEN c.total_positions ELSE 0 END AS unit_total
			FROM reading_progress rp INDEXED BY idx_progress_user
			CROSS JOIN chapters c ON c.id = rp.chapter_id
			CROSS JOIN volumes v ON v.id = c.volume_id AND v.series_id = rp.series_id
			WHERE rp.user_id = ? AND rp.series_id IN (%[1]s)
				AND NOT EXISTS (
					SELECT 1 FROM chapter_completions cc WHERE cc.user_id = rp.user_id AND cc.chapter_id = rp.chapter_id
				)
		), series_units AS (
			SELECT v.series_id, SUM(
				CASE WHEN c.duration > 0 THEN c.duration
					WHEN c.page_count > 0 THEN c.page_count
					WHEN c.total_positions > 0 THEN c.total_positions ELSE 0 END
			) AS value
			FROM chapter_completions cc
			CROSS JOIN chapters c ON c.id = cc.chapter_id
			CROSS JOIN volumes v ON v.id = c.volume_id
			WHERE cc.user_id = ? AND v.series_id IN (%[1]s)
			GROUP BY v.series_id
			UNION ALL
			SELECT pc.series_id, SUM(pc.unit_total * (
				CASE WHEN pc.has_audio = 1 AND COALESCE(NULLIF(pc.duration, 0), pc.unit_total) > 0 THEN
					MIN(1.0, MAX(0.0, COALESCE(pc.current_time, 0.0) / COALESCE(NULLIF(pc.duration, 0), pc.unit_total)))
					WHEN pc.current_cfi IS NOT NULL AND pc.current_cfi <> '' THEN MIN(1.0, MAX(0.0, pc.progress_percent / 100.0))
					WHEN pc.total_pages > 0 THEN MIN(1.0, MAX(0.0, CAST(pc.current_page AS REAL) / CAST(pc.total_pages AS REAL)))
					ELSE MIN(1.0, MAX(0.0, pc.progress_percent / 100.0)) END
			)) AS value
			FROM progress_chapters pc
			GROUP BY pc.series_id
		)
		SELECT series_id, COALESCE(SUM(value), 0)
		FROM series_units GROUP BY series_id`, homePlaceholders(len(chunk)))
		seriesArgs := homeArgs(chunk)
		args := append(make([]any, 0, 2*(len(chunk)+1)), userID)
		args = append(args, seriesArgs...)
		args = append(args, userID)
		args = append(args, seriesArgs...)
		rows, err := q.Query(query, args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var read float64
			if err := rows.Scan(&id, &read); err != nil {
				rows.Close()
				return nil, err
			}
			if read < 0 {
				read = 0
			}
			result[id] = int(math.Round(read))
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return result, nil
}
