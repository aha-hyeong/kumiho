package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type ReadingProgressRepository struct{}

func NewReadingProgressRepository() *ReadingProgressRepository {
	return &ReadingProgressRepository{}
}

// Upsert 읽기 진행도 생성 또는 업데이트 (시리즈별 통합)
func (r *ReadingProgressRepository) Upsert(db database.Queryer, progress *model.ReadingProgress) error {
	db = database.GetQueryer(db)
	now := time.Now()
	progress.UpdatedAt = now

	if progress.ID == "" {
		progress.ID = uuid.New().String()
	}

	_, err := db.Exec(
		`INSERT INTO reading_progress 
		 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(user_id, series_id) DO UPDATE SET
			volume_id = excluded.volume_id,
			chapter_id = excluded.chapter_id,
			current_page = excluded.current_page,
			total_pages = excluded.total_pages,
			progress_percent = excluded.progress_percent,
			device_id = excluded.device_id,
			device_name = excluded.device_name,
			updated_at = excluded.updated_at`,
		progress.ID, progress.UserID, progress.SeriesID, progress.VolumeID, progress.ChapterID,
		progress.CurrentPage, progress.TotalPages, progress.ProgressPercent,
		progress.DeviceID, progress.DeviceName, progress.UpdatedAt,
	)
	return err
}

// FindByUserAndSeries 사용자와 시리즈의 가장 최근 진행도 조회
func (r *ReadingProgressRepository) FindByUserAndSeries(db database.Queryer, userID, seriesID string) (*model.ReadingProgress, error) {
	db = database.GetQueryer(db)
	var p model.ReadingProgress
	var volumeID, chapterID, deviceID, deviceName sql.NullString

	// 시리즈 내 가장 최근 읽은 챕터 진행도 반환
	err := db.QueryRow(
		`SELECT id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, 
		 progress_percent, device_id, device_name, updated_at
		 FROM reading_progress WHERE user_id = ? AND series_id = ?
		 ORDER BY updated_at DESC LIMIT 1`,
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
	defer rows.Close()

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
		 ORDER BY rp.updated_at DESC LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

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
	defer rows.Close()

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
