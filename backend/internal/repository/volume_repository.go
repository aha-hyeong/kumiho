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
func (r *VolumeRepository) Create(volume *model.Volume) error {
	volume.ID = uuid.New().String()
	now := time.Now()
	volume.CreatedAt = now
	volume.UpdatedAt = now

	_, err := database.DB.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		volume.ID, volume.SeriesID, volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.CreatedAt, volume.UpdatedAt,
	)
	return err
}

// FindBySeriesID 시리즈 ID로 볼륨 목록 조회
func (r *VolumeRepository) FindBySeriesID(seriesID string) ([]model.Volume, error) {
	rows, err := database.DB.Query(
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
func (r *VolumeRepository) FindByID(id string) (*model.Volume, error) {
	var v model.Volume
	var thumbnail sql.NullString
	err := database.DB.QueryRow(
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
func (r *VolumeRepository) FindByPath(path string) (*model.Volume, error) {
	var v model.Volume
	var thumbnail sql.NullString
	err := database.DB.QueryRow(
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
func (r *VolumeRepository) GetFirstPageID(volumeID string) (string, error) {
	var pageID string
	err := database.DB.QueryRow(
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
func (r *VolumeRepository) DeleteBySeriesID(seriesID string) error {
	_, err := database.DB.Exec(`DELETE FROM volumes WHERE series_id = ?`, seriesID)
	return err
}
