package repository

import (
	"database/sql"
	"time"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
	"github.com/google/uuid"
)

type SeriesRepository struct{}

func NewSeriesRepository() *SeriesRepository {
	return &SeriesRepository{}
}

// Create 새 시리즈 생성
func (r *SeriesRepository) Create(series *model.Series) error {
	series.ID = uuid.New().String()
	now := time.Now()
	series.CreatedAt = now
	series.UpdatedAt = now

	_, err := database.DB.Exec(
		`INSERT INTO series (id, library_id, title, path, thumbnail_path, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.LibraryID, series.Title, series.Path, series.ThumbnailPath, series.CreatedAt, series.UpdatedAt,
	)
	return err
}

// FindByLibraryID 라이브러리 ID로 시리즈 목록 조회
func (r *SeriesRepository) FindByLibraryID(libraryID string) ([]model.Series, error) {
	rows, err := database.DB.Query(
		`SELECT id, library_id, title, path, thumbnail_path, created_at, updated_at 
		 FROM series WHERE library_id = ? ORDER BY title`,
		libraryID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var thumbnail sql.NullString
		if err := rows.Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}
		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// FindByID ID로 시리즈 조회
func (r *SeriesRepository) FindByID(id string) (*model.Series, error) {
	var s model.Series
	var thumbnail sql.NullString
	err := database.DB.QueryRow(
		`SELECT id, library_id, title, path, thumbnail_path, created_at, updated_at FROM series WHERE id = ?`,
		id,
	).Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}
	return &s, nil
}

// FindByPath 경로로 시리즈 조회
func (r *SeriesRepository) FindByPath(path string) (*model.Series, error) {
	var s model.Series
	var thumbnail sql.NullString
	err := database.DB.QueryRow(
		`SELECT id, library_id, title, path, thumbnail_path, created_at, updated_at FROM series WHERE path = ?`,
		path,
	).Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}
	return &s, nil
}

// DeleteByLibraryID 라이브러리 ID로 모든 시리즈 삭제
func (r *SeriesRepository) DeleteByLibraryID(libraryID string) error {
	_, err := database.DB.Exec(`DELETE FROM series WHERE library_id = ?`, libraryID)
	return err
}
