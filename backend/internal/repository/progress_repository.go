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

// Upsert 읽기 진행도 생성 또는 업데이트 (챕터별)
func (r *ReadingProgressRepository) Upsert(progress *model.ReadingProgress) error {
	now := time.Now()
	progress.UpdatedAt = now

	// chapter_id가 없으면 에러
	if progress.ChapterID == nil || *progress.ChapterID == "" {
		return nil // 챕터 ID 없으면 저장하지 않음
	}

	// 기존 진행도 조회 (챕터별)
	existing, err := r.FindByUserAndChapter(progress.UserID, *progress.ChapterID)
	if err != nil {
		return err
	}

	if existing == nil {
		// 새로 생성
		progress.ID = uuid.New().String()
		_, err = database.DB.Exec(
			`INSERT INTO reading_progress 
			 (id, user_id, series_id, volume_id, chapter_id, current_page, total_pages, progress_percent, device_id, device_name, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			progress.ID, progress.UserID, progress.SeriesID, progress.VolumeID, progress.ChapterID,
			progress.CurrentPage, progress.TotalPages, progress.ProgressPercent,
			progress.DeviceID, progress.DeviceName, progress.UpdatedAt,
		)
	} else {
		// 업데이트
		progress.ID = existing.ID
		_, err = database.DB.Exec(
			`UPDATE reading_progress SET 
			 volume_id = ?, chapter_id = ?, current_page = ?, total_pages = ?, 
			 progress_percent = ?, device_id = ?, device_name = ?, updated_at = ?
			 WHERE id = ?`,
			progress.VolumeID, progress.ChapterID, progress.CurrentPage, progress.TotalPages,
			progress.ProgressPercent, progress.DeviceID, progress.DeviceName, progress.UpdatedAt,
			progress.ID,
		)
	}
	return err
}

// FindByUserAndSeries 사용자와 시리즈의 가장 최근 진행도 조회
func (r *ReadingProgressRepository) FindByUserAndSeries(userID, seriesID string) (*model.ReadingProgress, error) {
	var p model.ReadingProgress
	var volumeID, chapterID, deviceID, deviceName sql.NullString

	// 시리즈 내 가장 최근 읽은 챕터 진행도 반환
	err := database.DB.QueryRow(
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
func (r *ReadingProgressRepository) FindByUserAndChapter(userID, chapterID string) (*model.ReadingProgress, error) {
	var p model.ReadingProgress
	var volumeID, chapterIDNull, deviceID, deviceName sql.NullString

	err := database.DB.QueryRow(
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

// FindByUser 사용자의 모든 읽기 진행도 조회
func (r *ReadingProgressRepository) FindByUser(userID string) ([]model.ReadingProgress, error) {
	rows, err := database.DB.Query(
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
func (r *ReadingProgressRepository) FindRecentByUser(userID string, limit int) ([]model.ReadingProgress, error) {
	// 완료된 볼륨에 속한 챕터의 진행도는 제외
	// NOT EXISTS로 완료된 볼륨 필터링 (rp.volume_id가 NULL일 경우 chapters.volume_id 사용)
	rows, err := database.DB.Query(
		`SELECT rp.id, rp.user_id, rp.series_id, rp.volume_id, rp.chapter_id, rp.current_page, 
		 rp.total_pages, rp.progress_percent, rp.device_id, rp.device_name, rp.updated_at
		 FROM reading_progress rp
		 LEFT JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? 
		 AND NOT EXISTS (
		   SELECT 1 FROM volume_completions vc 
		   WHERE vc.user_id = rp.user_id 
		   AND vc.volume_id = COALESCE(rp.volume_id, c.volume_id)
		 )
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
func (r *ReadingProgressRepository) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM reading_progress WHERE id = ?`, id)
	return err
}

// FindByUserAndVolume 사용자와 볼륨의 모든 챕터 진행도 조회
func (r *ReadingProgressRepository) FindByUserAndVolume(userID, volumeID string) ([]model.ReadingProgress, error) {
	rows, err := database.DB.Query(
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
