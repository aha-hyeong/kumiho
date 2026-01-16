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
	if series.CreatedAt.IsZero() {
		series.CreatedAt = now
	}
	if series.UpdatedAt.IsZero() {
		series.UpdatedAt = now
	}

	_, err := database.DB.Exec(
		`INSERT INTO series (id, library_id, title, path, thumbnail_path, description, status, authors, tags, is_bookmarked, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.LibraryID, series.Title, series.Path, series.ThumbnailPath, 
		series.Description, series.Status, series.Authors, series.Tags, series.IsBookmarked,
		series.CreatedAt, series.UpdatedAt,
	)
	return err
}

// FindByLibraryID 라이브러리 ID로 시리즈 목록 조회
func (r *SeriesRepository) FindByLibraryID(libraryID string) ([]model.Series, error) {
	rows, err := database.DB.Query(
		`SELECT id, library_id, title, path, thumbnail_path, description, status, authors, tags, is_bookmarked, publication_year, created_at, updated_at 
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
		if err := rows.Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.Description, &s.Status, &s.Authors, &s.Tags, &s.IsBookmarked, &s.PublicationYear, &s.CreatedAt, &s.UpdatedAt); err != nil {
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
		`SELECT id, library_id, title, path, thumbnail_path, description, status, authors, tags, is_bookmarked, publication_year, created_at, updated_at FROM series WHERE id = ?`,
		id,
	).Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.Description, &s.Status, &s.Authors, &s.Tags, &s.IsBookmarked, &s.PublicationYear, &s.CreatedAt, &s.UpdatedAt)

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
		`SELECT id, library_id, title, path, thumbnail_path, description, status, authors, tags, is_bookmarked, publication_year, created_at, updated_at FROM series WHERE path = ?`,
		path,
	).Scan(&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.Description, &s.Status, &s.Authors, &s.Tags, &s.IsBookmarked, &s.PublicationYear, &s.CreatedAt, &s.UpdatedAt)

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

// Delete ID로 시리즈 삭제
func (r *SeriesRepository) Delete(id string) error {
	_, err := database.DB.Exec(`DELETE FROM series WHERE id = ?`, id)
	return err
}

// Update 시리즈 정보 업데이트
func (r *SeriesRepository) Update(series *model.Series) error {
	now := time.Now()
	_, err := database.DB.Exec(
		`UPDATE series SET title = ?, path = ?, thumbnail_path = ?, description = ?, status = ?, authors = ?, tags = ?, is_bookmarked = ?, publication_year = ?, updated_at = ? WHERE id = ?`,
		series.Title, series.Path, series.ThumbnailPath, series.Description, series.Status, series.Authors, series.Tags, series.IsBookmarked, series.PublicationYear, now, series.ID,
	)
	return err
}

// UpdateUpdatedAt 시리즈의 업데이트 시간 수정
func (r *SeriesRepository) UpdateUpdatedAt(id string, updatedAt time.Time) error {
	_, err := database.DB.Exec(`UPDATE series SET updated_at = ? WHERE id = ?`, updatedAt, id)
	return err
}

// GetFirstPageID 시리즈의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *SeriesRepository) GetFirstPageID(seriesID string) (string, error) {
	var pageID string
	err := database.DB.QueryRow(
		`SELECT p.id 
		 FROM pages p
		 JOIN chapters c ON p.chapter_id = c.id
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?
		 ORDER BY v.volume_number, c.chapter_number, p.page_number
		 LIMIT 1`,
		seriesID,
	).Scan(&pageID)

	if err != nil {
		return "", err
	}
	return pageID, nil
}

// GetTotalPages 시리즈의 전체 페이지 수 조회
func (r *SeriesRepository) GetTotalPages(seriesID string) (int, error) {
	var totalPages int
	err := database.DB.QueryRow(
		`SELECT COALESCE(SUM(c.page_count), 0)
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?`,
		seriesID,
	).Scan(&totalPages)
	return totalPages, err
}

// GetReadPages 사용자가 시리즈에서 읽은 총 페이지 수 조회
func (r *SeriesRepository) GetReadPages(userID, seriesID string) (int, error) {
	// 1. 완독된 볼륨의 페이지 수 합
	var completedVolumePages int
	err := database.DB.QueryRow(
		`SELECT COALESCE(SUM(c.page_count), 0)
		 FROM volume_completions vc
		 JOIN volumes v ON vc.volume_id = v.id
		 JOIN chapters c ON v.id = c.volume_id
		 WHERE vc.user_id = ? AND v.series_id = ?`,
		userID, seriesID,
	).Scan(&completedVolumePages)
	if err != nil {
		return 0, err
	}

	// 2. 완독되지 않은 볼륨들의 읽은 챕터 페이지 수 합 (ReadingProgress)
	// 완독된 볼륨은 제외해야 함 (중복 합산 방지)
	var progressPages int
	err = database.DB.QueryRow(
		`SELECT COALESCE(SUM(rp.current_page), 0)
		 FROM reading_progress rp
		 LEFT JOIN volume_completions vc ON rp.volume_id = vc.volume_id AND vc.user_id = rp.user_id
		 WHERE rp.user_id = ? AND rp.series_id = ? AND vc.id IS NULL`,
		userID, seriesID,
	).Scan(&progressPages)
	if err != nil {
		return 0, err
	}

	return completedVolumePages + progressPages, nil
}
