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
func (r *SeriesRepository) Create(db database.Queryer, series *model.Series) error {
	db = database.GetQueryer(db)
	series.ID = uuid.New().String()
	now := time.Now()
	if series.CreatedAt.IsZero() {
		series.CreatedAt = now
	}
	if series.UpdatedAt.IsZero() {
		series.UpdatedAt = now
	}

	// 1. series 테이블 저장
	_, err := db.Exec(
		`INSERT INTO series (id, library_id, title, path, thumbnail_path, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.LibraryID, series.Title, series.Path, series.ThumbnailPath,
		series.CreatedAt, series.UpdatedAt,
	)
	if err != nil {
		return err
	}

	// 2. series_metadata 테이블 저장
	if series.Metadata == nil {
		series.Metadata = &model.SeriesMetadata{}
	}
	_, err = db.Exec(
		`INSERT INTO series_metadata (series_id, description, is_bookmarked, status, authors, tags, publication_year)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		series.ID, series.Description, series.IsBookmarked, series.Metadata.Status, series.Metadata.Authors, series.Metadata.Tags, series.Metadata.PublicationYear,
	)
	return err
}

// FindByLibraryID 라이브러리 ID로 시리즈 목록 조회
func (r *SeriesRepository) FindByLibraryID(db database.Queryer, libraryID string) ([]model.Series, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.created_at, s.updated_at,
		        sm.description, sm.is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year
		 FROM series s
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 WHERE s.library_id = ? ORDER BY s.title`,
		libraryID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var m model.SeriesMetadata
		var thumbnail sql.NullString
		var desc, status, authors, tags, pubYear sql.NullString
		var isBookmarked sql.NullBool

		err := rows.Scan(
			&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt,
			&desc, &isBookmarked, &status, &authors, &tags, &pubYear,
		)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}

		m.SeriesID = s.ID
		if desc.Valid {
			s.Description = desc.String
			m.Description = desc.String
		}
		if isBookmarked.Valid {
			s.IsBookmarked = isBookmarked.Bool
			m.IsBookmarked = isBookmarked.Bool
		}
		if status.Valid {
			m.Status = status.String
		}
		if authors.Valid {
			m.Authors = authors.String
		}
		if tags.Valid {
			m.Tags = tags.String
		}
		if pubYear.Valid {
			m.PublicationYear = pubYear.String
		}
		s.Metadata = &m

		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// FindBookmarked 북마크된(좋아요) 모든 시리즈 목록 조회
func (r *SeriesRepository) FindBookmarked(db database.Queryer) ([]model.Series, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.created_at, s.updated_at,
		        sm.description, sm.is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year
		 FROM series s
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 WHERE sm.is_bookmarked = 1 ORDER BY s.title`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var seriesList []model.Series
	for rows.Next() {
		var s model.Series
		var m model.SeriesMetadata
		var thumbnail sql.NullString
		var desc, status, authors, tags, pubYear sql.NullString
		var isBookmarked sql.NullBool

		err := rows.Scan(
			&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt,
			&desc, &isBookmarked, &status, &authors, &tags, &pubYear,
		)
		if err != nil {
			return nil, err
		}

		if thumbnail.Valid {
			s.ThumbnailPath = &thumbnail.String
		}

		m.SeriesID = s.ID
		if desc.Valid {
			s.Description = desc.String
			m.Description = desc.String
		}
		if isBookmarked.Valid {
			s.IsBookmarked = isBookmarked.Bool
			m.IsBookmarked = isBookmarked.Bool
		}
		if status.Valid {
			m.Status = status.String
		}
		if authors.Valid {
			m.Authors = authors.String
		}
		if tags.Valid {
			m.Tags = tags.String
		}
		if pubYear.Valid {
			m.PublicationYear = pubYear.String
		}
		s.Metadata = &m

		seriesList = append(seriesList, s)
	}
	return seriesList, nil
}

// FindByID ID로 시리즈 조회
func (r *SeriesRepository) FindByID(db database.Queryer, id string) (*model.Series, error) {
	db = database.GetQueryer(db)
	var s model.Series
	var m model.SeriesMetadata
	var thumbnail sql.NullString
	var desc, status, authors, tags, pubYear sql.NullString
	var isBookmarked sql.NullBool

	err := db.QueryRow(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.created_at, s.updated_at,
		        sm.description, sm.is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year
		 FROM series s
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 WHERE s.id = ?`,
		id,
	).Scan(
		&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt,
		&desc, &isBookmarked, &status, &authors, &tags, &pubYear,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}

	m.SeriesID = s.ID
	if desc.Valid {
		s.Description = desc.String
		m.Description = desc.String
	}
	if isBookmarked.Valid {
		s.IsBookmarked = isBookmarked.Bool
		m.IsBookmarked = isBookmarked.Bool
	}
	if status.Valid {
		m.Status = status.String
	}
	if authors.Valid {
		m.Authors = authors.String
	}
	if tags.Valid {
		m.Tags = tags.String
	}
	if pubYear.Valid {
		m.PublicationYear = pubYear.String
	}
	s.Metadata = &m

	return &s, nil
}

// FindByPath 경로로 시리즈 조회
func (r *SeriesRepository) FindByPath(db database.Queryer, path string) (*model.Series, error) {
	db = database.GetQueryer(db)
	var s model.Series
	var m model.SeriesMetadata
	var thumbnail sql.NullString
	var desc, status, authors, tags, pubYear sql.NullString
	var isBookmarked sql.NullBool

	err := db.QueryRow(
		`SELECT s.id, s.library_id, s.title, s.path, s.thumbnail_path, s.created_at, s.updated_at,
		        sm.description, sm.is_bookmarked, sm.status, sm.authors, sm.tags, sm.publication_year
		 FROM series s
		 LEFT JOIN series_metadata sm ON s.id = sm.series_id
		 WHERE s.path = ?`,
		path,
	).Scan(
		&s.ID, &s.LibraryID, &s.Title, &s.Path, &thumbnail, &s.CreatedAt, &s.UpdatedAt,
		&desc, &isBookmarked, &status, &authors, &tags, &pubYear,
	)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	if thumbnail.Valid {
		s.ThumbnailPath = &thumbnail.String
	}

	m.SeriesID = s.ID
	if desc.Valid {
		s.Description = desc.String
		m.Description = desc.String
	}
	if isBookmarked.Valid {
		s.IsBookmarked = isBookmarked.Bool
		m.IsBookmarked = isBookmarked.Bool
	}
	if status.Valid {
		m.Status = status.String
	}
	if authors.Valid {
		m.Authors = authors.String
	}
	if tags.Valid {
		m.Tags = tags.String
	}
	if pubYear.Valid {
		m.PublicationYear = pubYear.String
	}
	s.Metadata = &m

	return &s, nil
}

// DeleteByLibraryID 라이브러리 ID로 모든 시리즈 삭제
func (r *SeriesRepository) DeleteByLibraryID(db database.Queryer, libraryID string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM series WHERE library_id = ?`, libraryID)
	return err
}

