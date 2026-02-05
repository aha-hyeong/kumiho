package repository

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"

	"github.com/google/uuid"
)

type ReadingProgressRepository struct{}

func NewReadingProgressRepository() *ReadingProgressRepository {
	return &ReadingProgressRepository{}
}

// Upsert 읽기 진행도 생성 또는 업데이트 (챕터별 저장)
// SQLite는 부분 인덱스(partial index)를 ON CONFLICT에서 지원하지 않으므로
// SELECT + INSERT/UPDATE 패턴을 사용
func (r *ReadingProgressRepository) Upsert(db database.Queryer, progress *model.ReadingProgress) error {
	db = database.GetQueryer(db)
	now := time.Now()
	progress.UpdatedAt = now

	if progress.ID == "" {
		progress.ID = uuid.New().String()
	}

	// chapter_id가 없으면 일반 INSERT (충돌 처리 불필요)
	if progress.ChapterID == nil {
		_, err := db.Exec(
			`INSERT INTO reading_progress 
			 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, read_time_seconds)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			progress.ID, progress.UserID, progress.SeriesID, progress.VolumeID, progress.ChapterID,
			progress.CurrentPage, progress.TotalPages, progress.ProgressPercent,
			progress.DeviceID, progress.DeviceName, progress.UpdatedAt, progress.ReadTimeSeconds,
		)
		return err
	}

	// chapter_id가 있으면 기존 레코드 확인 후 UPDATE 또는 INSERT
	var existingID string
	err := db.QueryRow(
		`SELECT id FROM reading_progress WHERE user_id = ? AND chapter_id = ?`,
		progress.UserID, *progress.ChapterID,
	).Scan(&existingID)

	if err == nil {
		// 기존 레코드가 있으면 UPDATE
		_, err = db.Exec(
			`UPDATE reading_progress SET
				series_id = ?,
				volume_id = ?,
				current_page = ?,
				total_pages = ?,
				progress_percent = ?,
				device_id = ?,
				device_name = ?,
				updated_at = ?,
				read_time_seconds = read_time_seconds + ?
			WHERE id = ?`,
			progress.SeriesID, progress.VolumeID,
			progress.CurrentPage, progress.TotalPages, progress.ProgressPercent,
			progress.DeviceID, progress.DeviceName, progress.UpdatedAt, progress.ReadTimeSeconds,
			existingID,
		)
		return err
	}

	// 기존 레코드가 없으면 INSERT
	_, err = db.Exec(
		`INSERT INTO reading_progress 
		 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at, read_time_seconds)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		progress.ID, progress.UserID, progress.SeriesID, progress.VolumeID, progress.ChapterID,
		progress.CurrentPage, progress.TotalPages, progress.ProgressPercent,
		progress.DeviceID, progress.DeviceName, progress.UpdatedAt, progress.ReadTimeSeconds,
	)
	return err
}

