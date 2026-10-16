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
		query := fmt.Sprintf(`WITH chapter_units AS (
			SELECT v.series_id, c.id AS chapter_id, c.has_audio,
				CASE WHEN c.duration > 0 THEN c.duration
					WHEN c.page_count > 0 THEN c.page_count
					WHEN c.total_positions > 0 THEN c.total_positions ELSE 0 END AS unit_total
			FROM chapters c JOIN volumes v ON c.volume_id = v.id
			WHERE v.series_id IN (%s)
		), completed_units AS (
			SELECT cu.series_id, SUM(cu.unit_total) AS value
			FROM chapter_units cu JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id
			WHERE cc.user_id = ? GROUP BY cu.series_id
		), inprogress_units AS (
			SELECT cu.series_id, SUM(cu.unit_total * (
				CASE WHEN cu.has_audio = 1 AND COALESCE(NULLIF(rp.duration, 0), cu.unit_total) > 0 THEN
					MIN(1.0, MAX(0.0, COALESCE(rp.current_time, 0.0) / COALESCE(NULLIF(rp.duration, 0), cu.unit_total)))
					WHEN rp.current_cfi IS NOT NULL AND rp.current_cfi <> '' THEN MIN(1.0, MAX(0.0, rp.progress_percent / 100.0))
					WHEN rp.total_pages > 0 THEN MIN(1.0, MAX(0.0, CAST(rp.current_page AS REAL) / CAST(rp.total_pages AS REAL)))
					ELSE MIN(1.0, MAX(0.0, rp.progress_percent / 100.0)) END
			)) AS value
			FROM chapter_units cu
			JOIN reading_progress rp ON rp.chapter_id = cu.chapter_id AND rp.series_id = cu.series_id
			LEFT JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id AND cc.user_id = rp.user_id
			WHERE rp.user_id = ? AND cc.chapter_id IS NULL GROUP BY cu.series_id
		)
		SELECT selected.series_id, COALESCE(done.value, 0) + COALESCE(progress.value, 0)
		FROM (SELECT DISTINCT series_id FROM chapter_units) selected
		LEFT JOIN completed_units done ON done.series_id = selected.series_id
		LEFT JOIN inprogress_units progress ON progress.series_id = selected.series_id`, homePlaceholders(len(chunk)))
		args := append(homeArgs(chunk), userID, userID)
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