// Delete ID로 시리즈 삭제
func (r *SeriesRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM series WHERE id = ?`, id)
	return err
}

// Update 시리즈 정보 업데이트
func (r *SeriesRepository) Update(db database.Queryer, series *model.Series) error {
	db = database.GetQueryer(db)
	now := time.Now()
	// 1. series 테이블 업데이트
	_, err := db.Exec(
		`UPDATE series SET title = ?, path = ?, thumbnail_path = ?, updated_at = ? WHERE id = ?`,
		series.Title, series.Path, series.ThumbnailPath, now, series.ID,
	)
	if err != nil {
		return err
	}

	// 2. series_metadata 테이블 업데이트
	if series.Metadata != nil {
		_, err = db.Exec(
			`UPDATE series_metadata SET description = ?, is_bookmarked = ?, status = ?, authors = ?, tags = ?, publication_year = ? WHERE series_id = ?`,
			series.Description, series.IsBookmarked, series.Metadata.Status, series.Metadata.Authors, series.Metadata.Tags, series.Metadata.PublicationYear, series.ID,
		)
		return err
	}

	return nil
}

// UpdateBookmark 시리즈 북마크 상태 업데이트 (updated_at 변경 안 함)
func (r *SeriesRepository) UpdateBookmark(db database.Queryer, id string, isBookmarked bool) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE series_metadata SET is_bookmarked = ? WHERE series_id = ?`, isBookmarked, id)
	return err
}

// UpdateUpdatedAt 시리즈의 업데이트 시간 수정
func (r *SeriesRepository) UpdateUpdatedAt(db database.Queryer, id string, updatedAt time.Time) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`UPDATE series SET updated_at = ? WHERE id = ?`, updatedAt, id)
	return err
}

// GetFirstPageID 시리즈의 첫 번째 페이지 ID 조회 (썸네일용)
func (r *SeriesRepository) GetFirstPageID(db database.Queryer, seriesID string) (string, error) {
	db = database.GetQueryer(db)
	var pageID string
	err := db.QueryRow(
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
func (r *SeriesRepository) GetTotalPages(db database.Queryer, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	var totalPages int
	err := db.QueryRow(
		`SELECT COALESCE(SUM(c.page_count), 0)
		 FROM chapters c
		 JOIN volumes v ON c.volume_id = v.id
		 WHERE v.series_id = ?`,
		seriesID,
	).Scan(&totalPages)
	return totalPages, err
}

// GetReadPages 사용자가 시리즈에서 읽은 총 페이지 수 조회
func (r *SeriesRepository) GetReadPages(db database.Queryer, userID, seriesID string) (int, error) {
	db = database.GetQueryer(db)
	// 시리즈의 모든 볼륨 정보를 조회하여 계산 (series_handler의 ListVolumes 로직과 동일하게 맞춤)
	rows, err := db.Query(
		`SELECT 
			v.id,
			(SELECT COUNT(*) FROM volume_completions vc WHERE vc.volume_id = v.id AND vc.user_id = ?) as is_completed,
			(SELECT COALESCE(SUM(page_count), 0) FROM chapters WHERE volume_id = v.id) as total_pages,
			(SELECT COALESCE(SUM(current_page), 0) FROM reading_progress WHERE volume_id = v.id AND user_id = ?) as read_pages
		 FROM volumes v
		 WHERE v.series_id = ?`,
		userID, userID, seriesID,
	)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	totalReadPages := 0

	for rows.Next() {
		var volumeID string
		var isCompleted bool
		var totalPages int
		var readPages int

		if err := rows.Scan(&volumeID, &isCompleted, &totalPages, &readPages); err != nil {
			return 0, err
		}

		// 완독 상태지만 읽은 페이지가 0인 경우 (예: 직접 완독 처리했으나 진행도 업데이트 실패 등) 100%로 보정
		// 그 외의 경우(부분 읽기, 완독 후 역주행 등)는 실제 읽은 페이지(readPages)를 우선 사용
		if isCompleted && readPages == 0 && totalPages > 0 {
			totalReadPages += totalPages
		} else {
			totalReadPages += readPages
		}
	}

	return totalReadPages, nil
}
