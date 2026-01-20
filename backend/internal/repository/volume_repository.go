package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type VolumeRepository struct{}

func NewVolumeRepository() *VolumeRepository {
	return &VolumeRepository{}
}

// Create 새 볼륨 생성
func (r *VolumeRepository) Create(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	volume.ID = uuid.New().String()
	now := time.Now()
	volume.CreatedAt = now
	volume.UpdatedAt = now

	_, err := db.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		volume.ID, volume.SeriesID, volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.CreatedAt, volume.UpdatedAt,
	)
	return err
}

// FindBySeriesID 시리즈 ID로 볼륨 목록 조회
func (r *VolumeRepository) FindBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail sql.NullString
		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}

// FindByID ID로 볼륨 조회
func (r *VolumeRepository) FindByID(db database.Queryer, id string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail sql.NullString
	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, created_at, updated_at FROM volumes WHERE id = ?`,
		id,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	return &v, nil
}

// FindByPath 경로로 볼륨 조회
func (r *VolumeRepository) FindByPath(db database.Queryer, path string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail sql.NullString
	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, created_at, updated_at FROM volumes WHERE path = ?`,
		path,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	return &v, nil
}

// GetFirstPageID 볼륨의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *VolumeRepository) GetFirstPageID(db database.Queryer, volumeID string) (string, error) {
	db = database.GetQueryer(db)
	var pageID string
	err := db.QueryRow(
		`SELECT p.id 
		 FROM pages p
		 JOIN chapters c ON p.chapter_id = c.id
		 WHERE c.volume_id = ?
		 ORDER BY c.chapter_number, p.page_number
		 LIMIT 1`,
		volumeID,
	).Scan(&pageID)

	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return pageID, nil
}

// DeleteBySeriesID 시리즈 ID로 모든 볼륨 삭제
func (r *VolumeRepository) DeleteBySeriesID(db database.Queryer, seriesID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM volumes WHERE series_id = ?`, seriesID)
	return err
}

// CountBySeriesID 시리즈의 전체 볼륨 수를 조회합니다.
// 오류 발생 시 0과 오류를 반환합니다.
func (r *VolumeRepository) CountBySeriesID(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM volumes WHERE series_id = ?`, seriesID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// GetTotalPages 볼륨의 전체 페이지 수 조회
func (r *VolumeRepository) GetTotalPages(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var totalPages int
	err := db.QueryRow(
		`SELECT COALESCE(SUM(page_count), 0)
		 FROM chapters
		 WHERE volume_id = ?`,
		volumeID,
	).Scan(&totalPages)
	return totalPages, err
}

// GetReadPages 사용자가 볼륨에서 읽은 총 페이지 수 조회
func (r *VolumeRepository) GetReadPages(db database.Queryer, userID, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	// 1) 우선 volume_completions를 조회하여 완독 여부를 확인합니다.
	//    완독된 경우, reading_progress가 더 이상 업데이트되지 않아도 전체 페이지 수로 간주할 수 있습니다.
	//    (단, 역주행 시에는 호출자가 처리를 달리할 수 있지만, 리포지토리 레벨에서는 "완독 기록이 있으면 일단 완독"으로 간주하거나,
	//     아니면 순수하게 reading_progress 합을 구할 수도 있습니다.
	//     PR 피드백에 따라 "완독 시 reading_progress가 업데이트되지 않을 수 있음"을 고려하여 fallback 처리합니다.)
	var completed bool
	err := db.QueryRow(
		`SELECT EXISTS(
			 SELECT 1
			 FROM volume_completions
			 WHERE user_id = ? AND volume_id = ?
		 )`,
		userID, volumeID,
	).Scan(&completed)
	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}

	// 2) 완독이 아닌 경우에만 reading_progress를 합산하여 진행 중인 페이지 수를 계산합니다.
	//    (수정: reading_progress가 있으면 그것을 우선하고, 없으면 완독 여부에 따라 전체 페이지 수를 반환합니다.)
	var progressPages int
	err = db.QueryRow(
		`SELECT COALESCE(SUM(current_page), 0)
		 FROM reading_progress
		 WHERE user_id = ? AND volume_id = ?`,
		userID, volumeID,
	).Scan(&progressPages)
	if err != nil {
		return 0, err
	}

	if progressPages > 0 {
		return progressPages, nil
	}

	// 읽은 기록이 없는데 완독 기록이 있다면 전체 페이지 반환
	if completed {
		return r.GetTotalPages(db, volumeID)
	}

	return 0, nil
}
