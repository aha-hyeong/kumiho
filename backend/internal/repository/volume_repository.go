package repository

import (
	"database/sql"
	"time"

	"github.com/google/uuid"

	"github.com/aha-hyeong/kumiho/backend/internal/database"
	"github.com/aha-hyeong/kumiho/backend/internal/model"
)

type VolumeRepository struct{}

func NewVolumeRepository() *VolumeRepository {
	return &VolumeRepository{}
}

// Create 새 볼륨 생성
func (r *VolumeRepository) Create(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	if volume.ID == "" {
		volume.ID = uuid.New().String()
	}
	now := time.Now()
	volume.CreatedAt = now
	volume.UpdatedAt = now

	_, err := db.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, description, authors, publication_year, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		volume.ID, volume.SeriesID, volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.Description, volume.Authors, volume.PublicationYear, volume.CreatedAt, volume.UpdatedAt,
	)
	return err
}

// Update 볼륨 정보 수정
func (r *VolumeRepository) Update(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	volume.UpdatedAt = time.Now()

	_, err := db.Exec(
		`UPDATE volumes 
		 SET title = ?, volume_number = ?, path = ?, thumbnail_path = ?, has_audio = ?, unit = ?, description = ?, authors = ?, publication_year = ?, updated_at = ?
		 WHERE id = ?`,
		volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.Description, volume.Authors, volume.PublicationYear, volume.UpdatedAt, volume.ID,
	)
	return err
}

// FindBySeriesID 시리즈 ID로 볼륨 목록 조회
func (r *VolumeRepository) FindBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, description, authors, publication_year, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail sql.NullString
		var unit sql.NullString
		var description, authors, pubYear sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &description, &authors, &pubYear, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if description.Valid {
			v.Description = description.String
		}
		if authors.Valid {
			v.Authors = authors.String
		}
		if pubYear.Valid {
			v.PublicationYear = pubYear.String
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
	var unit sql.NullString
	var description, authors, pubYear sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, description, authors, publication_year, created_at, updated_at FROM volumes WHERE id = ?`,
		id,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &description, &authors, &pubYear, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	if unit.Valid {
		v.Unit = unit.String
	}
	if description.Valid {
		v.Description = description.String
	}
	if authors.Valid {
		v.Authors = authors.String
	}
	if pubYear.Valid {
		v.PublicationYear = pubYear.String
	}
	return &v, nil
}

// FindByPath 경로로 볼륨 조회
func (r *VolumeRepository) FindByPath(db database.Queryer, path string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail sql.NullString
	var unit sql.NullString
	var description, authors, pubYear sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, description, authors, publication_year, created_at, updated_at FROM volumes WHERE path = ?`,
		path,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &description, &authors, &pubYear, &v.CreatedAt, &v.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if thumbnail.Valid {
		v.ThumbnailPath = &thumbnail.String
	}
	if unit.Valid {
		v.Unit = unit.String
	}
	if description.Valid {
		v.Description = description.String
	}
	if authors.Valid {
		v.Authors = authors.String
	}
	if pubYear.Valid {
		v.PublicationYear = pubYear.String
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

// Delete 볼륨 삭제
func (r *VolumeRepository) Delete(db database.Queryer, id string) error {
	db = database.GetQueryer(db)
	_, err := db.Exec(`DELETE FROM volumes WHERE id = ?`, id)
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

// GetChapterCount 사용 가능한 챕터 개수를 조회합니다.
func (r *VolumeRepository) GetChapterCount(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM chapters WHERE volume_id = ?`, volumeID).Scan(&count)
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

	// 1. 현재 진행 중인 챕터 정보 조회 (Reading Progress)
	var currentChapterNum int
	var currentPage int
	var hasProgress bool

	err := db.QueryRow(
		`SELECT c.chapter_number, rp.current_page
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND rp.volume_id = ?
		 ORDER BY rp.updated_at DESC
		 LIMIT 1`,
		userID, volumeID,
	).Scan(&currentChapterNum, &currentPage)

	if err != nil && err != sql.ErrNoRows {
		return 0, err
	}
	if err == nil {
		hasProgress = true
	}

	// 2. 진행 중인 기록이 있는 경우: (이전 챕터들의 총 페이지 수) + 현재 페이지
	if hasProgress {
		var prevPages int
		err = db.QueryRow(
			`SELECT COALESCE(SUM(page_count), 0)
			 FROM chapters
			 WHERE volume_id = ? AND chapter_number < ?`,
			volumeID, currentChapterNum,
		).Scan(&prevPages)
		if err != nil {
			return 0, err
		}
		return prevPages + currentPage, nil
	}

	// 3. 진행 중인 기록이 없는 경우:
	//    a) 볼륨 완독 여부 확인
	var completed bool
	err = db.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM volume_completions WHERE user_id = ? AND volume_id = ?)`,
		userID, volumeID,
	).Scan(&completed)
	if err == nil && completed {
		return r.GetTotalPages(db, volumeID)
	}

	//    b) 챕터 완독 기록 합산 (완독된 챕터들의 페이지 수 합계)
	var completedPages int
	err = db.QueryRow(
		`SELECT COALESCE(SUM(c.page_count), 0)
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 WHERE cc.user_id = ? AND c.volume_id = ?`,
		userID, volumeID,
	).Scan(&completedPages)
	if err != nil {
		return 0, err
	}

	return completedPages, nil
}
