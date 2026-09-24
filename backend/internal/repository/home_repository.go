package repository

import (
	"database/sql"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
)

// HomeMetrics contains DB-only card aggregates. Missing chapters/volumes remain zero.
type HomeMetrics struct {
	TotalPageCount int
	ReadPageCount  int
	VolumeCount    int
	ChapterCount   int
	DisplayUnit    string
}

func homePlaceholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }
func homeArgs(ids []string) []any {
	args := make([]any, len(ids))
	for i, id := range ids {
		args[i] = id
	}
	return args
}

// FindHomeRecentIDs filters before LIMIT, including the library ACL for non-masters.
func (r *SeriesRepository) FindHomeRecentIDs(q database.Queryer, cutoff time.Time, limit int, allowedIDs []string, master bool) ([]string, error) {
	if !master && len(allowedIDs) == 0 {
		return []string{}, nil
	}
	if limit <= 0 || limit > 30 {
		limit = 30
	}
	q = database.GetQueryer(q)
	query := `SELECT s.id FROM series s JOIN libraries l ON l.id=s.library_id
 WHERE l.type='LOCAL' AND julianday(COALESCE(s.last_content_updated_at,s.updated_at))>=julianday(?)`
	args := []any{cutoff}
	if !master {
		query += ` AND s.library_id IN (` + homePlaceholders(len(allowedIDs)) + `)`
		args = append(args, homeArgs(allowedIDs)...)
	}
	query += ` ORDER BY julianday(COALESCE(s.last_content_updated_at,s.updated_at)) DESC,s.id LIMIT ?`
	args = append(args, limit)
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// FindHomeLikedIDs limits Home's bookmark strip without changing the full
// system-likes library listing. Apply access control before the limit.
func (r *SeriesRepository) FindHomeLikedIDs(q database.Queryer, userID string, allowedIDs []string, master bool) ([]string, error) {
	if !master && len(allowedIDs) == 0 {
		return []string{}, nil
	}
	q = database.GetQueryer(q)
	query := `SELECT s.id FROM user_bookmarks ub JOIN series s ON s.id=ub.series_id WHERE ub.user_id=?`
	args := []any{userID}
	if !master {
		query += ` AND s.library_id IN (` + homePlaceholders(len(allowedIDs)) + `)`
		args = append(args, homeArgs(allowedIDs)...)
	}
	query += ` ORDER BY s.title,s.id LIMIT 30`
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// GetHomeMetrics reads selected series only; the number of queries is bounded by chunks,
// not by the number of cards. The progress expressions mirror GetReadProgressUnits.
func (r *SeriesRepository) GetHomeMetrics(q database.Queryer, userID string, ids []string) (map[string]HomeMetrics, error) {
	result := make(map[string]HomeMetrics, len(ids))
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
		rows, err := q.Query(fmt.Sprintf(`SELECT series_id,COUNT(*),
   CASE WHEN SUM(CASE WHEN parent_id IS NULL AND COALESCE(unit,'volume')!='chapter' THEN 1 ELSE 0 END)>0 THEN 'volume'
        WHEN SUM(CASE WHEN parent_id IS NULL THEN 1 ELSE 0 END)>0 THEN 'chapter' ELSE '' END
   FROM volumes WHERE series_id IN (%s) GROUP BY series_id`, placeholders), args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id, unit string
			var count int
			if err = rows.Scan(&id, &count, &unit); err != nil {
				rows.Close()
				return nil, err
			}
			m := result[id]
			m.VolumeCount = count
			m.DisplayUnit = unit
			result[id] = m
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()

		chapterQuery := fmt.Sprintf(`SELECT v.series_id,COUNT(*),
   COALESCE(SUM(CASE WHEN c.duration>0 THEN c.duration WHEN c.page_count>0 THEN c.page_count WHEN c.total_positions>0 THEN c.total_positions ELSE 0 END),0),
   COALESCE(SUM(CASE WHEN cc.chapter_id IS NOT NULL THEN
     CASE WHEN c.duration>0 THEN c.duration WHEN c.page_count>0 THEN c.page_count WHEN c.total_positions>0 THEN c.total_positions ELSE 0 END
    WHEN rp.chapter_id IS NOT NULL THEN
     (CASE WHEN c.duration>0 THEN c.duration WHEN c.page_count>0 THEN c.page_count WHEN c.total_positions>0 THEN c.total_positions ELSE 0 END)
     * (CASE WHEN c.has_audio=1 AND COALESCE(NULLIF(rp.duration,0),CASE WHEN c.duration>0 THEN c.duration WHEN c.page_count>0 THEN c.page_count WHEN c.total_positions>0 THEN c.total_positions ELSE 0 END)>0 THEN
          MIN(1.0,MAX(0.0,COALESCE(rp.current_time,0.0)/COALESCE(NULLIF(rp.duration,0),CASE WHEN c.duration>0 THEN c.duration WHEN c.page_count>0 THEN c.page_count WHEN c.total_positions>0 THEN c.total_positions ELSE 0 END)))
       WHEN rp.current_cfi IS NOT NULL AND rp.current_cfi<>'' THEN MIN(1.0,MAX(0.0,rp.progress_percent/100.0))
       WHEN rp.total_pages>0 THEN MIN(1.0,MAX(0.0,CAST(rp.current_page AS REAL)/CAST(rp.total_pages AS REAL)))
       ELSE MIN(1.0,MAX(0.0,rp.progress_percent/100.0)) END)
    ELSE 0 END),0)
   FROM volumes v JOIN chapters c ON c.volume_id=v.id
   LEFT JOIN chapter_completions cc ON cc.chapter_id=c.id AND cc.user_id=?
   LEFT JOIN reading_progress rp ON rp.chapter_id=c.id AND rp.user_id=? AND rp.series_id=v.series_id
   WHERE v.series_id IN (%s) GROUP BY v.series_id`, placeholders)
		queryArgs := append([]any{userID, userID}, args...)
		rows, err = q.Query(chapterQuery, queryArgs...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var count int
			var total, read float64
			if err = rows.Scan(&id, &count, &total, &read); err != nil {
				rows.Close()
				return nil, err
			}
			m := result[id]
			m.ChapterCount = count
			if !math.IsNaN(total) && !math.IsInf(total, 0) && total >= 0 {
				m.TotalPageCount = int(math.Round(total))
			}
			if !math.IsNaN(read) && !math.IsInf(read, 0) && read >= 0 {
				m.ReadPageCount = int(math.Round(read))
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

// HomeVolumeThumbnail is used only when a series has neither a cover nor a page.
type HomeVolumeThumbnail struct {
	ID        string
	Path      string
	UpdatedAt time.Time
	Version   int64
}

func (r *SeriesRepository) GetHomeFirstVolumeThumbnails(q database.Queryer, ids []string) (map[string]HomeVolumeThumbnail, error) {
	result := map[string]HomeVolumeThumbnail{}
	if len(ids) == 0 {
		return result, nil
	}
	q = database.GetQueryer(q)
	for start := 0; start < len(ids); start += 400 {
		end := start + 400
		if end > len(ids) {
			end = len(ids)
		}
		chunk := ids[start:end]
		rows, err := q.Query(fmt.Sprintf(`SELECT series_id,id,thumbnail_path,updated_at,thumbnail_version FROM (
    SELECT series_id,id,thumbnail_path,updated_at,thumbnail_version,ROW_NUMBER() OVER (PARTITION BY series_id ORDER BY volume_number,id) AS rn
    FROM volumes WHERE series_id IN (%s)) WHERE rn=1 AND thumbnail_path IS NOT NULL AND thumbnail_path<>''`, homePlaceholders(len(chunk))), homeArgs(chunk)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var id string
			var v HomeVolumeThumbnail
			var path sql.NullString
			if err = rows.Scan(&id, &v.ID, &path, &v.UpdatedAt, &v.Version); err != nil {
				rows.Close()
				return nil, err
			}
			v.Path = path.String
			result[id] = v
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	return result, nil
}