// FindByUserAndSeries 사용자와 시리즈의 가장 최근 진행도 조회
// 완독되지 않은 챕터를 우선하고, 타임스탬프 동일시 챕터 번호가 높은 것을 반환
func (r *ReadingProgressRepository) FindByUserAndSeries(db database.Queryer, userID, seriesID string) (*model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	var p model.ReadingProgress
	var volumeID, chapterID, deviceID, deviceName sql.NullString

	// 시리즈 내 가장 최근 읽은 챕터 진행도 반환
	// 1. 미완독(progress_percent < 100) 우선
	// 2. 가장 최근 업데이트된 것 (updated_at DESC)
	// 3. 챕터 번호가 높은 것 (c.chapter_number DESC) - 동점 시 tiebreaker
	err := db.QueryRow(
		`SELECT rp.id, rp.user_id, rp.series_id, rp.volume_id, rp.chapter_id, rp.current_page, rp.total_pages, 
		 rp.progress_percent, rp.device_id, rp.device_name, rp.updated_at
		 FROM reading_progress rp
		 LEFT JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND rp.series_id = ?
		 ORDER BY 
		   CASE WHEN rp.progress_percent < 100 THEN 0 ELSE 1 END ASC,
		   rp.updated_at DESC,
		   c.chapter_number DESC
		 LIMIT 1`,
		userID, seriesID,
	).Scan(&p.ID, &p.UserID, &p.SeriesID, &volumeID, &chapterID,
		&p.CurrentPage, &p.TotalPages, &p.ProgressPercent, &deviceID, &deviceName, &p.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if volumeID.Valid {
		p.VolumeID = &volumeID.String
	}
	if chapterID.Valid {
		p.ChapterID = &chapterID.String
	}
	if deviceID.Valid {
		p.DeviceID = &deviceID.String
	}
	if deviceName.Valid {
		p.DeviceName = &deviceName.String
	}

	return &p, nil
}

// FindByUserAndChapter 사용자와 챕터로 진행도 조회
func (r *ReadingProgressRepository) FindByUserAndChapter(db database.Queryer, userID, chapterID string) (*model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	var p model.ReadingProgress
	var volumeID, chapterIDNull, deviceID, deviceName sql.NullString

	err := db.QueryRow(
		`SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, 
		 progress_percent, device_id, device_name, updated_at
		 FROM reading_progress WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	).Scan(&p.ID, &p.UserID, &p.SeriesID, &volumeID, &chapterIDNull,
		&p.CurrentPage, &p.TotalPages, &p.ProgressPercent, &deviceID, &deviceName, &p.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if volumeID.Valid {
		p.VolumeID = &volumeID.String
	}
	if chapterIDNull.Valid {
		p.ChapterID = &chapterIDNull.String
	}
	if deviceID.Valid {
		p.DeviceID = &deviceID.String
	}
	if deviceName.Valid {
		p.DeviceName = &deviceName.String
	}

	return &p, nil
}

// DeleteByUserAndChapter 사용자와 챕터로 진행도 삭제
func (r *ReadingProgressRepository) DeleteByUserAndChapter(db database.Queryer, userID, chapterID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`DELETE FROM reading_progress WHERE user_id = ? AND chapter_id = ?`,
		userID, chapterID,
	)
	return err
}

// FindByUser 사용자의 모든 읽기 진행도 조회
func (r *ReadingProgressRepository) FindByUser(db database.Queryer, userID string) ([]model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, 
		 progress_percent, device_id, device_name, updated_at
		 FROM reading_progress WHERE user_id = ? ORDER BY updated_at DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var progressList []model.ReadingProgress
	for rows.Next() {
		var p model.ReadingProgress
		var volumeID, chapterID, deviceID, deviceName sql.NullString

		if err := rows.Scan(&p.ID, &p.UserID, &p.SeriesID, &volumeID, &chapterID,
			&p.CurrentPage, &p.TotalPages, &p.ProgressPercent, &deviceID, &deviceName, &p.UpdatedAt); err != nil {
			return nil, err
		}

		if volumeID.Valid {
			p.VolumeID = &volumeID.String
		}
		if chapterID.Valid {
			p.ChapterID = &chapterID.String
		}
		if deviceID.Valid {
			p.DeviceID = &deviceID.String
		}
		if deviceName.Valid {
			p.DeviceName = &deviceName.String
		}

		progressList = append(progressList, p)
	}

	return progressList, nil
}

// FindRecentByUser 사용자의 최근 읽기 진행도 조회 (상위 N개, 완료된 볼륨 제외)
func (r *ReadingProgressRepository) FindRecentByUser(db database.Queryer, userID string, limit int) ([]model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	// 완료된 볼륨에 속한 챕터의 진행도는 제외
	// LEFT JOIN + IS NULL 패턴으로 완료된 볼륨 필터링 (NOT EXISTS보다 대용량에서 효율적)
	rows, err := db.Query(
		`SELECT rp.id, rp.user_id, rp.series_id, rp.volume_id, rp.chapter_id, rp.current_page, 
		 rp.total_pages, rp.progress_percent, rp.device_id, rp.device_name, rp.updated_at
		 FROM reading_progress rp
		 LEFT JOIN chapters c ON rp.chapter_id = c.id
		 LEFT JOIN volume_completions vc 
		   ON vc.user_id = rp.user_id 
		   AND vc.volume_id = COALESCE(rp.volume_id, c.volume_id)
		 WHERE rp.user_id = ? 
		   AND vc.id IS NULL
		   AND rp.progress_percent < 100
		 ORDER BY rp.updated_at DESC LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var progressList []model.ReadingProgress
	for rows.Next() {
		var p model.ReadingProgress
		var volumeID, chapterID, deviceID, deviceName sql.NullString

		if err := rows.Scan(&p.ID, &p.UserID, &p.SeriesID, &volumeID, &chapterID,
			&p.CurrentPage, &p.TotalPages, &p.ProgressPercent, &deviceID, &deviceName, &p.UpdatedAt); err != nil {
			return nil, err
		}

		if volumeID.Valid {
			p.VolumeID = &volumeID.String
		}
		if chapterID.Valid {
			p.ChapterID = &chapterID.String
		}
		if deviceID.Valid {
			p.DeviceID = &deviceID.String
		}
		if deviceName.Valid {
			p.DeviceName = &deviceName.String
		}

		progressList = append(progressList, p)
	}

	return progressList, nil
}

// Delete 읽기 진행도 삭제
func (r *ReadingProgressRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM reading_progress WHERE id = ?`, id)
	return err
}

// FindByUserAndVolume 사용자와 볼륨의 모든 챕터 진행도 조회
func (r *ReadingProgressRepository) FindByUserAndVolume(db database.Queryer, userID, volumeID string) ([]model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT rp.id, rp.user_id, rp.series_id, rp.volume_id, rp.chapter_id, rp.current_page, 
		 rp.total_pages, rp.progress_percent, rp.device_id, rp.device_name, rp.updated_at
		 FROM reading_progress rp
		 LEFT JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND (rp.volume_id = ? OR c.volume_id = ?)
		 ORDER BY c.chapter_number ASC`,
		userID, volumeID, volumeID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var progressList []model.ReadingProgress
	for rows.Next() {
		var p model.ReadingProgress
		var volID, chapID, devID, devName sql.NullString

		if err := rows.Scan(&p.ID, &p.UserID, &p.SeriesID, &volID, &chapID,
			&p.CurrentPage, &p.TotalPages, &p.ProgressPercent, &devID, &devName, &p.UpdatedAt); err != nil {
			return nil, err
		}

		if volID.Valid {
			p.VolumeID = &volID.String
		}
		if chapID.Valid {
			p.ChapterID = &chapID.String
		}
		if devID.Valid {
			p.DeviceID = &devID.String
		}
		if devName.Valid {
			p.DeviceName = &devName.String
		}

		progressList = append(progressList, p)
	}

	return progressList, nil
}

// DeleteByUserAndSeries 사용자와 시리즈 ID로 진행도 삭제
func (r *ReadingProgressRepository) DeleteByUserAndSeries(db database.Queryer, userID, seriesID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(
		`DELETE FROM reading_progress WHERE user_id = ? AND series_id = ?`,
		userID, seriesID,
	)
	return err
}


// CountTotalSeriesRead 사용자가 읽기 시작한 총 시리즈 수
func (r *ReadingProgressRepository) CountTotalSeriesRead(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`
		SELECT COUNT(DISTINCT series_id) 
		FROM reading_progress 
		WHERE user_id = ?
	`, userID).Scan(&count)
	return count, err
}

// CountTotalChaptersRead 사용자가 읽은 총 챕터 수
func (r *ReadingProgressRepository) CountTotalChaptersRead(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`
		SELECT COUNT(DISTINCT chapter_id)
		FROM reading_progress
		WHERE user_id = ? AND chapter_id IS NOT NULL
	`, userID).Scan(&count)
	return count, err
}


