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
	if volume.CreatedAt.IsZero() {
		volume.CreatedAt = now
	}
	if volume.UpdatedAt.IsZero() {
		volume.UpdatedAt = now
	}

	_, err := db.Exec(
		`INSERT INTO volumes (id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		volume.ID, volume.SeriesID, volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.ChapterCount, volume.ParentID, volume.Description, volume.Authors, volume.PublicationYear, volume.Extension, volume.CreatedAt, volume.UpdatedAt,
	)
	return err
}

// Update 볼륨 정보 수정
func (r *VolumeRepository) Update(db database.Queryer, volume *model.Volume) error {
	db = database.GetQueryer(db)
	volume.UpdatedAt = time.Now()

	_, err := db.Exec(
		`UPDATE volumes 
		 SET title = ?, volume_number = ?, path = ?, thumbnail_path = ?, has_audio = ?, unit = ?, chapter_count = ?, parent_id = ?, description = ?, authors = ?, publication_year = ?, extension = ?, updated_at = ?
		 WHERE id = ?`,
		volume.Title, volume.VolumeNumber, volume.Path, volume.ThumbnailPath, volume.HasAudio, volume.Unit, volume.ChapterCount, volume.ParentID, volume.Description, volume.Authors, volume.PublicationYear, volume.Extension, volume.UpdatedAt, volume.ID,
	)
	return err
}

// FindBySeriesID 시리즈 ID로 볼륨 목록 조회
func (r *VolumeRepository) FindBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number, path`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, parentID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if parentID.Valid {
			v.ParentID = &parentID.String
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
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}

// FindByID ID로 볼륨 조회
func (r *VolumeRepository) FindByID(db database.Queryer, id string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at FROM volumes WHERE id = ?`,
		id,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

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
	if parentID.Valid {
		v.ParentID = &parentID.String
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
	if extension.Valid {
		v.Extension = extension.String
	}
	return &v, nil
}

// FindByPath 경로로 볼륨 조회
func (r *VolumeRepository) FindByPath(db database.Queryer, path string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at FROM volumes WHERE path = ?`,
		path,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

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
	if parentID.Valid {
		v.ParentID = &parentID.String
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
	if extension.Valid {
		v.Extension = extension.String
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

// GetTotalPages 볼륨의 전체 페이지 수 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetTotalPages(db database.Queryer, volumeID string) (int, error) {
	db = database.GetQueryer(db)
	var totalPages int
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		 SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN c.page_count 
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
				ELSE 0 
			END), 0)
		 FROM chapters c
		 WHERE c.volume_id IN (SELECT id FROM descendant_volumes)`,
		volumeID,
	).Scan(&totalPages)
	return totalPages, err
}

// GetReadPages 사용자가 볼륨에서 읽은 총 페이지 수 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetReadPages(db database.Queryer, userID, volumeID string) (int, error) {
	db = database.GetQueryer(db)

	// 하위 볼륨 포함 재귀 집계
	var completedPages int
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		 SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN c.page_count 
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN c.total_positions
				ELSE 0 
			END), 0)
		 FROM chapter_completions cc
		 JOIN chapters c ON cc.chapter_id = c.id
		 WHERE cc.user_id = ? AND c.volume_id IN (SELECT id FROM descendant_volumes)`,
		volumeID, userID,
	).Scan(&completedPages)
	if err != nil {
		return 0, err
	}

	var progressPages int
	err = db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		)
		 SELECT COALESCE(SUM(
			CASE 
				WHEN c.page_count > 0 THEN rp.current_page
				WHEN c.page_count <= 0 AND c.total_positions > 0 THEN rp.current_page
				ELSE CAST(rp.progress_percent AS INTEGER)
			END
			 ), 0)
		 FROM reading_progress rp
		 JOIN chapters c ON rp.chapter_id = c.id
		 WHERE rp.user_id = ? AND c.volume_id IN (SELECT id FROM descendant_volumes)
		 AND rp.chapter_id NOT IN (
			 SELECT chapter_id FROM chapter_completions WHERE user_id = ?
		 )`,
		volumeID, userID, userID,
	).Scan(&progressPages)
	if err != nil {
		return 0, err
	}

	return completedPages + progressPages, nil
}

// GetProgressPercent 사용자의 볼륨 실제 진행 퍼센트 조회 (하위 볼륨 포함)
func (r *VolumeRepository) GetProgressPercent(db database.Queryer, userID, volumeID string) (float64, error) {
	db = database.GetQueryer(db)

	var percent float64
	err := db.QueryRow(
		`WITH RECURSIVE descendant_volumes(id) AS (
			SELECT id FROM volumes WHERE id = ?
			UNION ALL
			SELECT v.id FROM volumes v JOIN descendant_volumes dv ON v.parent_id = dv.id
		),
		chapter_units AS (
			SELECT
				c.id AS chapter_id,
				CASE
					WHEN c.total_positions > 0 THEN c.total_positions
					WHEN c.page_count > 0 THEN c.page_count
					ELSE 0
				END AS unit_total
			FROM chapters c
			WHERE c.volume_id IN (SELECT id FROM descendant_volumes)
		),
		total_units AS (
			SELECT COALESCE(SUM(cu.unit_total), 0) AS value
			FROM chapter_units cu
		),
		completed_units AS (
			SELECT COALESCE(SUM(cu.unit_total), 0) AS value
			FROM chapter_units cu
			JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id
			WHERE cc.user_id = ?
		),
		inprogress_units AS (
			SELECT COALESCE(SUM(
				cu.unit_total * (
					CASE
						WHEN rp.total_pages > 0 THEN MIN(1.0, MAX(0.0, CAST(rp.current_page AS REAL) / CAST(rp.total_pages AS REAL)))
						ELSE MIN(1.0, MAX(0.0, rp.progress_percent / 100.0))
					END
				)
			), 0.0) AS value
			FROM chapter_units cu
			JOIN reading_progress rp ON rp.chapter_id = cu.chapter_id
			LEFT JOIN chapter_completions cc ON cc.chapter_id = cu.chapter_id AND cc.user_id = rp.user_id
			WHERE rp.user_id = ?
			  AND cc.chapter_id IS NULL
		)
		SELECT CASE
			WHEN total_units.value <= 0 THEN 0.0
			ELSE MIN(100.0, MAX(0.0, ((completed_units.value + inprogress_units.value) * 100.0) / total_units.value))
		END
		FROM total_units, completed_units, inprogress_units`,
		volumeID, userID, userID,
	).Scan(&percent)
	return percent, err
}

// GetFirstVolume 시리즈의 첫 번째 볼륨 조회
func (r *VolumeRepository) GetFirstVolume(db database.Queryer, seriesID string) (*model.Volume, error) {
	db = database.GetQueryer(db)
	var v model.Volume
	var thumbnail, unit, parentID sql.NullString
	var description, authors, pubYear, extension sql.NullString

	err := db.QueryRow(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes WHERE series_id = ? ORDER BY volume_number LIMIT 1`,
		seriesID,
	).Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &parentID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt)

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
	if parentID.Valid {
		v.ParentID = &parentID.String
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
	if extension.Valid {
		v.Extension = extension.String
	}
	return &v, nil
}

// FindByParentID 부모 볼륨 ID로 볼륨 목록 조회 (시리즈 스코프 제한)
func (r *VolumeRepository) FindByParentID(db database.Queryer, parentID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes 
		 WHERE parent_id = ? 
		   AND series_id = (SELECT series_id FROM volumes WHERE id = ?)
		 ORDER BY volume_number, path`,
		parentID,
		parentID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, pID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &pID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if pID.Valid {
			v.ParentID = &pID.String
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
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}

// CountByParentID 부모 볼륨 ID로 하위 볼륨 개수 조회
func (r *VolumeRepository) CountByParentID(db database.Queryer, parentID string) (int, error) {
	db = database.GetQueryer(db)
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM volumes WHERE parent_id = ?`, parentID).Scan(&count)
	if err != nil {
		return 0, err
	}
	return count, nil
}

// FindRootVolumesBySeriesID 시리즈의 최상위 볼륨 목록 조회
func (r *VolumeRepository) FindRootVolumesBySeriesID(db database.Queryer, seriesID string) ([]model.Volume, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(
		`SELECT id, series_id, title, volume_number, path, thumbnail_path, has_audio, unit, chapter_count, parent_id, description, authors, publication_year, extension, created_at, updated_at 
		 FROM volumes WHERE series_id = ? AND parent_id IS NULL ORDER BY volume_number, path`,
		seriesID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var volumes []model.Volume
	for rows.Next() {
		var v model.Volume
		var thumbnail, unit, pID sql.NullString
		var description, authors, pubYear, extension sql.NullString

		if err := rows.Scan(&v.ID, &v.SeriesID, &v.Title, &v.VolumeNumber, &v.Path, &thumbnail, &v.HasAudio, &unit, &v.ChapterCount, &pID, &description, &authors, &pubYear, &extension, &v.CreatedAt, &v.UpdatedAt); err != nil {
			return nil, err
		}
		if unit.Valid {
			v.Unit = unit.String
		}
		if thumbnail.Valid {
			v.ThumbnailPath = &thumbnail.String
		}
		if pID.Valid {
			v.ParentID = &pID.String
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
		if extension.Valid {
			v.Extension = extension.String
		}
		volumes = append(volumes, v)
	}
	return volumes, nil
}
// GetDistinctExtensions 시리즈 내 모든 볼륨의 고유한 확장자 목록 조회
func (r *VolumeRepository) GetDistinctExtensions(db database.Queryer, seriesID string) ([]string, error) {
	db = database.GetQueryer(db)
	rows, err := db.Query(`SELECT DISTINCT extension FROM volumes WHERE series_id = ? AND (extension IS NOT NULL AND extension != '')`, seriesID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var extensions []string
	for rows.Next() {
		var ext string
		if err := rows.Scan(&ext); err != nil {
			return nil, err
		}
		extensions = append(extensions, ext)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return extensions, nil
}