// UpdateReadingTime 읽은 시간 누적 업데이트 (영향을 받은 행 수를 반환)
func (r *ReadingProgressRepository) UpdateReadingTime(db database.Queryer, userID, seriesID string, seconds int) (int64, error) {
	db = database.GetQueryer(db)
	result, err := db.Exec(`
		UPDATE reading_progress 
		SET read_time_seconds = read_time_seconds + ?, 
			updated_at = ?
		WHERE user_id = ? AND series_id = ?
	`, seconds, time.Now(), userID, seriesID)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

// CountTotalReadTime 사용자의 총 읽은 시간 (초 단위)
func (r *ReadingProgressRepository) CountTotalReadTime(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count sql.NullInt64
	err := db.QueryRow(`
		SELECT SUM(read_time_seconds)
		FROM reading_progress
		WHERE user_id = ?
	`, userID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return int(count.Int64), nil
}

// CountTotalPagesRead 사용자가 읽은 총 페이지 수 (완료된 챕터의 페이지 수 합산)
func (r *ReadingProgressRepository) CountTotalPagesRead(db database.Queryer, userID string) (int, error) {
	db = database.GetQueryer(db)
	var count sql.NullInt64
	// chapter_completions에서 완료된 챕터들의 페이지 수를 집계
	// reading_progress.current_page는 시리즈당 하나의 레코드만 저장되므로 부정확함
	err := db.QueryRow(`
		SELECT COALESCE(SUM(c.page_count), 0)
		FROM chapter_completions cc
		JOIN chapters c ON cc.chapter_id = c.id
		WHERE cc.user_id = ?
	`, userID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return int(count.Int64), nil
}

type DailyActivitySeries struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	ThumbnailPath string `json:"thumbnail_path"`
}

type DailyActivity struct {
	Date   string                 `json:"date"`
	Count  int                    `json:"count"`
	Series []DailyActivitySeries `json:"series,omitempty"`
}

// GetDailyActivity 최근 N일간의 활동량 (각 날짜별 읽은 시리즈 정보 포함)
func (r *ReadingProgressRepository) GetDailyActivity(db database.Queryer, userID string, days int) ([]DailyActivity, error) {
	db = database.GetQueryer(db)

	// 1. 각 날짜별 총 활동량 조회
	// 완독 기록(chapter_completions)과 현재 진행 중인 기록(reading_progress)을 합산합니다.
	// reading_progress는 아직 완독하지 않은 챕터의 경우에만 합산하여 중복을 방지합니다.
	rows, err := db.Query(`
		SELECT date, SUM(pages) as count
		FROM (
			-- 완독한 챕터들의 페이지 수
			SELECT strftime('%Y-%m-%d', cc.completed_at, 'localtime') as date, COALESCE(c.page_count, 1) as pages
			FROM chapter_completions cc
			JOIN chapters c ON cc.chapter_id = c.id
			WHERE cc.user_id = ? AND cc.completed_at >= datetime('now', ?)
			
			UNION ALL
			
			-- 현재 읽고 있는 챕터의 진행 페이지 수 (아직 완독하지 않은 경우만)
			-- 중복 카운팅 방지: 같은 날짜에 완독 기록이 있으면 제외 (위의 쿼리에서 처리됨)
			-- 또한 동일 챕터의 누적치가 아닌 '활동 시점'의 값을 가져오기 위해 updated_at 기준
			SELECT strftime('%Y-%m-%d', rp.updated_at, 'localtime') as date, COALESCE(rp.current_page, 1) as pages
			FROM reading_progress rp
			LEFT JOIN chapter_completions cc ON rp.user_id = cc.user_id AND rp.chapter_id = cc.chapter_id
			WHERE rp.user_id = ? AND rp.updated_at >= datetime('now', ?)
			  AND cc.id IS NULL
		)
		GROUP BY date
		ORDER BY date ASC
	`, userID, fmt.Sprintf("-%d days", days), userID, fmt.Sprintf("-%d days", days))

	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var activities []DailyActivity
	// dateMap stores the INDEX of the activity in the slice to avoid pointer issues during slice growth
	dateMap := make(map[string]int)
	for rows.Next() {
		var a DailyActivity
		if scanErr := rows.Scan(&a.Date, &a.Count); scanErr != nil {
			return nil, scanErr
		}
		dateMap[a.Date] = len(activities)
		activities = append(activities, a)
	}
	_ = rows.Close()

	// 2. 각 날짜별로 읽은 시리즈 정보 조회
	seriesRows, err := db.Query(`
		SELECT date, id, title, thumbnail_path
		FROM (
			SELECT strftime('%Y-%m-%d', cc.completed_at, 'localtime') as date, s.id, s.title, s.thumbnail_path
			FROM chapter_completions cc
			JOIN chapters c ON cc.chapter_id = c.id
			JOIN volumes v ON c.volume_id = v.id
			JOIN series s ON v.series_id = s.id
			WHERE cc.user_id = ? AND cc.completed_at >= datetime('now', ?)
			
			UNION ALL
			
			SELECT strftime('%Y-%m-%d', rp.updated_at, 'localtime') as date, s.id, s.title, s.thumbnail_path
			FROM reading_progress rp
			JOIN series s ON rp.series_id = s.id
			LEFT JOIN chapter_completions cc ON rp.user_id = cc.user_id AND rp.chapter_id = cc.chapter_id
			WHERE rp.user_id = ? AND rp.updated_at >= datetime('now', ?)
			  AND cc.id IS NULL
		)
		GROUP BY date, id
		ORDER BY date ASC
	`, userID, fmt.Sprintf("-%d days", days), userID, fmt.Sprintf("-%d days", days))

	if err != nil {
		return activities, nil // 활동량 정보라도 반환
	}
	defer func() { _ = seriesRows.Close() }()

	for seriesRows.Next() {
		var date, id, title string
		var thumbnailPath sql.NullString
		if err := seriesRows.Scan(&date, &id, &title, &thumbnailPath); err != nil {
			continue
		}

		if idx, ok := dateMap[date]; ok {
			sInfo := DailyActivitySeries{
				ID:    id,
				Title: title,
			}
			if thumbnailPath.Valid {
				sInfo.ThumbnailPath = thumbnailPath.String
			}
			activities[idx].Series = append(activities[idx].Series, sInfo)
		}
	}

	return activities, nil
}

type HourlyActivity struct {
	Hour  string `json:"hour"`
	Count int    `json:"count"`
}

// GetHourlyActivity 시간대별 활동량 (00-23)
func (r *ReadingProgressRepository) GetHourlyActivity(db database.Queryer, userID string) ([]HourlyActivity, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`
		SELECT strftime('%H', completed_at, 'localtime') as hour, COUNT(*) as count
		FROM chapter_completions
		WHERE user_id = ?
		GROUP BY hour
		ORDER BY hour ASC
	`, userID)
	
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var activities []HourlyActivity
	for rows.Next() {
		var a HourlyActivity
		if err := rows.Scan(&a.Hour, &a.Count); err != nil {
			return nil, err
		}
		activities = append(activities, a)
	}
	return activities, nil
}

// GetTopSeries 가장 많이 읽은 시리즈 (페이지 수 기준)
func (r *ReadingProgressRepository) GetTopSeries(db database.Queryer, userID string, limit int) ([]model.Series, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`
		SELECT s.id, s.title, SUM(rp.read_time_seconds) as total_read_time
		FROM reading_progress rp
		JOIN series s ON rp.series_id = s.id
		WHERE rp.user_id = ?
		GROUP BY s.id
		ORDER BY total_read_time DESC
		LIMIT ?
	`, userID, limit)
	
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var readCount int
		// Series 모델의 일부 필드만 채워서 반환
		if err := rows.Scan(&s.ID, &s.Title, &readCount); err != nil {
			return nil, err
		}
		// ReadPageCount 필드를 임시로 사용하여 집계된 페이지 수를 전달할 수도 있음
		s.ReadPageCount = readCount
		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

